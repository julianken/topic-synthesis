import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Level } from '../domain/settings';
import type { CritiquedArtifact, TopicRequest } from '../domain/stages';
import { InlineEngine } from '../engine/inline-engine';
import { STAGE_MODELS, type Stage, type StageModel } from '../llm/models';
import { defaultDeps, type StageDeps } from '../pipeline/deps';
import { defaultStages, noopSink, type TraceSink } from '../pipeline/ports';
import { runPipeline, type PipelineRunResult, type RunOptions } from '../pipeline/run-pipeline';
import { persistRun, type PersistRunInput } from '../store/repo';
import { writeTrace } from '../trace/eleatic-adapter';
import { reduceTrace } from '../trace/reduce';
import { SpanCollector } from '../trace/span';

const LEVELS: Level[] = ['intro', 'intermediate', 'advanced'];

/** Read a `--flag value` arg; undefined if absent or if the next token is itself a flag
 *  (so `--topic --level intro` does NOT parse topic = "--level"). */
function readFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  return value !== undefined && !value.startsWith('--') ? value : undefined;
}

/** Read a `--flag N` positive integer; throws on a present-but-invalid value, so a typo
 *  can't silently cap to zero/NaN after the run has already spent on earlier stages. */
function readPositiveInt(args: string[], name: string): number | undefined {
  const raw = readFlag(args, name);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a positive integer`);
  return n;
}

const HAIKU: StageModel = { provider: 'anthropic', model: 'claude-haiku-4-5' };

/** Every stage on Haiku — the cheapest tier, for low-cost runs (`--cheap`; reused by the Job's CHEAP). */
export function cheapModels(): Partial<Record<Stage, StageModel>> {
  const models: Partial<Record<Stage, StageModel>> = {};
  for (const stage of Object.keys(STAGE_MODELS) as Stage[]) models[stage] = HAIKU;
  return models;
}

/** Parse `--topic "x" [--level …] [--depth N] [--audience "…"]` into a TopicRequest. */
export function buildRequest(args: string[]): TopicRequest {
  const topic = readFlag(args, '--topic');
  if (!topic) {
    throw new Error(
      'Usage: npm run skeleton -- --topic "<topic>" [--level intro|intermediate|advanced] [--depth 1-5] [--audience "<who>"] [--cheap] [--max-nodes N] [--max-questions N] [--dump-html <dir>] [--persist] [--trace [path]]',
    );
  }
  const level = readFlag(args, '--level') ?? 'intermediate';
  if (!LEVELS.includes(level as Level)) {
    throw new Error(`--level must be one of: ${LEVELS.join(', ')}`);
  }
  const depth = Number(readFlag(args, '--depth') ?? '3');
  return {
    topic,
    settings: { level: level as Level, depth, audience: readFlag(args, '--audience') ?? 'a self-taught learner' },
  };
}

/** Parse cost-control flags: `--cheap` (Haiku everywhere), `--max-nodes N` (cap synthesis),
 *  `--max-questions N` (cap research fan-out — each question drives a web search). */
export function buildOptions(args: string[]): RunOptions {
  const options: RunOptions = {};
  const maxNodes = readPositiveInt(args, '--max-nodes');
  if (maxNodes !== undefined) options.maxNodes = maxNodes;
  const maxQuestions = readPositiveInt(args, '--max-questions');
  if (maxQuestions !== undefined) options.maxQuestions = maxQuestions;
  if (args.includes('--cheap')) options.models = cheapModels();
  return options;
}

/** Human-readable run summary: the tiered curriculum + the per-model cost breakdown. */
export function formatSummary(run: PipelineRunResult): string {
  const allPages = run.result.hub.tiers.flatMap((t) => t.categories.flatMap((c) => c.pages));
  const lines: string[] = [`Curriculum — ${run.result.hub.tiers.length} tier(s), ${allPages.length} node(s):`];
  for (const tier of run.result.hub.tiers) {
    lines.push(`  ${tier.tier}`);
    for (const category of tier.categories) {
      for (const page of category.pages) lines.push(`    [${page.status}] ${page.title} (${page.slug})`);
    }
  }
  const passed = run.result.pages.filter((p) => p.passed).length;
  lines.push('', `Built pages: ${passed}/${run.result.pages.length} passed the critic.`, 'Cost by model:');
  const byModel = new Map<string, number>();
  for (const r of run.records) byModel.set(r.providerModel, (byModel.get(r.providerModel) ?? 0) + r.costUsd);
  for (const [model, cost] of byModel) lines.push(`  ${model}: $${cost.toFixed(4)}`);
  lines.push(`Total: $${run.costUsd.toFixed(4)} across ${run.records.length} LLM call(s).`);
  return lines.join('\n');
}

/**
 * Run the pipeline over the in-process engine — the CLI/dev path (no durable engine).
 * `deps` defaults to the live client, so a real run needs a provider API key in the env
 * (ANTHROPIC_API_KEY / OPENAI_API_KEY / …); tests inject fakes.
 */
export async function runSkeleton(
  request: TopicRequest,
  deps: StageDeps = defaultDeps,
  options: RunOptions = {},
  sink: TraceSink = noopSink,
): Promise<PipelineRunResult> {
  return runPipeline(request, new InlineEngine(), deps, options, defaultStages, sink);
}

/** Write each synthesized page's HTML to `<dir>/<slug>.html` (for `--dump-html`); returns the paths. */
export function dumpPages(pages: CritiquedArtifact[], dir: string): string[] {
  mkdirSync(dir, { recursive: true });
  return pages.map((page) => {
    // basename() the (LLM-authored) slug so it can't escape `dir` via `/` or `..`.
    const path = join(dir, `${basename(page.nodeSlug)}.html`);
    writeFileSync(path, page.html, 'utf8');
    return path;
  });
}

/** Assemble the persistRun input for a completed skeleton run (`--persist`). The
 *  workflow_version snapshot is STAGE_MODELS with the run's per-stage overrides merged in. */
export function persistInput(
  runId: string,
  request: TopicRequest,
  run: PipelineRunResult,
  options: RunOptions,
): PersistRunInput {
  const modelSnapshots: Record<Stage, StageModel> = { ...STAGE_MODELS, ...(options.models ?? {}) };
  return { runId, request, result: run.result, costUsd: run.costUsd, modelSnapshots };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const request = buildRequest(args);
  const options = buildOptions(args);
  const mode = [
    options.models ? 'cheap/Haiku' : 'default models',
    options.maxNodes !== undefined ? `≤${options.maxNodes} built nodes` : 'all built nodes',
    options.maxQuestions !== undefined ? `≤${options.maxQuestions} questions` : 'all questions',
  ].join(', ');
  console.log(
    `Generating a curriculum for "${request.topic}" (${request.settings.level}, depth ${request.settings.depth}; ${mode})…\n`,
  );
  // One id for this invocation — shared by --trace + --persist so the eleatic run links the curriculum.
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const collector = args.includes('--trace') ? new SpanCollector() : undefined;
  const run = await runSkeleton(request, defaultDeps, options, collector ?? noopSink);
  console.log(formatSummary(run));
  if (args.includes('--dump-html')) {
    const dumpDir = readFlag(args, '--dump-html');
    // Fail loud rather than silently skip the dump after the run has already spent.
    if (dumpDir === undefined) throw new Error('--dump-html requires a <dir>');
    const paths = dumpPages(run.result.pages, dumpDir);
    console.log(`\nWrote ${paths.length} page(s) to:\n${paths.map((p) => `  ${p}`).join('\n')}`);
  }
  if (collector) {
    const reduced = reduceTrace(collector.spans(), {
      runId,
      label: request.topic,
      startedAt,
      config: { models: { ...STAGE_MODELS, ...(options.models ?? {}) }, settings: request.settings },
      // The analysis row carries the assembled LessonBrief when the run exposes one (the single-lesson
      // path; issue #50). The curriculum path runSkeleton drives leaves it undefined → reduceTrace
      // falls back to the legacy `{ phase: 'analysis' }` sentinel. (exactOptionalPropertyTypes: spread.)
      ...(run.brief !== undefined ? { analysisOutput: run.brief } : {}),
    });
    const tracePath = readFlag(args, '--trace');
    const { path, rowCount } = writeTrace(reduced, tracePath !== undefined ? { path: tracePath } : {});
    console.log(
      path === ':memory:'
        ? `\nTraced ${rowCount} row(s) (ephemeral :memory: — pass \`--trace <path>\` to persist).`
        : `\nTraced ${rowCount} row(s) to ${path} — explore: npx @eleatic/eval serve --db ${path}`,
    );
  }
  if (args.includes('--persist')) {
    const { curriculumId } = await persistRun(persistInput(runId, request, run, options));
    console.log(`\nPersisted curriculum ${curriculumId} — view at /curriculum/${curriculumId} (needs DATABASE_URL + a migrated DB).`);
  }
}

// Run only when invoked directly (tsx src/eval/run-skeleton.ts), never when imported by a test.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
