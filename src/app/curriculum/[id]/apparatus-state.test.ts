import { describe, expect, it } from 'vitest';
import { activeIndexFromProgress, deriveApparatus } from './apparatus-state';
import type { LessonSection } from './lesson-message';

// apparatus-state.test — the node-testable core of the lesson-workspace apparatus panel (PR-B). It
// proves the "active section tracks scrollProgress" contract WITHOUT a renderer (the repo's vitest is
// environment:'node'), the same discipline reader-message.test.ts uses for the reducer. Coordinate-only:
// every assertion is over the SHIPPED {sections, scrollProgress} contract — no DOM, no new posted field.

const SECTIONS: LessonSection[] = [
  { id: 's1', title: 'The tree puzzle' },
  { id: 's2', title: 'Where the mass comes from' },
  { id: 's3', title: 'Splitting water for light' },
  { id: 's4', title: 'Predict, then check' },
];

describe('activeIndexFromProgress', () => {
  it('returns -1 with no sections (the empty state has no active section)', () => {
    expect(activeIndexFromProgress(0, 0)).toBe(-1);
    expect(activeIndexFromProgress(0.5, 0)).toBe(-1);
  });

  it('maps progress 0 to the first section', () => {
    expect(activeIndexFromProgress(0, 4)).toBe(0);
  });

  it('maps progress across the run to the proportional section', () => {
    // 4 sections → quarter-bands: [0,.25)→0, [.25,.5)→1, [.5,.75)→2, [.75,1]→3.
    expect(activeIndexFromProgress(0.1, 4)).toBe(0);
    expect(activeIndexFromProgress(0.3, 4)).toBe(1);
    expect(activeIndexFromProgress(0.6, 4)).toBe(2);
    expect(activeIndexFromProgress(0.9, 4)).toBe(3);
  });

  it('clamps progress exactly 1 to the LAST section (no overflow past the final index)', () => {
    expect(activeIndexFromProgress(1, 4)).toBe(3);
  });

  it('clamps out-of-range progress defensively (belt-and-suspenders over the validator bound)', () => {
    expect(activeIndexFromProgress(-1, 4)).toBe(0);
    expect(activeIndexFromProgress(2, 4)).toBe(3);
  });
});

describe('deriveApparatus', () => {
  it('yields the empty/zero state for no posted sections (decision-13 best-effort)', () => {
    const m = deriveApparatus([], 0);
    expect(m.hasSections).toBe(false);
    expect(m.activeTitle).toBeNull();
    expect(m.activeOrdinal).toBe(0);
    expect(m.total).toBe(0);
    expect(m.percent).toBe(0);
    expect(m.marks).toEqual([]);
  });

  it('lights up the active section title + NN/total + percent from scrollProgress', () => {
    const m = deriveApparatus(SECTIONS, 0.6); // → index 2 (third section)
    expect(m.hasSections).toBe(true);
    expect(m.activeTitle).toBe('Splitting water for light');
    expect(m.activeOrdinal).toBe(3);
    expect(m.total).toBe(4);
    expect(m.percent).toBe(60);
  });

  it('marks sections BEFORE the active one done, the active one active, the rest neither', () => {
    const m = deriveApparatus(SECTIONS, 0.6); // active index 2
    expect(m.marks.map((x) => x.done)).toEqual([true, true, false, false]);
    expect(m.marks.map((x) => x.active)).toEqual([false, false, true, false]);
    // The scrubber labels carry a 1-based ordinal + the posted title (inert, React-escaped at render).
    expect(m.marks.map((x) => x.ordinal)).toEqual([1, 2, 3, 4]);
    expect(m.marks[0]!.title).toBe('The tree puzzle');
  });

  it('rebuilds marks from ids/titles only — no extra fields ride along', () => {
    const m = deriveApparatus(SECTIONS, 0);
    for (const mark of m.marks) {
      expect(Object.keys(mark).sort()).toEqual(['active', 'done', 'id', 'ordinal', 'title']);
    }
  });
});
