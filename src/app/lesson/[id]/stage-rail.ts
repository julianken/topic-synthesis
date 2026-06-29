/**
 * The generating view's STAGE RAIL — the PURE, node-testable core of TS-23.
 *
 * TS-23 upgrades the flat "render only the steps the poll returned so far" timeline (issue #61) into a
 * FIXED six-stage rail with a per-stage ledger, driven entirely by the EXISTING owner-scoped
 * `getStepEvents` poll (no new data path, no durable store, no deploy-topology change — R8). This module
 * is the rail's two pure pieces, pulled out of the `.tsx` so they unit-test in vitest's
 * `environment: 'node'` (no DOM — the same discipline `reader-message.ts` / `lesson-message.ts` use):
 *
 *   1. {@link STAGE_RAIL} — the canonical ordered list of the SIX LIVE single-lesson stages, in
 *      pipeline order, with their human labels. The rail order + labels live HERE in one place.
 *   2. {@link deriveRail} — folds the poll's `StepEvent[]` onto that fixed rail, returning one
 *      {@link RailStage} per canonical stage with its derived state (pending/running/done/error) and
 *      the matched event (if any) for the ledger's timing readout.
 *
 * RETAINED: the rail is the LIVE SINGLE-LESSON stage set ONLY — `plan · research · brief · spec · code ·
 * critic` (`runLesson`, the one live path: the deployed Job, the local-dev fallback, and `npm run
 * skeleton` all run it). There is DELIBERATELY no `graph`/gate/hub stage: `runPipeline`'s graph path is
 * DORMANT (Key decision 9 / ADR-0003 — `runPipeline` is retained, never an entrypoint), so it emits no
 * `step_event` and surfacing a graph rail position would advertise a stage that never fires (a UX lie +
 * concept drift). This tag keeps `scripts/check-concept-drift.sh` green and tells a future reader the
 * omission is intentional, not an oversight. concept-drift-ok: documents the NO-graph omission (decision 9).
 */

/** One step's timing, exactly as the status poll returns it (mirrors `repo.ts` StepEvent). */
export interface StepEvent {
  name: string;
  stepKey: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
}

/** A rail position's derived state. Color-independent — the view conveys it by label + icon/text. */
export type RailState = 'pending' | 'running' | 'done' | 'error';

/** A single canonical rail position: its engine `name`, its human label, and (after derivation) state. */
export interface RailStage {
  /** The engine's step `name` (the `getStepEvents` row's `name`) this rail position matches against. */
  name: string;
  /** The human label rendered in the ledger. */
  label: string;
  /** The derived lifecycle state for this position in the latest poll. */
  state: RailState;
  /** The matched `step_event` (for the ledger's timing readout), or null when the stage is pending. */
  event: StepEvent | null;
}

/**
 * The canonical ordered rail: the SIX LIVE single-lesson stages, in `runLesson` pipeline order. This is
 * the single source of both the rail ORDER and the per-stage human LABEL (the flat-list `STEP_LABEL` map
 * is subsumed here). NO graph/gate/hub entry — see the RETAINED note in this file's header.
 */
export const STAGE_RAIL: ReadonlyArray<{ name: string; label: string }> = [
  { name: 'plan', label: 'Planning' },
  { name: 'research', label: 'Researching' },
  { name: 'brief', label: 'Briefing' },
  { name: 'spec', label: 'Designing' },
  { name: 'code', label: 'Building' },
  { name: 'critic', label: 'Reviewing' },
] as const;

/**
 * Fold the poll's `steps` onto the FIXED six-stage rail, preserving canonical order.
 *
 * PURE: it reads only its arg and `STAGE_RAIL`, and returns a fresh `RailStage[]` (one per canonical
 * stage). For each rail position it AGGREGATES every event with the same `name` into one position — most
 * stages emit a single `step_event`, but `research` is a fan-out: `runPipeline`/`runLesson`'s ANALYSIS
 * prelude runs the researchers with `Promise.all(... engine.step('research', contentHash(question), …))`
 * (`src/pipeline/run-pipeline.ts`), so one poll carries N concurrent `research` rows (N = capped unique
 * research questions), all `name: 'research'` with distinct `step_key`. A last-wins collapse would let
 * the rail's `research` position read "done" off one finished researcher while others were still running
 * — misrepresenting progress — so {@link aggregateEvents} folds the N rows into one phase:
 *   - `error`   — ANY matched event failed (status `'error'`);
 *   - `running` — else ANY matched event is still in-flight (no `finishedAt`, status `'running'`) → live timer;
 *   - `done`    — else ALL matched events finished (→ frozen duration spanning the whole phase);
 *   - `pending` — no matching event in this poll (not started yet → no timer, no duration).
 * The aggregated `event` carries the EARLIEST `startedAt` and the LATEST `finishedAt` across the matched
 * rows, so the ledger's timing readout reflects the whole phase (start of the first researcher → end of
 * the last), not an arbitrary single researcher. Single-event stages aggregate to themselves. Not-yet-
 * started positions still show up front (the "step 3 of 6" sense TS-23 adds). No new data, no graph.
 */
