import { type DegradeReason, truncateDegradeDetail } from '../domain/degrade';
import { contentHash, slugify } from '../domain/identity';
import { bucketize } from '../domain/settings';
import type { SitemapHub } from '../domain/sitemap';
import type {
  CritiquedArtifact,
  GatedNode,
  LessonBrief,
  PipelineResult,
  Plan,
  Research,
  Source,
  TopicRequest,
} from '../domain/stages';
import type { Engine } from '../engine/engine';
import type { LlmCallRecord } from '../llm/client';
import { STAGE_MODELS, type Stage, type StageModel } from '../llm/models';
import { BriefOutputSchema } from './brief';
import { classifyCategory } from './classify-category';
import { gateGraph, type GateThresholds } from './coverage-gate';
import { defaultDeps, type StageDeps } from './deps';
import { assembleHub } from './hub';
import {
  defaultStages,
  noopCodeProgressSink,
  noopResearchSink,
  noopSink,
  type CodeProgressSink,
  type ResearchSink,
  type StageBundle,
  type TraceSink,
} from './ports';
import type { ResearchInput } from './researcher';

/**
 * Fire a best-effort research-sink emission off the run's critical path and discard its outcome. The
 * sink is observability, NEVER load-bearing, so a faulty injected sink must be inert by construction:
 * this catches BOTH a SYNCHRONOUS throw (the call never returns a promise) AND an async rejection, so
 * neither can reach `runLesson` or the researcher fan-out. (`PgResearchSink` already self-wraps each
 * write, so this is belt-and-suspenders for a non-conforming injected sink — e.g. a test fake or a
 * future adapter that throws synchronously.) The run never awaits this; the UI degrades to the
 * stage-rail timeline when the sink fails.
 */
function fireResearch(call: () => Promise<void>): void {
  try {
    void call().catch(() => {});
  } catch {
    /* a synchronous throw from a non-conforming sink — swallowed, never reaches the run */
  }
}

/**
 * Wrap a `CodeProgressSink` into the synchronous `onProgress` hook the streaming `code` stage fires per
 * delta, swallowing a SYNCHRONOUS throw from a non-conforming sink so it can never reach the paid `code`
 * stream (the same belt-and-suspenders `fireResearch` gives the research sink; `PgCodeProgressSink` also
 * self-wraps its async write and never awaits it). The bar degrades to the running-code elapsed timer if
 * the sink faults.
 *
 * RESUME SEMANTICS (accepted tradeoff, mirroring `step_event`'s "cache HIT emits nothing" — issue #61):
 * this hook is threaded into the INNER lambda of the MEMOIZED `engine.step('code', key, …)`. On a
 * crash-resume the `code` step is a cache HIT, so `stages.code` never re-runs, `onProgress` never fires,
 * and the bar does not advance; a pre-crash `code_progress` row may read a stale fraction. That is inert
 * at completion — the bar is rendered ONLY while the `code` rail stage is `running`, so it disappears the
 * instant `code` flips to `done` (the resumed `critic` step then runs), and `code_progress` is pruned at
 * persist regardless.
 */
function codeProgressHook(
  sink: CodeProgressSink,
): (p: { outputTokens: number; elapsedMs: number; maxTokens: number; phase: 'prefill' | 'generating' }) => void {
  return (p) => {
    try {
      sink.onProgress(p);
    } catch {
      /* a non-conforming sink throwing synchronously — swallowed, never reaches the code stream */
    }
  };
}

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
  /**
   * The subject CATEGORY for the Figma `6:2` poster-card eyebrow (BIOLOGY / MATHEMATICS / …), or null
   * when none could be safely derived. PRESENTATION METADATA, NOT a pipeline stage — produced by the
   * isolated, FAIL-SAFE `classifyCategory` helper at the run TAIL (single-lesson path only). It never
   * touches the `LessonBrief` contract, never feeds Synthesis, and a classifier fault yields null with
   * the lesson unaffected. `persistRun` writes it onto the curriculum; null omits the card eyebrow.
   */
  category?: string | null;
  /**
   * The card DESCRIPTION for the Figma `6:2` poster-card body (node `6:47`) — pure data plumbing: the
   * `brief.learningGoal` already assembled by Analysis, surfaced as the learner-facing one-liner. No
   * extra generation. Single-lesson path only (it's read off the run's one canonical brief).
   */
  summary?: string;
  /**
   * The operator-only DEGRADE REASON (issue #214) — WHY this run was routed away from `built`, set ONLY
   * on a degraded single-lesson run. Undefined on a built run and on the dormant curriculum path
   * (`runPipeline`, which degrades PER NODE, has no single run-level reason). It is TELEMETRY, not
   * durable state: `runCompleteEvent` emits its low-cardinality `code` + bounded `detail` on the
   * `run.complete` Cloud-Logging event; nothing persists it (no `concept_page` column — the leak-safe
   * boundary holds). The `detail` is already truncated to `DEGRADE_DETAIL_MAX` at the degrade site.
   */
  degrade?: DegradeReason;
}

