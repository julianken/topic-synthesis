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
import { STAGE_MODELS, type Stage, type StageModel } from '../llm/models';
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
  /** Cap on how many 'built'-routed nodes to synthesize (cost control; capped-out nodes show as 'soon'). */
  maxNodes?: number;
  /** Per-stage model overrides, merged over STAGE_MODELS (a workflow_version arm; also cheap-mode). */
  models?: Partial<Record<Stage, StageModel>>;
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
  const models: Record<Stage, StageModel> = { ...STAGE_MODELS, ...(options.models ?? {}) };

  // 1. plan
  const planned = await engine.step('plan', contentHash(req.topic, bucket), () => plan(req, deps, models.planner));
  records.push(...planned.records);

  // 2. researchers — one grounded retrieval per research question (fanned out).
  // Dedup identical questions first: the engine memoizes a repeated question to one
  // call, so threading records per-input would otherwise double-count that one
  // execution (a phantom row + overstated cost in the trace). researchQuestions has no
  // uniqueness constraint, so a duplicate is valid input we must collapse here.
  const subtopics = planned.plan.subtopics;
  const uniqueQuestions = [...new Set(planned.plan.researchQuestions)];
  const researchInputs: ResearchInput[] = uniqueQuestions.map((question, i) => ({
    subtopic: subtopics[i % subtopics.length] ?? planned.plan.scope,
    question,
    settings: req.settings,
  }));
  const researched = await Promise.all(
    researchInputs.map((input) =>
      engine.step('research', contentHash(input.question, bucket), () => research(input, deps, models.researcher)),
    ),
  );
  for (const r of researched) records.push(...r.records);
  const allResearch: Research[] = researched.map((r) => r.research);
  const allSources: Source[] = allResearch.flatMap((r) => r.sources);

  // 3. graph
  const graphed = await engine.step(
    'graph',
    contentHash(req.topic, bucket, String(researchInputs.length)),
    () => buildGraph(allResearch, deps, models.graph),
  );
  records.push(...graphed.records);

  // 4. coverage gate (pure) — routes nodes built|text|soon, throws on a structural defect
  const gated = gateGraph(graphed.graph, options.thresholds);

  // 5. synthesize the 'built'-routed nodes (spec → code → critic), memoized per slug,
  // foundational-first (topoOrder) and capped by maxNodes for cost control — a capped-out
  // built node has no page, so it surfaces as 'soon' in the hub (never fabricated).
  const buildable = gated.nodes
    .filter((node) => node.route === 'built')
    .sort((a, b) => gated.topoOrder.indexOf(a.slug) - gated.topoOrder.indexOf(b.slug));
  const toBuild = options.maxNodes !== undefined ? buildable.slice(0, options.maxNodes) : buildable;
  const built = await Promise.all(
    toBuild.map((node) => synthesizeNode(node, req, allSources, bucket, engine, deps, models)),
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
  models: Record<Stage, StageModel>,
): Promise<{ artifact: CritiquedArtifact; records: LlmCallRecord[] }> {
  const records: LlmCallRecord[] = [];
  const key = contentHash(node.slug, bucket);
  const specced = await engine.step('spec', key, () => spec({ node, settings: req.settings, sources }, deps, models.spec));
  records.push(...specced.records);
  const coded = await engine.step('code', key, () => code(specced.spec, deps, models.code));
  records.push(...coded.records);
  const critiqued = await engine.step('critic', key, () => critique(coded.artifact, deps, models.critic));
  records.push(...critiqued.records);
  return { artifact: critiqued.artifact, records };
}