export function deriveRail(steps: ReadonlyArray<StepEvent>): RailStage[] {
  return STAGE_RAIL.map(({ name, label }) => {
    const matched = steps.filter((s) => s.name === name);
    const event = aggregateEvents(matched);
    return { name, label, state: deriveState(event, matched), event };
  });
}

/**
 * Fold all events matching one rail position into a single representative `StepEvent`, or null when none
 * matched. For the common single-event stage this returns that event unchanged. For the `research`
 * fan-out it spans the whole phase: earliest `startedAt`, latest `finishedAt` (null while ANY is still
 * in-flight, so the timer keeps ticking until the last researcher lands), and a status that surfaces the
 * worst lifecycle — `error` if any errored, else `running` if any is unfinished, else `done`.
 */
function aggregateEvents(matched: ReadonlyArray<StepEvent>): StepEvent | null {
  if (matched.length === 0) return null;
  if (matched.length === 1) return matched[0]!;
  const earliestStart = matched.reduce((a, b) => (a.startedAt <= b.startedAt ? a : b)).startedAt;
  const anyUnfinished = matched.some((s) => s.finishedAt === null);
  // The phase ends only when every researcher has finished; until then keep finishedAt null so the
  // running timer reflects the whole phase rather than the first researcher to land.
  const latestFinish = anyUnfinished
    ? null
    : matched.reduce((a, b) => ((a.finishedAt ?? '') >= (b.finishedAt ?? '') ? a : b)).finishedAt;
  const status = matched.some((s) => s.status === 'error')
    ? 'error'
    : anyUnfinished
      ? 'running'
      : 'done';
  return {
    name: matched[0]!.name,
    // The fan-out has no single step_key; expose the count so the ledger can read the phase, not a row.
    stepKey: `${matched[0]!.name}:×${matched.length}`,
    startedAt: earliestStart,
    finishedAt: latestFinish,
    status,
  };
}

/**
 * Derive a rail position's state from its aggregated event + the raw matched rows (null event ⇒ the
 * stage hasn't started). The matched rows let a fan-out report `error`/`running` even when its aggregated
 * `finishedAt` was synthesized; for a single-event stage the two agree.
 */
function deriveState(event: StepEvent | null, matched: ReadonlyArray<StepEvent>): RailState {
  if (event === null) return 'pending';
  if (matched.some((s) => s.status === 'error')) return 'error';
  if (matched.some((s) => s.finishedAt === null && s.status === 'running')) return 'running';
  return 'done';
}

/** Format a millisecond span as a compact duration, e.g. 820ms → "0.8s", 3210ms → "3.2s". */
export function formatDuration(ms: number): string {
  if (ms < 0) return '0.0s';
  return `${(ms / 1000).toFixed(1)}s`;
}

// ── The dispatch marker (the leading "Starting…" indicator — issue #162) ────────────────────────────────

/** The synthetic dispatch marker's engine `name` (mirrors `repo.ts` DISPATCH_STEP_NAME) — written at
 *  dispatch, before the cold-starting Job emits its first real `step_event`. It is NOT a STAGE_RAIL
 *  position, so `deriveRail` ignores it (it never becomes a rail node or a LiveTimer); it surfaces only
 *  as the single leading indicator below. */
export const DISPATCH_STEP_NAME = 'dispatch';

/** The user-facing label for the dispatch marker. The raw `dispatch` identifier is NEVER rendered (the
 *  no-project-internals rule); this label is. */
export const DISPATCH_LABEL = 'Starting…';

/**
 * Is the run in the pre-`plan` DISPATCH WINDOW — the marker has been written but no REAL pipeline step
 * has emitted a `step_event` yet? Drives the single leading "Starting…" indicator. PURE.
 *
 * Returns false the instant ANY non-dispatch step appears, so the indicator YIELDS to the live rail
 * (whose running stage carries the one LiveTimer) — there are never two concurrent live timers. The
 * marker itself is never a LiveTimer regardless (it isn't a rail stage, and it's written non-`running`
 * with a `finished_at`); this guard is what removes the "Starting…" copy once `plan` lands.
 */
export function isStarting(steps: ReadonlyArray<StepEvent>): boolean {
  let hasDispatch = false;
  let hasRealStep = false;
  for (const s of steps) {
    if (s.name === DISPATCH_STEP_NAME) hasDispatch = true;
    else hasRealStep = true;
  }
  return hasDispatch && !hasRealStep;
}