export interface RunOptions {
  thresholds?: GateThresholds;
  /** Cap on how many 'built'-routed nodes to synthesize (cost control; capped-out nodes show as 'soon'). */
  maxNodes?: number;
  /** Per-stage model overrides, merged over STAGE_MODELS (a workflow_version arm; also cheap-mode). */
  models?: Partial<Record<Stage, StageModel>>;
  /** Cap on research questions fanned out — each drives a web search, the run's main cost driver. */
  maxQuestions?: number;
  /**
   * Max researcher web-search calls in flight at once (issue #189). The fan-out is bounded by an inline
   * semaphore so a growing question count can't stampede the provider on a `529` overload (jittered
   * `withResilientRetry` then spreads the retries). Defaults to {@link DEFAULT_RESEARCH_CONCURRENCY}.
   * FORWARD-ONLY today: every live entrypoint already caps the fan-out at 4 questions
   * (`dispatch.ts` `MAX_QUESTIONS=4`, `route.ts` `maxQuestions:4`), so a default ≥4 never engages at
   * current settings — the bound bites only when the question count later rises past the cap.
   */
  researchConcurrency?: number;
}

/**
 * Default cap on concurrent researcher web-search calls (issue #189). 4 matches today's live fan-out
 * width (`MAX_QUESTIONS=4`), so the bound is INERT at current settings and adds no latency; it engages
 * only when the question count later grows past it. Kept small so a wide future fan-out degrades
 * gracefully under rate-limit/overload instead of stampeding.
 */
export const DEFAULT_RESEARCH_CONCURRENCY = 4;

/**
 * Map `items` through `worker` with at most `limit` calls in flight at once, PRESERVING INPUT ORDER in
 * the returned array — so the caller's record threading + span-emission order is identical to the old
 * unbounded `Promise.all` (issue #189). A ~15-line inline async semaphore: `limit` worker loops each
 * pull the next index until the list is exhausted, so no more than `limit` `worker` promises are ever
 * pending. NO new runtime dependency (anti-slopsquatting). `limit` is clamped ≥1 so a zero/negative cap
 * can never deadlock the fan-out. A worker rejection propagates (the engine evicts a failed step), exactly
 * as `Promise.all` did.
 */
