/**
 * The owner-only "How this was built" disclosure — the PURE, node-testable core (issue #175, epic PR-5).
 *
 * Post-run, the owner (who in this private-per-user app is also the learner) gets a quiet, collapsed
 * `<details>` on the persisted lesson page that expands to the FROZEN six-stage rail: a learner-safe
 * per-step timing + status replay of how the lesson was built. It is made durable by KEEPING `step_event`
 * past persist (the prune was removed in `repo.ts`); this module folds that timeline into a render model.
 *
 * Like `stage-rail.ts` / `lesson-message.ts`, the math lives HERE (a `.ts`, no JSX) so it unit-tests in
 * vitest's `environment: 'node'` (no DOM); the thin `.tsx` view (`build-summary.tsx`) renders this model.
 *
 * TWO HARD CONSTRAINTS this module enforces by construction (issue #175 §1, the no-project-internals rule):
 *   1. LEARNER-SAFE WORDS ONLY. The rail rows use {@link LEARNER_LABEL} — Planning / Researching / Drafting
 *      / Designing / Building / Reviewing — NEVER the raw engine stage names (plan/research/brief/spec/code/
 *      critic). This is its OWN label map, intentionally NOT `stage-rail.ts`'s `STAGE_RAIL.label` (whose
 *      "Briefing" we replace with "Drafting" per the issue's enumerated words), and never the lowercase
 *      `stage.name` the LIVE generating progress bar shows (that surface is ephemeral; a reading surface
 *      isn't).
 *   2. TIMELINE-ONLY. The model carries ONLY durations + status — NO token/cost/model/TTFT/ms anywhere
 *      (that deep data lives in the dashboard + eleatic, never on a reading surface). `step_event` is
 *      structurally leak-proof (it has no such column), and this model never invents one.
 *
 * Owner-gate: there is NONE here, deliberately. The disclosure is server-rendered co-located under the
 * page's existing `getLesson(id, identity.sub)` filter (which 404s a foreign id BEFORE render), so it
 * inherits the owner gate for free — no new route, no new gate, no `ownsRun` (run_owner is pruned at
 * persist, so an `ownsRun` gate would 404 every completed run).
 */

import { deriveRail, formatDuration, type RailState, type StepEvent } from './stage-rail';

/**
 * The learner-safe label for each engine stage `name` — the ONLY stage words this reading surface shows.
 * Keyed by the engine step `name` (the `getStepEvents` row's `name` / `STAGE_RAIL` name), so it stays in
 * lockstep with `deriveRail`'s output. NEVER the raw identifier: "Drafting" (not "brief"/"Briefing"),
 * "Designing" (not "spec"), "Building" (not "code"), "Reviewing" (not "critic"). The copy-gate test pins
 * that none of the raw names leak through this surface.
 */
export const LEARNER_LABEL: Record<string, string> = {
  plan: 'Planning',
  research: 'Researching',
  brief: 'Drafting',
  spec: 'Designing',
  code: 'Building',
  critic: 'Reviewing',
};

/** A frozen rail row's status affordance — glyph + a state WORD (status by label + icon, never colour
 *  alone, §Color & contrast). At rest a row is `done`/`error`/`didn't run`; `running` can't survive a
 *  persisted run but is mapped defensively so a straggler never renders blank. */
interface RowAffordance {
  glyph: string;
  word: string;
}
const ROW_AFFORDANCE: Record<RailState, RowAffordance> = {
  done: { glyph: '✓', word: 'done' },
  // A per-STAGE ✗ appears ONLY where a step actually threw (`step_event.status='error'`); a graceful
  // critic-vapid / coverage degrade leaves every step `done` under a degraded summary (no failed stage).
  error: { glyph: '✗', word: "didn't finish" },
  running: { glyph: '◷', word: 'in progress' },
  pending: { glyph: '—', word: "didn't run" },
};

/** One frozen rail row in the expanded disclosure. */
export interface BuildRow {
  /** The engine stage `name` (a stable key for React + tests) — NEVER rendered to the user. */
  name: string;
  /** The derived lifecycle state — a `data-state` hook so CSS can tint the glyph (the colour is
   *  SUPPLEMENTARY; the glyph + state word carry the meaning, never colour alone). */
  state: RailState;
  /** The learner-safe label (from {@link LEARNER_LABEL}) — the ONLY stage word shown. */
  label: string;
  glyph: string;
  /** The screen-reader / legible state word (status by label + icon, never colour alone). */
  word: string;
  /** The frozen per-step duration (e.g. "2.1s"), or null for a stage that didn't run / has no end. */
  duration: string | null;
}

/**
 * The terminal disposition of a finished run — the honest three-way state (issue #215), derived in the
 * read path from `(page status, html presence)`:
 *   - `built`  — `status='built'`: a real interactive page was accepted.
 *   - `held`   — `status='soon'` WITH html present: the reviewer HELD it back (rendered but not accepted).
 *   - `failed` — `status='soon'` WITHOUT html: synthesis genuinely FAILED to produce an artifact.
 * It replaces the old 2-way `degraded: boolean`, which conflated "held back" with "couldn't finish" and
 * made the all-✓ rail contradict a "couldn't finish" header.
 */
export type LessonDisposition = 'built' | 'held' | 'failed';

/** The render model for the disclosure (or `null` when there is nothing to disclose — see
 *  {@link buildSummaryModel}). All strings are learner-safe + timeline-only by construction. */
