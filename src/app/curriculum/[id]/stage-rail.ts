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
 * stage). For each rail position it matches the LATEST event with the same `name` (the engine writes one
 * `step_event` per stage `name`; a resumed run never duplicates a name — issue #61), then derives:
 *   - `error`   — the matched event's status is `'error'` (failed; may carry a partial duration);
 *   - `running` — matched, no `finishedAt`, status `'running'` (the one in-flight stage → live timer);
 *   - `done`    — matched and finished (→ frozen duration);
 *   - `pending` — no matching event in this poll (not started yet → no timer, no duration).
 * This is the SAME per-event state the flat-list `TimelineStep` computed, re-homed onto the fixed rail so
 * not-yet-started positions show up front (the "step 3 of 6" sense TS-23 adds). No new data, no graph.
 */
export function deriveRail(steps: ReadonlyArray<StepEvent>): RailStage[] {
  return STAGE_RAIL.map(({ name, label }) => {
    // The engine emits at most one event per stage `name`; if a poll somehow carries more (it doesn't
    // today), the last in poll order wins so a freshly-started/finished state isn't masked by an older one.
    let event: StepEvent | null = null;
    for (const s of steps) {
      if (s.name === name) event = s;
    }
    return { name, label, state: deriveState(event), event };
  });
}

/** Derive a single rail position's state from its matched event (null ⇒ the stage hasn't started). */
function deriveState(event: StepEvent | null): RailState {
  if (event === null) return 'pending';
  if (event.status === 'error') return 'error';
  if (event.finishedAt === null && event.status === 'running') return 'running';
  return 'done';
}

/** Format a millisecond span as a compact duration, e.g. 820ms → "0.8s", 3210ms → "3.2s". */
export function formatDuration(ms: number): string {
  if (ms < 0) return '0.0s';
  return `${(ms / 1000).toFixed(1)}s`;
}
