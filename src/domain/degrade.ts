/**
 * The first-class REASON a run was routed away from `built` — the verdict's "why", not just its bit
 * (issue #214). The observability triad already records the verdict BIT everywhere (`criticPassed`,
 * `outcome`), but had no channel for the verdict's REASON, so "is the critic over-rejecting, and why?"
 * was unanswerable after the fact (the critique string was dropped at every durable boundary).
 *
 * It is TELEMETRY, NEVER durable state: computed at the `runLesson` degrade site, threaded onto
 * `PipelineRunResult`, and emitted OPERATOR-SIDE only on the `run.complete` Cloud-Logging event. It is
 * deliberately NOT a Postgres column and NOT a learner surface — the owner-readable stores carry no
 * raw-model-text column (the leak-safe boundary; see the `step_event` "structurally leak-proof" note in
 * `src/store/repo.ts`), and a durable `critique TEXT` column was explicitly rejected. A built run has
 * no `DegradeReason`.
 *
 * Split by cardinality, mirroring the existing `outcome` / `errorKind` shape: a low-cardinality `code`
 * (safe as a metric label) + an operator-only `detail` free-text (the bounded critique/error string;
 * NEVER a metric label). This file is a leaf domain module — pure types + a pure truncation helper, no
 * I/O — so it stays fence-clean and imports nowhere (the `WorkflowEvent` seam imports `DegradeCode` as
 * a type only).
 */

/**
 * Low-cardinality degrade taxonomy — SAFE as a metric label (the `degrade_reason` counter's `code`).
 * - `critic_rejected` — the GRACEFUL fail: the critic ran and returned `passed:false` over a NON-null
 *   artifact (the muscle-hypertrophy incident, run `8c064bca…`: a clean, complete page graded fail).
 * - `synthesis_error` — ANY throw in the `spec → code → critic` trio: `synthesizeLesson` wraps the whole
 *   trio in one `try`, so a `code`-stage truncation/timeout throw OR a thrown critic call both land here
 *   (a null artifact). The two codes are NOT perfectly orthogonal — a thrown critic call is
 *   `synthesis_error`, not `critic_rejected` — but the split that matters is graceful-reject vs
 *   exception, which `criticPassed` alone cannot express today (both read `criticPassed:false`).
 * - `coverage_below_threshold` — RESERVED (document-but-don't-emit). The dormant curriculum path's
 *   `coverage-gate` would route a node away from `built` here; no LIVE producer emits it today, so its
 *   matching `gate` (`'coverage'`) is intentionally absent from {@link DegradeReason} until that path
 *   wakes (see GAPS.md → the "every gate emits a DegradeReason" deferred row).
 */
export type DegradeCode = 'critic_rejected' | 'synthesis_error' | 'coverage_below_threshold';

/**
 * Why a run degraded. `gate` names the quality gate that routed it away from `built`; `code` is the
 * low-cardinality reason (the metric label); `detail` is the bounded, OPERATOR-ONLY human-readable
 * string (the critique text or the error message). `gate` is `'critic' | 'synthesis'` — the only two
 * LIVE producers today; the reserved `coverage_below_threshold` code's `'coverage'` gate lands with the
 * dormant curriculum path, not here.
 */
export interface DegradeReason {
  gate: 'critic' | 'synthesis';
  code: DegradeCode;
  /**
   * The bounded reason text — the critic's `critique` (a graceful reject) or the caught error message
   * (a synthesis exception), truncated to {@link DEGRADE_DETAIL_MAX}. OPERATOR-ONLY: it reaches Cloud
   * Logging via `degradeDetail` on `run.complete`, and is NEVER a metric label and NEVER a durable
   * column. Optional so a producer with no human-readable reason can omit it.
   */
  detail?: string;
}

/**
 * Hard cap on `DegradeReason.detail` before it reaches the log stream. `degradeDetail` is the FIRST
 * field-class of raw model text on the structured logs (no existing `WorkflowEvent` writes free model
 * text — `run.failed` carries a class name, `llm.call` carries cost/tokens), so its bound is explicit,
 * named, and unit-tested rather than incidental — never an unbounded model string on the log stream.
 */
export const DEGRADE_DETAIL_MAX = 500;

/**
 * Truncate a degrade `detail` to {@link DEGRADE_DETAIL_MAX}, leaving a shorter string untouched. The
 * single place the cap is enforced — every producer (the degrade site, any future gate) routes its
 * detail through this so the bound can't be forgotten at one call site.
 */
export function truncateDegradeDetail(detail: string): string {
  return detail.length > DEGRADE_DETAIL_MAX ? detail.slice(0, DEGRADE_DETAIL_MAX) : detail;
}
