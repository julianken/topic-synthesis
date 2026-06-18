import { contentHash } from '../domain/identity';
import { bucketize } from '../domain/settings';
import type {
  CritiquedArtifact,
  GatedNode,
  PipelineResult,
  Research,
  Source,
  TopicRequest,
} from '../domain/stages';
import type { Engine } from '../engine/engine';
import type { LlmCallRecord } from '../llm/client';
import { code } from './code';
import { gateGraph, type GateThresholds } from './coverage-gate';
import { critique } from './critic';
import { defaultDeps, type StageDeps } from './deps';
import { buildGraph } from './graph';
import { assembleHub } from './hub';
import { plan } from './planner';
import { research, type ResearchInput } from './researcher';
import { spec } from './spec';

export interface PipelineRunResult {
  result: PipelineResult;
  /** Every per-call LLM trace row, in execution order (the eleatic trace consumes these). */
  records: LlmCallRecord[];
  /** The run's total cost — the sum of the records' costUsd. */
  costUsd: number;
}

export interface RunOptions {
  thresholds?: GateThresholds;
}

/**
 * Run the whole pipeline over an injected Engine:
 *   plan → researchers (fan-out) → graph → coverage-gate → per built node
 *   (spec → code → critic) → hub.
 * Each LLM step is memoized through the engine (keyed by content identity) so a
 * retry/resume never repeats completed work. Pure stages (gate, hub) run inline. Only
 * 'built'-routed nodes are synthesized — 'text'/'soon' nodes appear in the hub as
 * placeholders, never fabricated pages. Returns the curriculum plus every per-call cost
 * record and the run's total USD.
 */
export async function runPipeline(
  req: TopicRequest,
  engine: Engine,
  deps: StageDeps = defaultDeps,
  options: RunOptions = {},
): Promise<PipelineRunResult> {
  const records: LlmCallRecord[] = [];
  const bucket = bucketize(req.settings);

  // 1. plan
  const planned = await engine.step('plan', contentHash(req.topic, bucket), () => plan(req, deps));
  records.push(...planned.records);

  // 2. researchers — one grounded retrieval per research question (fanned out)
  const subtopics = planned.plan.subtopics;
  const researchInputs: ResearchInput[] = planned.plan.researchQuestions.map((question, i) => ({
    subtopic: subtopics[i % subtopics.length] ?? planned.plan.scope,
    question,
    settings: req.settings,
  }));
  const researched = await Promise.all(
    researchInputs.map((input) =>
      engine.step('research', contentHash(input.question, bucket), () => research(input, deps)),
    ),
  );
  for (const r of researched) records.push(...r.records);
  const allResearch: Research[] = researched.map((r) => r.research);
  const allSources: Source[] = allResearch.flatMap((r) => r.sources);

  // 3. graph
  const graphed = await engine.step(
    'graph',
    contentHash(req.topic, bucket, String(researchInputs.length)),
    () => buildGraph(allResearch, deps),
  );
  records.push(...graphed.records);

  // 4. coverage gate (pure) — routes nodes built|text|soon, throws on a structural defect
  const gated = gateGraph(graphed.graph, options.thresholds);

  // 5. synthesize only the 'built'-routed nodes (spec → code → critic), memoized per slug
  const built = await Promise.all(
    gated.nodes
      .filter((node) => node.route === 'built')
      .map((node) => synthesizeNode(node, req, allSources, bucket, engine, deps)),
  );
  const pages: CritiquedArtifact[] = [];
  const passedSlugs = new Set<string>();
  for (const b of built) {
    records.push(...b.records);
    pages.push(b.artifact);
    if (b.artifact.passed) passedSlugs.add(b.artifact.nodeSlug);
  }

  // 6. assemble the hub (pure) — built = routed-built AND critic-passed
  const hub = assembleHub(gated, passedSlugs);
  const costUsd = records.reduce((sum, r) => sum + r.costUsd, 0);
  return { result: { hub, pages }, records, costUsd };
}

async function synthesizeNode(
  node: GatedNode,
  req: TopicRequest,
  sources: Source[],
  bucket: string,
  engine: Engine,
  deps: StageDeps,
): Promise<{ artifact: CritiquedArtifact; records: LlmCallRecord[] }> {
  const records: LlmCallRecord[] = [];
  const key = contentHash(node.slug, bucket);
  const specced = await engine.step('spec', key, () => spec({ node, settings: req.settings, sources }, deps));
  records.push(...specced.records);
  const coded = await engine.step('code', key, () => code(specced.spec, deps));
  records.push(...coded.records);
  const critiqued = await engine.step('critic', key, () => critique(coded.artifact, deps));
  records.push(...critiqued.records);
  return { artifact: critiqued.artifact, records };
}