async function mapWithConcurrency<I, O>(
  items: readonly I[],
  limit: number,
  worker: (item: I, index: number) => Promise<O>,
): Promise<O[]> {
  const results = new Array<O>(items.length);
  const cap = Math.max(1, Math.floor(limit));
  let next = 0;
  const runner = async (): Promise<void> => {
    for (let i = next++; i < items.length; i = next++) {
      results[i] = await worker(items[i] as I, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(cap, items.length) }, runner));
  return results;
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
  // The LIVE-RESEARCH sink — 7th positional, AFTER sink. Default no-op (DORMANT curriculum path; no
  // entrypoint drives it). Threaded for parity with runLesson so the shared prelude can't drift.
  researchSink: ResearchSink = noopResearchSink,
  // The CODE-PROGRESS sink — 8th positional, AFTER researchSink. Default no-op. Threaded for PARITY with
  // runLesson (DORMANT curriculum path; inert here) so the two synthesis paths can't drift in how the
  // `code` stage's onProgress hook is wired.
  codeProgressSink: CodeProgressSink = noopCodeProgressSink,
): Promise<PipelineRunResult> {
  const records: LlmCallRecord[] = [];
  const bucket = bucketize(req.settings);
  const models: Record<Stage, StageModel> = { ...STAGE_MODELS, ...(options.models ?? {}) };
  // Emit one span per LLM call, tagged with its stage (per-node analysis stages carry no slug).
  const emit = (stage: Stage, recs: LlmCallRecord[]): void => {
    for (const record of recs) sink.onSpan({ stage, record });
  };

  // 1–2. ANALYSIS prelude: plan + the researcher fan-out (shared with the single-lesson path).
  const { research: allResearch } = await runAnalysisPrelude(
    req,
    engine,
    deps,
    options,
    stages,
    sink,
    records,
    researchSink,
  );
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
    toBuild.map((node) =>
      synthesizeNode(node, req, allSources, bucket, engine, deps, models, stages, sink, codeProgressSink),
    ),
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
  codeProgressSink: CodeProgressSink,
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
    const nodeSpec = { ...specced.spec, nodeSlug: node.slug };
    const coded = await engine.step('code', key, () =>
      stages.code(nodeSpec, lessonBrief.learningGoal, deps, models.code, codeProgressHook(codeProgressSink)),
    );
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
  // The LIVE-RESEARCH sink — best-effort observability, fired FIRE-AND-FORGET below so a slow/failed
  // write adds ZERO latency to the fan-out the run awaits. Default no-op, so every existing caller
  // (CLI, tests, local-dev) reaches NO new code; only the deployed Job injects a PgResearchSink.
  researchSink: ResearchSink = noopResearchSink,
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
  // Announce the REAL deduped/capped questions immediately (live-research generating Stage 1), so the
  // generating UI shows N pending questions before any search returns. FIRE-AND-FORGET: the run never
  // awaits this — a slow/failed write can't delay the fan-out. No fabrication (these are planner output).
  fireResearch(() => researchSink.onQuestions(questions));
  const researchInputs: ResearchInput[] = questions.map((question, i) => ({
    subtopic: subtopics[i % subtopics.length] ?? planned.plan.scope,
    question,
    settings: req.settings,
  }));
  // Fan out the researcher web searches with a BOUNDED concurrency (issue #189) instead of an unbounded
  // `Promise.all`, so a wide question count can't stampede the provider on a `529` overload. The inline
  // semaphore preserves INPUT ORDER, so records/spans thread exactly as before; the per-question
  // `engine.step` memoization key (`contentHash(question, bucket)`) and the fire-and-forget `onResearch`
  // emission (fired as THIS question resolves, never awaited — the `.then` returns `r` synchronously) are
  // unchanged from the old fan-out.
  const concurrency = options.researchConcurrency ?? DEFAULT_RESEARCH_CONCURRENCY;
  const researched = await mapWithConcurrency(researchInputs, concurrency, (input) =>
    engine
      .step('research', contentHash(input.question, bucket), () => stages.research(input, deps, models.researcher))
      .then((r) => {
        fireResearch(() => researchSink.onResearch(input.question, r.research));
        return r;
      }),
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
  // The LIVE-RESEARCH sink — 7th positional, AFTER sink. Default no-op, so the CLI, tests, and the
  // local-dev fallback emit NO live rows; only the deployed Job injects a Postgres-backed PgResearchSink.
  researchSink: ResearchSink = noopResearchSink,
  // The CODE-PROGRESS sink — 8th positional, AFTER researchSink. Default no-op, so the CLI, tests, and the
  // local-dev fallback emit NO live code-progress rows; only the deployed Job injects a PgCodeProgressSink.
  codeProgressSink: CodeProgressSink = noopCodeProgressSink,
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
    researchSink,
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
  const synth = await synthesizeLesson(
    slug,
    briefed.brief,
    req,
    bucket,
    engine,
    deps,
    models,
    stages,
    sink,
    codeProgressSink,
  );
  records.push(...synth.records);

  // 5. assemble a one-tier/one-category/one-page hub (NO assembleHub — that's the curriculum path).
  const built = synth.artifact?.passed ?? false;
  const status = built ? 'built' : 'soon';
  // The DEGRADE REASON (issue #214) — the operator-only WHY, computed at the ONE degrade site. A built
  // run has none. A NULL artifact = an exception ANYWHERE in the spec→code→critic trio (synthesizeLesson
  // wraps the whole trio in one try, so a code truncation/timeout OR a thrown critic call land here) →
  // `synthesis_error`, detail = the caught reason. A non-null artifact graded `passed:false` = the
  // GRACEFUL critic reject → `critic_rejected`, detail = the critique. The split that matters is
  // graceful-reject vs exception, which `criticPassed` alone cannot express (both read criticPassed:false).
  // `detail` is BOUNDED here (`truncateDegradeDetail`) — never an unbounded model string on the log stream.
  let degrade: DegradeReason | undefined;
  if (!synth.artifact) {
    degrade = { gate: 'synthesis', code: 'synthesis_error', detail: truncateDegradeDetail(synth.degraded ?? '') };
  } else if (!synth.artifact.passed) {
    degrade = { gate: 'critic', code: 'critic_rejected', detail: truncateDegradeDetail(synth.artifact.critique) };
  }
  const hub: SitemapHub = {
    tiers: [
      {
        tier: 'Tier 1',
        categories: [
          {
            // href is a placeholder — the read path (rebuildHub) sets the real owner-scoped href.
            // hasHtml mirrors what persistRun writes (`artifact?.html ?? null`) + the read predicate
            // (`<> ''`): a critic-HELD lesson keeps its rendered html (artifact present, passed:false → soon
            // + hasHtml), a synthesis-FAILED one has none (status soon + no html). The AUTHORITATIVE value
            // is re-derived by rebuildHub on read; this pipeline-side flag is never the disposition source. #215
            name: 'Lesson',
            pages: [
              { slug, title: briefTitle(briefed.brief), status, built, hasHtml: Boolean(synth.artifact?.html), href: '' },
            ],
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

  // 6. PRESENTATION METADATA (NOT a pipeline stage) — the card eyebrow + description for the Figma 6:2
  // poster. Derived at the run TAIL, after the lesson is fully synthesized, so it can NEVER affect what
  // is taught. `classifyCategory` is isolated + FAIL-SAFE (it never throws — any fault → category null),
  // so a classifier error or timeout leaves the lesson and its cost untouched; we still thread its tiny
  // record into the cost array like every other LlmCallRecord. The summary is PURE DATA PLUMBING — the
  // brief's already-assembled learningGoal, no extra generation. The category runs on the run's resolved
  // ANALYSIS-tier model (the cheap researcher tier on `--cheap`/CHEAP), never the synthesis arm.
  const classified = await classifyCategory(req.topic, deps, models.researcher);
  records.push(...classified.records);
  emit('researcher', classified.records);

  const costUsd = records.reduce((sum, r) => sum + r.costUsd, 0);
  // Expose the assembled brief so a trace carries it as the analysis row's output (issue #50), plus the
  // card eyebrow (category) + description (summary = the brief's learningGoal) for the library poster.
  return {
    result: { hub, pages },
    records,
    costUsd,
    brief: briefed.brief,
    category: classified.category,
    summary: briefed.brief.learningGoal,
    // Omitted (not `degrade: undefined`) on a built run, mirroring the event-level codeRev spread.
    ...(degrade ? { degrade } : {}),
  };
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
  codeProgressSink: CodeProgressSink,
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
    // The brief carries no slug; pin the artifact to the topic-derived slug here.
    const nodeSpec = { ...specced.spec, nodeSlug: slug };
    // Thread the code-progress hook into the INNER lambda of the memoized step (see codeProgressHook's
    // RESUME SEMANTICS note: a cache-HIT resume fires nothing — accepted, mirrors step_event #61).
    const coded = await engine.step('code', key, () =>
      stages.code(nodeSpec, brief.learningGoal, deps, models.code, codeProgressHook(codeProgressSink)),
    );
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
