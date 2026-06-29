import type { Research } from '../domain/stages';
import type { Engine } from '../engine/engine';
import type { LlmCallRecord } from '../llm/client';
import type { Stage, StageModel } from '../llm/models';
import type { StoreDeps } from '../store/repo';
import { brief } from './brief';
import { code } from './code';
import { critique } from './critic';
import type { StageDeps } from './deps';
import { buildGraph } from './graph';
import { plan } from './planner';
import { research } from './researcher';
import { spec } from './spec';

/**
 * The pipeline's swap seams, named in one place. Every workflow component is a pluggable
 * adapter behind a port with a real default, so any component can be switched out for a
 * test OR run as an eval A/B arm — a "workflow_version" is a frozen choice across
 * {stages, models, engine}. See docs/decisions/0001 §5.
 *
 *   Component         Port            Swap for testing / eval
 *   ───────────────   ─────────────   ──────────────────────────────────────────────────
 *   Orchestration     Engine.step     InlineEngine (local) ↔ GcpEngine (Postgres) ↔ a
 *                                      fault-injecting engine for crash-resume tests
 *   Stages            StageBundle     swap one stage, e.g. a fixture `graph` (below)
 *   LLM + web search  StageDeps       real ↔ fakes ↔ recorded cassettes ↔ a cheap model
 *   Per-stage model   StageModel      the A/B arm (RunOptions.models)
 *   Store             StoreDeps       Postgres ↔ in-memory (lives in src/store/repo.ts)
 *   Observability     TraceSink       noopSink (default) ↔ SpanCollector→eleatic ↔ an OTel sink
 *   Workflow events   EventSink       noopEventSink (default) ↔ StdoutEventSink (Cloud Logging) ↔
 *                                     PgStepEventSink (step_event) ↔ multiSink([…]) — src/telemetry
 *                                     (issue #166); the SpanToEventSink adapter bridges TraceSink→llm.call
 *   Live research     ResearchSink    noopResearchSink (default) ↔ PgResearchSink (research_event) — the
 *                                     live-research generating feed (#153); fired fire-and-forget
 *   Code progress     CodeProgressSink noopCodeProgressSink (default) ↔ PgCodeProgressSink (code_progress) —
 *                                     the live code-phase bar (#180); the `code` onProgress hook, throttled
 *
 * Known residual limits, so this doesn't over-claim full swappability:
 *  (i)   StageModel.params (effort/thinking/cacheSystem) are carried on an arm but not yet
 *        applied at the client call site, so two arms differing only in params are runtime-
 *        indistinguishable today;
 *  (ii)  searchWeb is Anthropic-only, so a non-Anthropic researcher arm isn't swappable via
 *        StageModel alone;
 *  (iii) StoreDeps is per-call (post-pipeline persistRun), not threaded through runPipeline;
 *  (iv)  TraceSink is an OBSERVABILITY seam, not a workflow_version axis (it can't change the
 *        artifact); its spans carry cost/tokens but no wall-clock (LlmCallRecord has no timing).
 */
export type { Engine, StageDeps, StageModel, StoreDeps };

/**
 * The injectable stage set. One field per LLM stage, each typed as that stage's exact
 * signature via `typeof` — a heterogeneous-by-field interface is the only encoding that
 * preserves the six differing signatures with zero `any` and zero casts. Only the LLM
 * stages are injected; the pure deterministic `coverage-gate` and `hub` are not (they take
 * no model/deps and aren't an eval axis). run-pipeline keeps owning the `engine.step(name,
 * key, fn)` keying + record threading — a StageBundle field is only the function called
 * inside that closure, so swapping a stage can't bypass memoization or cost accounting.
 */
export interface StageBundle {
  plan: typeof plan;
  research: typeof research;
  graph: typeof buildGraph;
  brief: typeof brief;
  spec: typeof spec;
  code: typeof code;
  critic: typeof critique;
}

/** The real stages — the default for every run; a test or eval arm overrides one field. */
export const defaultStages: StageBundle = {
  plan,
  research,
  graph: buildGraph,
  brief,
  spec,
  code,
  critic: critique,
};

/**
 * What produced a trace span: one of the pipeline `Stage`s, OR `'judge'` — the post-pipeline
 * LLM-judge scorer (src/trace/judge.ts). The judge is NOT a pipeline stage (it doesn't produce an
 * artifact, it scores one), so it's deliberately kept off the `Stage` union; but its LLM call still
 * spends real tokens, so it rides the span channel as a distinct tag. A `'judge'` span carries no
 * `nodeSlug`, so `reduceTrace` folds its cost into the `_analysis` row — keeping the row-cost-sums-
 * to-run-cost invariant honest (the judge scores Analysis). The CLI/eval path emits it; run-pipeline
 * never does.
 */
