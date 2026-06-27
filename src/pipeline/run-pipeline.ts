import { contentHash, slugify } from '../domain/identity';
import { bucketize } from '../domain/settings';
import type { SitemapHub } from '../domain/sitemap';
import {
  type CritiquedArtifact,
  type GatedNode,
  type LessonBrief,
  type LessonSpec,
  type PageSpec,
  type PipelineResult,
  type Plan,
  type Research,
  type Source,
  type TopicRequest,
} from '../domain/stages';
import type { Engine } from '../engine/engine';
import type { LlmCallRecord } from '../llm/client';
import { STAGE_MODELS, type Stage, type StageModel } from '../llm/models';
import { BriefOutputSchema } from './brief';
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
  /**
   * The assembled LessonBrief — the Analysis phase's product (issue #50). Set only by the
   * single-lesson path (`runLesson`, which has exactly one canonical brief); undefined on the
   * curriculum path (`runPipeline` uses transitional PER-NODE briefs, with no single one to expose).
   * The trace reducer carries it as the `_analysis` row's `output`, so an Analysis-only arm is
   * inspectable without running Synthesis.
   */
  brief?: LessonBrief;
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
 * Pin the arm-scoped `spec` (TS-10's `PageSpec | LessonSpec` union) to a `nodeSlug` without
 * collapsing the arm: `code` now narrows the union internally (TS-12 — per the TS-10 review note,
 * `code` renders BOTH arms into the v11 workspace rather than the caller pre-throwing a v11 spec),
 * so the sectioned `LessonSpec` is no longer flattened to a blob here. The brief carries no slug
 * (it is the single-lesson contract), so each call site overrides `nodeSlug` for its node/lesson;
 * spreading the union preserves either arm's shape (`isLessonSpec` discriminates downstream in
 * `code`). On the live deployed path (`LIVE_ARM` — the PROMOTED v11-graded arm, TS-15b/#107)
 * `spec` is a `LessonSpec`; the blob/`PageSpec` shape only flows through here on the reachable
 * kill-switch arm (`defaultStages`). Either way this just pins the slug — the arm is preserved.
 */
function specForCode(spec: PageSpec | LessonSpec, nodeSlug: string): PageSpec | LessonSpec {
  return { ...spec, nodeSlug };
}

/**
 * DORMANT(curriculum-wrapper — ADR-0003 / epic #52): the curriculum path. NO entrypoint
 * drives it today (`npm run skeleton`, the local-dev fallback, and the deployed Job all run
 * `runLesson`); RETAINED for the future curriculum-wrapper milestone (decompose → N lessons,
 * each via `runLesson`) and still covered by its own unit tests. See ADR-0003.
 *
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

  // 1–2. ANALYSIS prelude: plan + the researcher fan-out (shared with the single-lesson path).
  const { research: allResearch } = await runAnalysisPrelude(req, engine, deps, options, stages, sink, records);
  const allSources: Source[] = allResearch.flatMap((r) => r.sources);
  const researchCount = allResearch.length;

  // 3. graph
  const graphed = await engine.step(
    'graph',
    contentHash(req.topic, bucket, String(researchCount)),
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
  // The single-lesson path (runLesson, below) is the real `brief → spec → code → critic` wiring:
  // it runs the `brief` Analysis stage so the synthesized lesson teaches a synthesized learning
  // goal off grounded findings. DORMANT(curriculum-wrapper — ADR-0003 / epic #52): this curriculum
  // path has no entrypoint driving it yet (run-job runs the lesson path) and keeps a TRANSITIONAL
  // per-node brief — RETAINED until the wrapper milestone. Each gated node becomes
  // a lesson keyed by node.slug, with findings relabeled from the node's sources. Wiring the real
  // `brief` stage into the curriculum path is deferred to the curriculum-wrapper milestone (it
  // decomposes the topic → N lessons, each via runLesson) — see epic #52.
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
    // lesson IS a gated node, so pin the artifact to node.slug here. (The single-lesson path pins
    // to the topic-derived slug instead — see synthesizeLesson.)
    // `specced.spec` is the arm-scoped `PageSpec | LessonSpec` union (TS-10/TS-11); `code` narrows
    // it internally (TS-12) and renders either arm into the v11 workspace — `specForCode` just pins
    // the slug, preserving the arm. The live default is now the v11-graded arm (`LIVE_ARM.spec` =
    // `specV11`, emitting a `LessonSpec` — TS-15b/#107); the blob `PageSpec` only flows on the
    // reachable kill-switch arm (`defaultStages.spec`).
    const nodeSpec = specForCode(specced.spec, node.slug);
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

/**
 * The ANALYSIS prelude shared by BOTH run paths: `plan` then the researcher fan-out. It owns the
 * same memoization keys (`contentHash(req.topic, bucket)` for plan; `contentHash(question, bucket)`
 * per research call), the question dedup + `maxQuestions` cap, record threading, and span emission
 * as the original inline steps did — so the curriculum and single-lesson paths can't drift in how
 * Analysis is keyed, cost-accounted, or traced. It pushes its records onto the caller's `records`
 * array (the single shared cost ledger) and returns the plan + the grounded research[].
 */
async function runAnalysisPrelude(
  req: TopicRequest,
  engine: Engine,
  deps: StageDeps,
  options: RunOptions,
  stages: StageBundle,
  sink: TraceSink,
  records: LlmCallRecord[],
): Promise<{ plan: Plan; research: Research[] }> {
  const bucket = bucketize(req.settings);
  const models: Record<Stage, StageModel> = { ...STAGE_MODELS, ...(options.models ?? {}) };
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
  return { plan: planned.plan, research: researched.map((r) => r.research) };
}

/**
 * Run the pipeline in SINGLE-LESSON mode over an injected Engine:
 *   plan → researchers (fan-out) → brief → spec → code → critic → ONE lesson.
 * It shares the ANALYSIS prelude (plan + research) with `runPipeline` but DROPS the
 * curriculum-shaped middle — `graph`, `gateGraph`, and `assembleHub` are never called. The `brief`
 * Analysis stage replaces graph as the producer of "what to teach": it folds plan + research[] into
 * one `LessonBrief` (a synthesized learning goal + grounded findings), which `spec` then consumes.
 * The lone lesson is keyed by a topic-derived slug (no graph → no node.slug), so a Job retry on the
 * same `RUN_ID` memoizes the synthesis trio. Returns a one-tier/one-category/one-page result that
 * `persistRun`/`formatSummary` consume unchanged — no schema change, no new table.
 */
export async function runLesson(
  req: TopicRequest,
  engine: Engine,
  deps: StageDeps = defaultDeps,
  options: RunOptions = {},
  stages: StageBundle = defaultStages,
  sink: TraceSink = noopSink,
): Promise<PipelineRunResult> {
  const records: LlmCallRecord[] = [];
  const bucket = bucketize(req.settings);
  const models: Record<Stage, StageModel> = { ...STAGE_MODELS, ...(options.models ?? {}) };
  const emit = (stage: Stage, recs: LlmCallRecord[]): void => {
    for (const record of recs) sink.onSpan({ stage, record });
  };

  // 1–2. ANALYSIS prelude: plan + the researcher fan-out (the same keys/cost/traces as runPipeline).
  const { plan: thePlan, research: allResearch } = await runAnalysisPrelude(
    req,
    engine,
    deps,
    options,
    stages,
    sink,
    records,
  );

  // 3. brief (Analysis) — folds plan + research[] into ONE LessonBrief; replaces graph as the
  // "what to teach" producer. Keyed off the topic + research count so it memoizes on resume.
  // The 4th arg arms validate-on-resume (issue #50): the durable engine re-runs this step if a
  // cached brief no longer parses against the CURRENT LessonBrief contract (BriefOutputSchema wraps
  // LessonBriefSchema), so a deploy that changes the contract mid-run can't feed an old-shape brief
  // into `spec`. The brief is the contract that crosses the Analysis→Synthesis seam — the one step
  // where a stale shape would corrupt the run, so it's the one pinned with a validator.
  const briefed = await engine.step(
    'brief',
    contentHash(req.topic, bucket, String(allResearch.length)),
    () => stages.brief({ plan: thePlan, research: allResearch, settings: req.settings }, deps, models.brief),
    BriefOutputSchema,
  );
  records.push(...briefed.records);
  emit('brief', briefed.records);

  // 4. synthesize the ONE lesson (spec → code → critic), keyed by the topic-derived slug.
  const slug = slugify(req.topic);
  const synth = await synthesizeLesson(slug, briefed.brief, req, bucket, engine, deps, models, stages, sink);
  records.push(...synth.records);

  // 5. assemble a one-tier/one-category/one-page hub (NO assembleHub — that's the curriculum path).
  const built = synth.artifact?.passed ?? false;
  const status = built ? 'built' : 'soon';
  const hub: SitemapHub = {
    tiers: [
      {
        tier: 'Tier 1',
        categories: [
          {
            // href is a placeholder — the read path (rebuildHub) sets the real owner-scoped href.
            name: 'Lesson',
            pages: [{ slug, title: briefTitle(briefed.brief), status, built, href: '' }],
          },
        ],
      },
    ],
  };
  const pages: CritiquedArtifact[] = synth.artifact ? [synth.artifact] : [];
  if (!synth.artifact) {
    // The lesson failed synthesis and degraded to 'soon' (the same contract as a curriculum node:
    // a null artifact → no fabricated page → status 'soon'). Surface it in the logs.
    console.warn(`[pipeline] lesson degraded to 'soon' after a synthesis failure — ${synth.degraded}`);
  }
  const costUsd = records.reduce((sum, r) => sum + r.costUsd, 0);
  // Expose the assembled brief so a trace carries it as the analysis row's output (issue #50).
  return { result: { hub, pages }, records, costUsd, brief: briefed.brief };
}

/** A human title for the one lesson: the brief's first keyPoint, else its learningGoal. */
function briefTitle(brief: LessonBrief): string {
  return brief.keyPoints[0] ?? brief.learningGoal;
}

/**
 * Synthesize the single lesson (spec → code → critic) from a REAL `brief`, keyed by the topic-derived
 * slug. Mirrors `synthesizeNode`'s memoization + span + degrade-on-failure contract, but the brief
 * comes straight from the `brief` Analysis stage (not a per-node relabel) and the artifact is pinned
 * to the topic-derived slug (no graph node to bind to). A synthesis failure degrades to a null
 * artifact ('soon'), keeping the partial cost/trace — the run never crashes.
 */
async function synthesizeLesson(
  slug: string,
  brief: LessonBrief,
  req: TopicRequest,
  bucket: string,
  engine: Engine,
  deps: StageDeps,
  models: Record<Stage, StageModel>,
  stages: StageBundle,
  sink: TraceSink,
): Promise<{ artifact: CritiquedArtifact | null; records: LlmCallRecord[]; degraded?: string }> {
  const records: LlmCallRecord[] = [];
  const emitNode = (stage: Stage, recs: LlmCallRecord[]): void => {
    for (const record of recs) sink.onSpan({ stage, nodeSlug: slug, record });
  };
  const key = contentHash(slug, bucket);
  try {
    const specced = await engine.step('spec', key, () => stages.spec({ brief, settings: req.settings }, deps, models.spec));
    records.push(...specced.records);
    emitNode('spec', specced.records);
    // The brief carries no slug; pin the artifact to the topic-derived slug here. `code` narrows the
    // arm-scoped `PageSpec | LessonSpec` union internally (TS-12) and renders either arm into the v11
    // workspace; `specForCode` just pins the slug, preserving the arm. The live default is the
    // v11-graded arm (`LIVE_ARM.spec` = `specV11`, emitting a `LessonSpec` — TS-15b/#107); the blob
    // `PageSpec` only flows on the reachable kill-switch arm (`defaultStages.spec`).
    const nodeSpec = specForCode(specced.spec, slug);
    const coded = await engine.step('code', key, () => stages.code(nodeSpec, brief.learningGoal, deps, models.code));
    records.push(...coded.records);
    emitNode('code', coded.records);
    const critiqued = await engine.step('critic', key, () => stages.critic(coded.artifact, deps, models.critic));
    records.push(...critiqued.records);
    emitNode('critic', critiqued.records);
    return { artifact: critiqued.artifact, records };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { artifact: null, records, degraded: `${slug}: ${reason}` };
  }
}
