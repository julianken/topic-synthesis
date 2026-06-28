/**
 * The apparatus panel's PURE derivation core (lesson-workspace PR-B) — the node-testable function that
 * turns the SHIPPED coordinate-only reader state (`{ scrollProgress, sections }`, the unchanged
 * `lesson-message.ts` contract surfaced by `reduceReaderMessage`) into the where-am-i widget + scrubber
 * model the apparatus panel renders. It exists for the same reason `reader-message.ts` does: the repo's
 * vitest runs in `environment: 'node'` with no DOM, so the `.tsx` panel can't mount there — pulling the
 * arithmetic out into a pure `state → model` function lets the "active section tracks scrollProgress"
 * contract be unit-tested without a renderer.
 *
 * COORDINATE-ONLY (the non-negotiable trust boundary): this reads ONLY the two posted scalars — the
 * `sections` list (id + title) and the `scrollProgress` number in [0, 1]. It NEVER reads the iframe DOM
 * and introduces NO new postMessage field. The richer cards (gloss / figure / source / self-check /
 * takeaways) stay best-effort placeholders until a future pass extends the coordinate-only payload + the
 * in-iframe sender pushes their data (NOT this PR).
 *
 * HONESTY OF THE "WHERE-AM-I" CUE (the reviewer's MAJOR data-contract finding, resolved). The shipped
 * channel carries only an OVERALL `scrollProgress` scalar — there is NO per-section position, no posted
 * active-section id/index. So this derivation deliberately does NOT claim a confident, tracked discrete
 * "you are in section N of M": deriving a precise `NN/total` from one overall scalar would be a fabricated
 * mapping (AGENTS.md anti-invention; DESIGN.md §Lesson layout decision 1 "where-am-I/progress cue"). What
 * IS truthful from `{sections, scrollProgress}` and all this returns is: (a) the OVERALL percent (the
 * posted scalar verbatim), (b) the full section LIST (posted verbatim), and (c) an APPROXIMATE position —
 * `floor(scrollProgress × count)` — surfaced explicitly as an estimate ("≈ section N", `approximate:true`)
 * for the strip fill + a soft highlight, never as a hard tracked "current section" readout. When the
 * payload later carries a real active-section signal, the cue can be promoted to exact (and `approximate`
 * flipped to false) without changing the channel's trust discipline.
 */

import type { LessonSection } from './lesson-message';

/** One segment of the where-am-i strip / one scrubber dot — derived purely from the approximate index. */
export interface SectionMark {
  /** The section's posted id (the React key + the dot's stable handle). */
  id: string;
  /** The section's posted, React-escaped title (the scrubber label `N. <title>`). */
  title: string;
  /** 1-based ordinal for the `N. <title>` label. */
  ordinal: number;
  /** A section BEFORE the approximate position (overall progress has passed it) — the "done" style/label. */
  done: boolean;
  /** The APPROXIMATE current section (estimated from overall scrollProgress, NOT a posted active-section
   *  signal — see the file header). Surfaced as a soft "≈ here" hint, never a hard tracked readout. */
  active: boolean;
}

/** The where-am-i widget model. From `{sections, scrollProgress}` only the OVERALL percent + the section
 *  LIST are exact; the position is an ESTIMATE (`approximate`), so the widget shows "≈ section N", never a
 *  confident `NN/total` tracked count (the reviewer's MAJOR finding — honest degradation). */
export interface ApparatusModel {
  /** True when at least one section was posted (a lesson that posts nothing → an empty, usable shell). */
  hasSections: boolean;
  /** True whenever the position is INFERRED from the overall scalar (i.e. always, with today's contract) —
   *  the widget renders the "≈"/estimated framing while this is true. Flips false only when a future payload
   *  carries a real active-section signal. */
  approximate: boolean;
  /** The APPROXIMATE current section's title, or null when nothing has been posted yet (the empty state). */
  activeTitle: string | null;
  /** 1-based approximate-position ordinal (0 when no sections) — shown as "≈ section N", not a tracked count. */
  activeOrdinal: number;
  /** Total posted sections — the "of M" the approximate position is stated against. */
  total: number;
  /** Reading progress as an integer percent in [0, 100] — the EXACT, posted legible-by-number readout. */
  percent: number;
  /** One mark per posted section — the strip segments + the scrubber dots (done/active by approximate index). */
  marks: SectionMark[];
}

/**
 * Derive the active section index from the posted `scrollProgress` (0..1) and the section count.
 *
 * The map is `floor(scrollProgress × count)`, clamped to the last index so a `scrollProgress` of exactly
 * `1` lands on the final section rather than overflowing. With no sections the index is `-1` (no active).
 * This is the SOLE place the active section is computed — coordinate-only (count + scalar), never a DOM
 * read and never a posted field.
 */
export function activeIndexFromProgress(scrollProgress: number, count: number): number {
  if (count <= 0) return -1;
  // Defensive clamp: the validator already bounds scrollProgress to [0, 1], but keep the arithmetic total.
  const p = Math.min(1, Math.max(0, scrollProgress));
  return Math.min(count - 1, Math.floor(p * count));
}

/**
 * Fold the SHIPPED reader state into the apparatus model. PURE: reads only `sections` + `scrollProgress`,
 * returns a fresh model. An empty `sections` list yields the empty/zero state (the decision-13 best-effort
 * contract — a lesson posting nothing leaves every widget empty and the shell fully usable).
 */
export function deriveApparatus(sections: LessonSection[], scrollProgress: number): ApparatusModel {
  const total = sections.length;
  const activeIndex = activeIndexFromProgress(scrollProgress, total);
  const percent = Math.round(Math.min(1, Math.max(0, scrollProgress)) * 100);

  const marks: SectionMark[] = sections.map((section, i) => ({
    id: section.id,
    title: section.title,
    ordinal: i + 1,
    done: i < activeIndex,
    active: i === activeIndex,
  }));

  return {
    hasSections: total > 0,
    // With today's contract the position is ALWAYS inferred from the overall scalar — there is no posted
    // active-section signal — so the cue is always approximate. A future payload extension flips this false.
    approximate: true,
    activeTitle: activeIndex >= 0 ? sections[activeIndex]!.title : null,
    activeOrdinal: activeIndex >= 0 ? activeIndex + 1 : 0,
    total,
    percent,
    marks,
  };
}