export interface BuildSummaryModel {
  /** The honest three-way terminal disposition. Drives the headline + summary copy, and (in the view) the
   *  `data-degraded`/`data-disposition` hooks. A non-`built` disposition is the "degraded" branch. */
  disposition: LessonDisposition;
  /** The collapsed summary's lead: "How this was built" (built) | "See what happened" (held/failed). */
  headline: string;
  /** The middle dot-separated summary parts — e.g. ["built in 47s", "6 steps"] (built), ["held back for
   *  review"] (held), or ["couldn't finish"] (failed). Timeline-only; never a token/cost/model figure. */
  metaParts: string[];
  /** The summary verdict glyph — "✓" (built) | "✗" (held/failed). Paired with {@link verdictWord} so the
   *  status is never colour alone. */
  verdictGlyph: string;
  /** The summary verdict word — "passed" (built) | "not published" (held) | "not built" (failed). */
  verdictWord: string;
  /** The frozen six-stage rail rows, in pipeline order. */
  rows: BuildRow[];
}

/** Format a whole-second wall-clock span for the summary headline ("built in 47s"). Per-step rows keep
 *  the one-decimal `formatDuration` ("2.1s"); the headline rounds to whole seconds to match the copy. No
 *  "ms" unit ever appears (the copy-gate pins that). */
export function formatWholeSeconds(ms: number): string {
  return `${String(Math.max(0, Math.round(ms / 1000)))}s`;
}

/**
 * Fold a run's `step_event` timeline into the disclosure's render model — or `null` when there is nothing
 * worth disclosing (no real stage ran: a legacy lesson persisted before #175 pruned step_event, or a blob
 * lesson that emitted no events). Returning null keeps the page from rendering an all-"didn't run" shell.
 *
 * PURE: reads only its args (+ `deriveRail` over `STAGE_RAIL`). The wall-clock span and the per-step
 * durations are computed from the SIX real rail stages only — never the `dispatch` marker (`deriveRail`
 * already excludes it), so the count stays the honest six and the span is the plan→critic build time.
 *
 * @param events the run's `step_event` rows (from `getStepEvents`); the dispatch marker is ignored.
 * @param disposition the run's honest terminal state (`built | held | failed`, issue #215) — drives the
 *        headline + summary copy + verdict. `held`/`failed` are the two "degraded" (non-`built`) kinds.
 */
export function buildSummaryModel(
  events: ReadonlyArray<StepEvent>,
  disposition: LessonDisposition,
): BuildSummaryModel | null {
  const rail = deriveRail(events);
  const ran = rail.filter((s) => s.event !== null);
  // Nothing actually ran (legacy / blob lesson) — no timeline to disclose.
  if (ran.length === 0) return null;

  const rows: BuildRow[] = rail.map((stage) => {
    const aff = ROW_AFFORDANCE[stage.state];
    const ev = stage.event;
    const duration =
      ev && ev.finishedAt !== null
        ? formatDuration(new Date(ev.finishedAt).getTime() - new Date(ev.startedAt).getTime())
        : null;
    return {
      name: stage.name,
      state: stage.state,
      // Fall back to a Title-Cased name only if an unknown stage ever appears (never on the six) — still
      // never the raw lowercase identifier on the surface.
      label: LEARNER_LABEL[stage.name] ?? stage.label,
      glyph: aff.glyph,
      word: aff.word,
      duration,
    };
  });

  // The wall-clock build span: earliest start → latest finish across the stages that ran. Frozen (no live
  // timer) since a persisted run is at rest.
  const starts = ran.map((s) => new Date(s.event!.startedAt).getTime());
  const ends = ran.flatMap((s) => (s.event!.finishedAt ? [new Date(s.event!.finishedAt).getTime()] : []));
  const spanText =
    ends.length > 0 ? formatWholeSeconds(Math.max(...ends) - Math.min(...starts)) : null;

  const stepCount = ran.length;
  // Per-disposition copy. `held` reads HONESTLY — the reviewer held it back (every stage ran, ✓ rail), it
  // is just not published — NEVER "couldn't finish", which only `failed` (no artifact produced) earns.
  // The summary ✗ on held/failed reflects "didn't build" (the page status is `soon`), consistent with the
  // per-STAGE rail which stays all-✓ on a graceful hold (no thrown stage) — so header + rail agree. #215.
  const SUMMARY_COPY: Record<
    LessonDisposition,
    { headline: string; verdictGlyph: string; verdictWord: string }
  > = {
    built: { headline: 'How this was built', verdictGlyph: '✓', verdictWord: 'passed' },
    held: { headline: 'See what happened', verdictGlyph: '✗', verdictWord: 'not published' },
    failed: { headline: 'See what happened', verdictGlyph: '✗', verdictWord: 'not built' },
  };
  const metaParts: string[] =
    disposition === 'built'
      ? [
          ...(spanText ? [`built in ${spanText}`] : []),
          `${String(stepCount)} ${stepCount === 1 ? 'step' : 'steps'}`,
        ]
      : disposition === 'held'
        ? ['held back for review']
        : ["couldn't finish"];

  return {
    disposition,
    headline: SUMMARY_COPY[disposition].headline,
    metaParts,
    verdictGlyph: SUMMARY_COPY[disposition].verdictGlyph,
    verdictWord: SUMMARY_COPY[disposition].verdictWord,
    rows,
  };
}
