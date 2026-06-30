/**
 * The workflow EVENT seam (issue #166) — a single, typed, expandable stream every per-step event
 * flows through. Sibling to the `TraceSink` observability port (src/pipeline/ports.ts), NOT an
 * extension of it: `TraceSink.onSpan` is record-shaped (cost/tokens, no wall-clock, feeds eleatic);
 * lifecycle events like `step.start` carry no record. So this is the general stream — `EventSink`
 * fans `WorkflowEvent`s to N adapters (stdout → Cloud Logging, the `step_event` projection for the
 * live generating UI, a no-op for tests). Adding a future per-step event type is a one-line change:
 * add a union variant + emit it; each sink decides whether to project it.
 *
 * Fence-clean by construction (imports only a type) so it rides into the compiled Job bundle.
 */
import type { DegradeCode } from '../domain/degrade';
import type { Stage } from '../llm/models';

/**
 * Bumped when the emitted envelope/field shape changes, so #167's metric extractors can evolve.
 * v3 (#184): the additive optional `codeRev` on `run.complete`/`run.failed` — the commit each run
 * executed (the metrics filter on `eventType` only, so the dashboard survives the bump untouched).
 * v4 (#214): the additive optional `degradeCode` (low-cardinality enum — the `degrade_reason` metric
 * label) + `degradeDetail` (bounded, operator-only free text — NEVER a label) on `run.complete`, the
 * gate-reason channel. Additive on the same precedent: the metrics filter on `eventType` only.
 */
export const EVENT_SCHEMA_VERSION = 4;

/**
 * The canonical `stage` label — the engine step-name vocabulary, which is ALSO the `step_event` /
 * generating-UI vocabulary. Both event families (engine `step.*`, the `llm.call` span bridge) MUST
 * emit `stage` in this set so #167 groups every phase by one label instead of splitting plan/research.
 * (`graph` belongs to the dormant curriculum path; kept for completeness.)
 */
export type CanonicalStage = 'plan' | 'research' | 'graph' | 'brief' | 'spec' | 'code' | 'critic';

/**
 * Normalize a pipeline `Stage` (the `emit→onSpan` vocabulary: `planner`/`researcher`/…) to the
 * canonical engine vocabulary. Only `planner`/`researcher` differ from their engine step names; the
 * rest are identity. Typed as `string` in/out so it also passes through `'judge'` (a TraceStage that
 * is not a `Stage`) and any future tag unchanged.
 */
export function stageLabel(stage: Stage | string): string {
  if (stage === 'planner') return 'plan';
  if (stage === 'researcher') return 'research';
  return stage;
}

/**
 * The events. The discriminant is `eventType`; the common envelope (`runId`, `seq`, `schemaVersion`,
 * `severity`) is stamped by `StdoutEventSink` at write time, not carried here. `stage`/`status`/
 * `model`/`outcome`/`criticPassed` are the low-cardinality fields #167 turns into metric labels.
 */
export type WorkflowEvent =
  | { eventType: 'step.start'; stage: string; stepKey: string }
  | { eventType: 'step.finish'; stage: string; stepKey: string; ms: number; status: 'done' | 'error' }
  | {
      eventType: 'llm.call';
      stage: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
      // PR-1: per-call wall-clock + size, present ONLY for a STREAMED call (the `code` stage). The
      // dashboard (PR-2) + eleatic (PR-3) read these; absent for the blocking analysis-stage calls.
      ttftMs?: number;
      genMs?: number;
      tokensPerSec?: number;
      maxTokens?: number;
      outputBytes?: number;
    }
  | {
      eventType: 'run.complete';
      costUsd: number;
      totalMs: number;
      pages: number;
      outcome: 'complete' | 'degraded';
      criticPassed: boolean;
      // #184: the commit (GIT_SHA) this run executed, baked into the image. Optional — absent off a
      // built image (local `npm run job`). Lets prod telemetry attribute a run to its exact bytes, so a
      // stale-deploy regression (a job image cache-frozen under a fresh SHA tag) is visible after the fact.
      codeRev?: string;
      // #214: the operator-only degrade REASON, present ONLY on a degraded run (omitted when built).
      // `degradeCode` is the low-cardinality enum (SAFE as the `degrade_reason` metric label, disambiguating
      // a graceful critic reject from a synthesis exception — both read `criticPassed:false` otherwise);
      // `degradeDetail` is the bounded critique/error string (OPERATOR-ONLY — NEVER a metric label).
      degradeCode?: DegradeCode;
      degradeDetail?: string;
    }
  | { eventType: 'run.failed'; outcome: 'failed'; errorKind?: string; codeRev?: string };

/**
 * The port. `onEvent` may be sync (the stdout/log sink) OR async (the Postgres `step_event`
 * projection); the engine `await`s it so the projection's ordering guarantee (issue #61: start
 * before finish) is preserved. A sink MUST be best-effort — it must never throw, so telemetry can
 * never break a paid pipeline step.
 */
export interface EventSink {
  onEvent(event: WorkflowEvent): void | Promise<void>;
}

/** The real default — drops every event (no observability overhead). */
export const noopEventSink: EventSink = { onEvent() {} };

/** Fan one event out to every child sink, awaiting any async ones so callers can await the whole set. */
export function multiSink(sinks: readonly EventSink[]): EventSink {
  return {
    async onEvent(event) {
      await Promise.all(sinks.map((s) => s.onEvent(event)));
    },
  };
}
