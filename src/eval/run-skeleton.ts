import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Level } from '../domain/settings';
import type { CritiquedArtifact, TopicRequest } from '../domain/stages';
import { InlineEngine } from '../engine/inline-engine';
import { cheapModels, STAGE_MODELS, type StageModel } from '../llm/models';
import { defaultDeps, type StageDeps } from '../pipeline/deps';
import { defaultStages, noopSink, type TraceSink } from '../pipeline/ports';
import { runLesson, type PipelineRunResult, type RunOptions } from '../pipeline/run-pipeline';
import { persistRun } from '../store/repo';
import { writeTrace } from '../trace/eleatic-adapter';
import { judgeBrief } from '../trace/judge';
import { reduceTrace, type TraceMeta } from '../trace/reduce';
import { SpanCollector } from '../trace/span';
// persistInput lives in its OWN trace-free module (issue #162) so the headless Job entry can reach it
// without dragging the @eleatic/eval trace adapter into the job bundle; re-exported here so this
// module's own callers (+ run-skeleton.test.ts) import it unchanged.
import { persistInput } from './persist-input';
export { persistInput };

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

/** Parse `--topic "x" [--level …] [--depth N] [--audience "…"]` into a TopicRequest. */
export function buildRequest(args: string[]): TopicRequest {
  const topic = readFlag(args, '--topic');
  if (!topic) {
    throw new Error(
      'Usage: npm run skeleton -- --topic "<topic>" [--level intro|intermediate|advanced] [--depth 1-5] [--audience "<who>"] [--cheap] [--max-questions N] [--dump-html <dir>] [--persist] [--trace [path]] [--baseline <runId>]',
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

/** Parse cost-control flags: `--cheap` (Haiku everywhere), `--max-questions N` (cap research fan-out —
 *  each question drives a web search). NOTE: `--max-nodes` is still PARSED (so a typo throws and the
 *  value stays in `RunOptions` for any future curriculum caller), but the CLI now drives `runLesson`,
 *  which synthesizes exactly ONE page — so `maxNodes` is INERT on this path (it caps `runPipeline`'s
 *  built-node count, never the single lesson). It is intentionally not advertised in the usage string. */
export function buildOptions(args: string[]): RunOptions {
  const options: RunOptions = {};
  const maxNodes = readPositiveInt(args, '--max-nodes');
  if (maxNodes !== undefined) options.maxNodes = maxNodes; // inert on the lesson path (see above)
  const maxQuestions = readPositiveInt(args, '--max-questions');
  if (maxQuestions !== undefined) options.maxQuestions = maxQuestions;
  if (args.includes('--cheap')) options.models = cheapModels();
  return options;
}

/** Human-readable run summary: the synthesized lesson page(s) + the per-model cost breakdown.
 *  `runLesson` produces a trivial one-tier/one-page hub, so this iterates `hub.tiers` and prints a
 *  single lesson; the loop generalizes to the dormant curriculum path's multi-tier hub unchanged. */
export function formatSummary(run: PipelineRunResult): string {
  const allPages = run.result.hub.tiers.flatMap((t) => t.categories.flatMap((c) => c.pages));
  const lines: string[] = [`Lesson — ${allPages.length} page(s):`];
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
 * Run the SINGLE-LESSON path over the in-process engine — the CLI/dev path (no durable engine),
 * matching the deployed Cloud Run Job (`run-job.ts`) + the single-lesson UI (#49). It exposes
 * `result.brief` (the `runLesson` Analysis product), so a `--trace` run now FIRES the #51 eval judge
 * over that brief (see `reduceRunTrace`). `deps` defaults to the live client, so a real run needs a
 * provider API key in the env (ANTHROPIC_API_KEY / OPENAI_API_KEY / …); tests inject fakes.
 */
export async function runSkeleton(
  request: TopicRequest,
  deps: StageDeps = defaultDeps,
  options: RunOptions = {},
  sink: TraceSink = noopSink,
): Promise<PipelineRunResult> {
  return runLesson(request, new InlineEngine(), deps, options, defaultStages, sink);
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

/**
 * Build the eleatic trace for a `--trace` run — the QUALITY signals (issue #51) plus the cost signal
 * (#50/earlier) — and REDUCE it (no I/O; the pure step the CLI-wiring test asserts on). It (a) maps
 * each built page's critic verdict onto `meta.verdicts` (slug → passed) from the result the run
 * already holds — NOT from a span, since a span carries no verdict; (b) when the run exposes a
 * `LessonBrief`, runs the LLM-judge over it, EMITS the judge's call as a `'judge'` span into the
 * collector (so its cost folds into the `_analysis` row and the row-cost-sums-to-run-cost invariant
 * stays honest) and threads its scores onto `meta.analysisScores`; (c) carries the assembled brief as
 * the analysis output (#50) and an optional `--baseline` for arm pairing (#51). The judge is INJECTED
 * (`judge`, default the real `judgeBrief`) so a test runs it with a fake `completeObject` and no live
 * model. Reduces AFTER the judge span is collected, so the analysis row's cost includes it.
 */
export async function reduceRunTrace(
  collector: SpanCollector,
  run: PipelineRunResult,
  base: Pick<TraceMeta, 'runId' | 'label' | 'startedAt' | 'config'>,
  opts: { baseline?: string; judge?: typeof judgeBrief; judgeModel?: StageModel } = {},
): Promise<ReturnType<typeof reduceTrace>> {
  const judge = opts.judge ?? judgeBrief;
  // (a) critic verdicts from the pipeline result (each page is a CritiquedArtifact with .passed).
  const verdicts: Record<string, boolean> = Object.fromEntries(
    run.result.pages.map((p) => [p.nodeSlug, p.passed]),
  );
  // (b) the LLM-judge over the brief, when the run exposes one (the single-lesson path). Its call is
  // emitted as a 'judge' span (no nodeSlug → it lands in the _analysis row) so judge spend folds into
  // the cost accounting; its scores ride onto the analysis row via meta.analysisScores. The judge runs
  // on the run's resolved judge MODEL (#57 SUGGESTION #2) — `judgeModel`, the run's `critic` override
  // (cheap on `--cheap`) — so it isn't hardcoded to opus while the rest of a cheap run is Haiku. The
  // default-arg path (no judgeModel) leaves `judgeBrief` on its own `STAGE_MODELS.critic` default.
  let analysisScores: Record<string, number> | undefined;
  if (run.brief !== undefined) {
    const judged =
      opts.judgeModel !== undefined ? await judge(run.brief, undefined, opts.judgeModel) : await judge(run.brief);
    collector.onSpan({ stage: 'judge', record: judged.record });
    analysisScores = judged.scores;
  }
  const meta: TraceMeta = {
    ...base,
    verdicts,
    // (c) analysisOutput (#50) + the optional fields, conditionally spread so an absent one is
    // OMITTED, not `undefined` (exactOptionalPropertyTypes).
    ...(run.brief !== undefined ? { analysisOutput: run.brief } : {}),
    ...(analysisScores !== undefined ? { analysisScores } : {}),
    ...(opts.baseline !== undefined ? { baseline: opts.baseline } : {}),
  };
  // Reduce AFTER the judge span is collected, so the analysis row's costUsd/calls include it.
  return reduceTrace(collector.spans(), meta);
}

/** As `reduceRunTrace`, then WRITE the reduced trace to the eleatic store (the CLI's I/O step). */
export async function buildAndReduceTrace(
  collector: SpanCollector,
  run: PipelineRunResult,
  base: Pick<TraceMeta, 'runId' | 'label' | 'startedAt' | 'config'>,
  opts: { baseline?: string; tracePath?: string; judge?: typeof judgeBrief; judgeModel?: StageModel } = {},
): Promise<{ path: string; rowCount: number }> {
  const { judge, baseline, judgeModel } = opts;
  const reduced = await reduceRunTrace(collector, run, base, {
    ...(baseline !== undefined ? { baseline } : {}),
    ...(judge !== undefined ? { judge } : {}),
    ...(judgeModel !== undefined ? { judgeModel } : {}),
  });
  return writeTrace(reduced, opts.tracePath !== undefined ? { path: opts.tracePath } : {});
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const request = buildRequest(args);
  const options = buildOptions(args);
  // `--max-nodes` is deliberately absent from the mode line: the CLI drives `runLesson`, which builds
  // exactly one page, so the flag is inert here (see `buildOptions`).
  const mode = [
    options.models ? 'cheap/Haiku' : 'default models',
    options.maxQuestions !== undefined ? `≤${options.maxQuestions} questions` : 'all questions',
  ].join(', ');
  console.log(
    `Generating a lesson for "${request.topic}" (${request.settings.level}, depth ${request.settings.depth}; ${mode})…\n`,
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
    const tracePath = readFlag(args, '--trace');
    const baseline = readFlag(args, '--baseline');
    // The judge runs on the run's RESOLVED judge model (#57 SUGGESTION #2): the run's `critic`
    // override merged over STAGE_MODELS — so a `--cheap` run judges on the cheap CRITIC model (Sonnet,
    // per `cheapModels()`) instead of always opus, matching the rest of that run's synthesis tier. With
    // no override this is STAGE_MODELS.critic (opus), the judge's own default. Resolved once here off
    // the same merge `config.models` uses.
    const judgeModel: StageModel = { ...STAGE_MODELS, ...(options.models ?? {}) }.critic;
    // buildAndReduceTrace threads the QUALITY signals (critic verdicts + the LLM-judge over the
    // brief + the analysis output) and the optional baseline onto the trace, EMITS the judge span
    // into `collector` so judge spend folds into the cost invariant, then reduces + writes (#50/#51).
    const { path, rowCount } = await buildAndReduceTrace(
      collector,
      run,
      {
        runId,
        label: request.topic,
        startedAt,
        config: { models: { ...STAGE_MODELS, ...(options.models ?? {}) }, settings: request.settings },
      },
      {
        judgeModel,
        ...(baseline !== undefined ? { baseline } : {}),
        ...(tracePath !== undefined ? { tracePath } : {}),
      },
    );
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
