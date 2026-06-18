import { pathToFileURL } from 'node:url';
import type { Level } from '../domain/settings';
import type { TopicRequest } from '../domain/stages';
import { InlineEngine } from '../engine/inline-engine';
import { defaultDeps, type StageDeps } from '../pipeline/deps';
import { runPipeline, type PipelineRunResult } from '../pipeline/run-pipeline';

const LEVELS: Level[] = ['intro', 'intermediate', 'advanced'];

/** Parse `--topic "x" [--level …] [--depth N] [--audience "…"]` into a TopicRequest. */
export function buildRequest(args: string[]): TopicRequest {
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const topic = flag('--topic');
  if (!topic) {
    throw new Error(
      'Usage: npm run skeleton -- --topic "<topic>" [--level intro|intermediate|advanced] [--depth 1-5] [--audience "<who>"]',
    );
  }
  const level = flag('--level') ?? 'intermediate';
  if (!LEVELS.includes(level as Level)) {
    throw new Error(`--level must be one of: ${LEVELS.join(', ')}`);
  }
  const depth = Number(flag('--depth') ?? '3');
  return {
    topic,
    settings: { level: level as Level, depth, audience: flag('--audience') ?? 'a self-taught learner' },
  };
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
export async function runSkeleton(request: TopicRequest, deps: StageDeps = defaultDeps): Promise<PipelineRunResult> {
  return runPipeline(request, new InlineEngine(), deps);
}

async function main(): Promise<void> {
  const request = buildRequest(process.argv.slice(2));
  console.log(`Generating a curriculum for "${request.topic}" (${request.settings.level}, depth ${request.settings.depth})…\n`);
  console.log(formatSummary(await runSkeleton(request)));
}

// Run only when invoked directly (tsx src/eval/run-skeleton.ts), never when imported by a test.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
