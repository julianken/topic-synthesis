import { contentHash } from '../domain/identity';
import { bucketize } from '../domain/settings';
import type {
  CritiquedArtifact,
  GatedNode,
  LessonBrief,
  PipelineResult,
  Research,
  Source,
  TopicRequest,
} from '../domain/stages';
import type { Engine } from '../engine/engine';
import type { LlmCallRecord } from '../llm/client';
import { STAGE_MODELS, type Stage, type StageModel } from '../llm/models';
import { gateGraph, type GateThresholds } from './coverage-gate';
import { defaultDeps, type StageDeps } from './deps';
import { assembleHub } from './hub';
import { defaultStages, noopSink, type StageBundle, type TraceSink } from './ports';
import type { ResearchInput } from './researcher';

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
  /** Cap on research questions fanned out — each drives a web search, the run's main cost driver. */
  maxQuestions?: number;
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
  // `stages` is the 5th param (AFTER options) on purpose: existing callers/tests pass
  // `options` as the 4th positional arg, so it must come after to not capture them.
  stages: StageBundle = defaultStages,
  // The observability sink — 6th positional, AFTER stages. Default no-op, so the Next app (which
  // injects noopSink) never reaches the eleatic adapter; the eval/CLI injects a SpanCollector.
  sink: TraceSink = noopSink,
): Promise<PipelineRunResult> {
  const records: LlmCallRecord[] = [];
  const bucket = bucketize(req.settings);
  const models: Record<Stage, StageModel> = { ...STAGE_MODELS, ...(options.models ?? {}) };
  // Emit one span per LLM call, tagged with its stage (per-node analysis stages carry no slug).
  const emit = (stage: Stage, recs: LlmCallRecord[]): void => {
    for (const record of recs) sink.onSpan({ stage, record });
  };

  // 1. plan
  const planned = await engine.step('plan', contentHash(req.topic, bucket), () => stages.plan(req, deps, models.planner));
  records.push(...planned.records);
  emit('planner', planned.records);

  // 2. researchers — one grounded retrieval per research question (fanned out).
  // Dedup identical questions first: the engine memoizes a repeated question to one
  // call, so threading records per-input would otherwise double-count that one
  // execution (a phantom row + overstated cost in the trace). researchQuestions has no
  // uniqueness constraint, so a duplicate is valid input we must collapse here.
  const subtopics = planned.plan.subtopics;
  const uniqueQuestions = [...new Set(planned.plan.researchQuestions)];
  // Cap the research fan-out: each question drives a web search, the run's main cost driver.
  const questions =
    options.maxQuestions !== undefined ? uniqueQuestions.slice(0, options.maxQuestions) : uniqueQuestions;
  const researchInputs: ResearchInput[] = questions.map((question, i) => ({
    subtopic: subtopics[i % subtopics.length] ?? planned.plan.scope,
    question,
    settings: req.settings,
  }));
  const researched = await Promise.all(
    researchInputs.map((input) =>
      engine.step('research', contentHash(input.question, bucket), () => stages.research(input, deps, models.researcher)),
    ),
  );
  for (const r of researched) {
    records.push(...r.records);
    emit('researcher', r.records);
  }
  const allResearch: Research[] = researched.map((r) => r.research);
  const allSources: Source[] = allResearch.flatMap((r) => r.sources);

  // 3. graph
  const graphed = await engine.step(
    'graph',
    contentHash(req.topic, bucket, String(researchInputs.length)),
    () => stages.graph(allResearch, deps, models.graph),
  );
  records.push(...graphed.records);
  emit('graph', graphed.records);

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
    toBuild.map((node) => synthesizeNode(node, req, allSources, bucket, engine, deps, models, stages, sink)),
  );
  const pages: CritiquedArtifact[] = [];
  const passedSlugs = new Set<string>();
  for (const b of built) {
    records.push(...b.records); // a degraded node's partial records still count toward cost/trace
    if (!b.artifact) {
      // The node failed synthesis and was degraded to 'soon' (see synthesizeNode). Skip the page;
      // its absence from passedSlugs makes assembleHub route it 'soon'. Surface it in the logs.
      console.warn(`[pipeline] node degraded to 'soon' after a synthesis failure — ${b.degraded}`);
      continue;
    }
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
  stages: StageBundle,
  sink: TraceSink,
): Promise<{ artifact: CritiquedArtifact | null; records: LlmCallRecord[]; degraded?: string }> {
  const records: LlmCallRecord[] = [];
  const emitNode = (stage: Stage, recs: LlmCallRecord[]): void => {
    for (const record of recs) sink.onSpan({ stage, nodeSlug: node.slug, record });
  };
  const key = contentHash(node.slug, bucket);
  // TODO(#48): the single-lesson path rewires this to run `brief → spec → code → critic`
  // graph-free, so the brief comes from `stages.brief(plan, research, …)`. Until then, this
  // curriculum path keeps compiling by deriving a transitional LessonBrief per node from the
  // gated node + its sources. This shim is #48's to delete — #47 only ships the contract,
  // producer, and the retargeted spec (proven by spec.test.ts), not the end-to-end wiring.
  const lessonBrief: LessonBrief = {
    learningGoal: node.summary,
    keyPoints: [node.title],
    findings: sources.map((source) => ({ claim: source.title, source })),
    audience: req.settings.audience,
  };
  try {
    const specced = await engine.step('spec', key, () => stages.spec({ brief: lessonBrief, settings: req.settings }, deps, models.spec));
    records.push(...specced.records);
    emitNode('spec', specced.records);
    // The brief carries no slug (it's the single-lesson contract); on this curriculum path each
    // lesson IS a gated node, so pin the artifact to node.slug here. TODO(#48): the slug binding
    // belongs to the single-lesson-path wiring, not the contract.
    const nodeSpec = { ...specced.spec, nodeSlug: node.slug };
    const coded = await engine.step('code', key, () => stages.code(nodeSpec, lessonBrief.learningGoal, deps, models.code));
    records.push(...coded.records);
    emitNode('code', coded.records);
    const critiqued = await engine.step('critic', key, () => stages.critic(coded.artifact, deps, models.critic));
    records.push(...critiqued.records);
    emitNode('critic', critiqued.records);
    return { artifact: critiqued.artifact, records };
  } catch (err) {
    // One node's synthesis failing — e.g. the code stage hitting the model output cap on an oversized
    // page — must NOT crash the whole run. Degrade THIS node to 'soon' (a null artifact → absent from
    // passedSlugs → assembleHub routes it 'soon') and keep the partial records so its cost/trace still
    // counts. Walking-skeleton error-handling contract: a node that fails degrades; the hub still assembles.
    const reason = err instanceof Error ? err.message : String(err);
    return { artifact: null, records, degraded: `${node.slug}: ${reason}` };
  }
}
