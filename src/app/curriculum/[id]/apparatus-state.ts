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
 * and introduces NO new postMessage field. The "active section" is DERIVED from `scrollProgress` × the
 * section count (not posted) — so the where-am-i widget + scrubber light up from exactly the data the
 * shipped channel already carries (`{sections, scrollProgress}`); the richer cards (gloss / figure /
 * source / self-check / takeaways) stay best-effort placeholders until PR-F extends the coordinate-only
 * payload + the in-iframe sender pushes their data (NOT this PR).
 */

import type { LessonSection } from './lesson-message';

/** One segment of the where-am-i strip / one scrubber dot — derived purely from the active index. */
export interface SectionMark {
  /** The section's posted id (the React key + the dot's stable handle). */
  id: string;
  /** The section's posted, React-escaped title (the scrubber label `N. <title>`). */
  title: string;
  /** 1-based ordinal for the `N. <title>` label + the `NN / total` readout. */
  ordinal: number;
  /** A section the reader has scrolled PAST (before the active one) — the "done" style + label. */
  done: boolean;
  /** The section the reader is currently in (derived from scrollProgress) — the "active" style + label. */
  active: boolean;
}

/** The where-am-i widget model: the active section's identity + the `NN / total` readout + the strip. */
export interface ApparatusModel {
  /** True when at least one section was posted (a lesson that posts nothing → an empty, usable shell). */
  hasSections: boolean;
  /** The active section's title, or null when nothing has been posted yet (the empty state). */
  activeTitle: string | null;
  /** 1-based active ordinal (0 when no sections) — the left of the `NN / total` readout. */
  activeOrdinal: number;
  /** Total posted sections — the right of the `NN / total` readout. */
  total: number;
  /** Reading progress as an integer percent in [0, 100] — the blurb's legible-by-number readout. */
  percent: number;
  /** One mark per posted section — the strip segments + the scrubber dots (done/active by index). */
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
    activeTitle: activeIndex >= 0 ? sections[activeIndex]!.title : null,
    activeOrdinal: activeIndex >= 0 ? activeIndex + 1 : 0,
    total,
    percent,
    marks,
  };
}