export type TraceStage = Stage | 'judge';

/**
 * One per-LLM-call trace span: which stage (or the judge) produced it, the built node it belongs to
 * (absent for the run-level analysis stages plan/research/graph and the judge), and that call's
 * cost/token record.
 */
export interface TraceSpan {
  stage: TraceStage;
  nodeSlug?: string;
  record: LlmCallRecord;
}

/**
 * The OBSERVABILITY port. runPipeline notifies the sink once per LLM call. The default drops
 * every span, so the Next app (which injects `noopSink`) never reaches the eleatic adapter or its
 * heavy better-sqlite3/express deps; the eval/CLI path injects a `SpanCollector` (src/trace/span.ts)
 * that reduces the spans to an eleatic trace. Swapping the sink never changes the generated
 * artifact — this is observability, not a workflow_version axis.
 */
export interface TraceSink {
  onSpan(span: TraceSpan): void;
}

/** The real default — drops every span (no observability overhead, no eleatic dependency). */
export const noopSink: TraceSink = { onSpan() {} };

/**
 * The LIVE-RESEARCH observability port (live-research generating Stage 1). The researcher fan-out
 * notifies the sink twice: ONCE with all the planned questions (so the generating UI can show N
 * pending questions immediately), then ONCE per question AS its research resolves (so the UI shows a
 * live "M/N answered" with the REAL grounded findings + retrieved sources). Like `TraceSink` this is
 * pure OBSERVABILITY — it never changes the generated artifact, and the run NEVER awaits it on the
 * critical path (run-pipeline fires `void sink.on*().catch(swallow)`, so a slow/failed write adds zero
 * latency and can't fail the fan-out). The default drops everything, so the CLI/local-dev/test paths
 * (and a mis-wired Job) reach NO new code and behave exactly as today; only the deployed Job injects a
 * Postgres-backed sink. A faulty injected sink must be inert by construction (see `noopResearchSink`).
 */
export interface ResearchSink {
  /** Announce the deduped/capped research questions, in fan-out order, before any search returns. */
  onQuestions(questions: string[]): Promise<void>;
  /** A single question's grounded research landed (its findings + retrieved sources). */
  onResearch(question: string, research: Research): Promise<void>;
}

/** The real default — drops every live-research event (no DB, no live rows; the generating UI then
 *  shows only the stage-rail timeline). The Next app, the CLI, and every test inject this. */
export const noopResearchSink: ResearchSink = {
  async onQuestions() {},
  async onResearch() {},
};

/**
 * The LIVE CODE-PHASE PROGRESS port (PR-4 / issue #180) — the streaming `code` stage's `onProgress` hook
 * (PR-1, #174) drives this so the generating UI can show a learner-safe "Writing the lesson…" bar while
 * the longest phase (~83% of run wall-clock) is opaque. A PARALLEL, narrower instance of the `ResearchSink`
 * shape: pure OBSERVABILITY (it never changes the artifact), fired FIRE-AND-FORGET so a slow/failed write
 * adds ZERO latency and can't fail the paid `code` stream. UNLIKE `ResearchSink`, `onProgress` is
 * SYNCHRONOUS void — it mirrors the per-delta hook (called thousands of times over ~270s), so a Postgres
 * adapter must COALESCE writes internally (throttle + fire-and-forget) rather than await per delta.
 *
 * NO-INTERNALS by construction: the payload carries `outputTokens`/`maxTokens` (the raw stream counters),
 * but a real adapter computes a bounded `fraction = outputTokens / maxTokens` IN THE SINK and stores/serves
 * ONLY that fraction — never the raw token count, the cap, a cost, or a model id (the same denormalize-in-
 * sink discipline `PgResearchSink` uses to keep the internal `sourceIndex` off the wire). The default drops
 * everything, so the CLI/local-dev/test paths reach NO new code; only the deployed Job injects a
 * Postgres-backed sink. A faulty injected sink must be inert by construction (see `noopCodeProgressSink`).
 */
export interface CodeProgressSink {
  /** A code-stream progress sample (per delta). Synchronous void — the adapter coalesces + writes
   *  fire-and-forget internally so the paid stream is never awaited or blocked. */
  onProgress(p: { outputTokens: number; elapsedMs: number; maxTokens: number; phase: 'prefill' | 'generating' }): void;
}

/** The real default — drops every code-progress sample (no DB, no live bar; the generating UI then shows
 *  only the running-code stage's elapsed timer). The Next app, the CLI, and every test inject this. */
export const noopCodeProgressSink: CodeProgressSink = { onProgress() {} };
