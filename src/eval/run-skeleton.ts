import { pathToFileURL } from 'node:url';
import type { Level } from '../domain/settings';
import type { TopicRequest } from '../domain/stages';
import { InlineEngine } from '../engine/inline-engine';
import { STAGE_MODELS, type Stage, type StageModel } from '../llm/models';
import { defaultDeps, type StageDeps } from '../pipeline/deps';
import { runPipeline, type PipelineRunResult, type RunOptions } from '../pipeline/run-pipeline';

const LEVELS: Level[] = ['intro', 'intermediate', 'advanced'];

/** Read a `--flag value` arg; undefined if absent or if the next token is itself a flag
 *  (so `--topic --level intro` does NOT parse topic = "--level"). */
function readFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  return value !== undefined && !value.startsWith('--') ? value : undefined;
}

const HAIKU: StageModel = { provider: 'anthropic', model: 'claude-haiku-4-5' };

/** Every stage on Haiku — the cheapest tier, for low-cost test runs (`--cheap`). */
function cheapModels(): Partial<Record<Stage, StageModel>> {
  const models: Partial<Record<Stage, StageModel>> = {};
  for (const stage of Object.keys(STAGE_MODELS) as Stage[]) models[stage] = HAIKU;
  return models;
}

/** Parse `--topic "x" [--level …] [--depth N] [--audience "…"]` into a TopicRequest. */
export function buildRequest(args: string[]): TopicRequest {
  const topic = readFlag(args, '--topic');
  if (!topic) {
    throw new Error(
      'Usage: npm run skeleton -- --topic "<topic>" [--level intro|intermediate|advanced] [--depth 1-5] [--audience "<who>"] [--cheap] [--max-nodes N]',
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

/** Parse cost-control flags: `--cheap` (Haiku everywhere) and `--max-nodes N` (cap synthesis). */
export function buildOptions(args: string[]): RunOptions {
  const options: RunOptions = {};
  const maxNodes = readFlag(args, '--max-nodes');
  if (maxNodes !== undefined) options.maxNodes = Number(maxNodes);
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
): Promise<PipelineRunResult> {
  return runPipeline(request, new InlineEngine(), deps, options);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const request = buildRequest(args);
  const options = buildOptions(args);
  const mode = `${options.models ? 'cheap/Haiku' : 'default models'}, ${
    options.maxNodes !== undefined ? `max ${options.maxNodes} built nodes` : 'all built nodes'
  }`;
  console.log(
    `Generating a curriculum for "${request.topic}" (${request.settings.level}, depth ${request.settings.depth}; ${mode})…\n`,
  );
  console.log(formatSummary(await runSkeleton(request, defaultDeps, options)));
}

// Run only when invoked directly (tsx src/eval/run-skeleton.ts), never when imported by a test.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
