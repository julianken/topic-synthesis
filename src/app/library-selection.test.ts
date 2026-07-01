import { describe, expect, it } from 'vitest';
import { clampSelection, masterState, reconcileBulk } from './library-selection';

// ── The bulk multi-select pure helpers (issue #203) ─────────────────────────────────────────────────
// Mirrors the `library-card.ts` / `library-delete.ts` convention: pure, I/O-free logic in a `.ts` module
// so the tri-state / cap / reconcile math is node-tested directly (vitest `environment: 'node'`), rather
// than left to the browser-only #206 e2e suite. These three functions are the seam the provider's
// selection state + the action bar's master checkbox + the bulk-delete reconcile all read.

describe('masterState — the action bar master checkbox tri-state (AC11)', () => {
  it('reads "none" when nothing is selected, regardless of how many are selectable', () => {
    expect(masterState(0, 0)).toBe('none');
    expect(masterState(0, 5)).toBe('none');
    expect(masterState(0, 150)).toBe('none');
  });

  it('reads "mixed" when some but not all selectable items are selected', () => {
    expect(masterState(1, 5)).toBe('mixed');
    expect(masterState(4, 5)).toBe('mixed');
  });

  it('reads "all" when every selectable item (at or under the cap) is selected', () => {
    expect(masterState(5, 5)).toBe('all');
    expect(masterState(1, 1)).toBe('all');
  });

  it('treats "all selectable UP TO the 100 cap" as "all", even when selectableCount exceeds the cap', () => {
    // 150 selectable lessons exist, but selection is capped at 100 — selecting the max (100) reads "all",
    // never "mixed", because the user has selected everything they're PERMITTED to select.
    expect(masterState(100, 150)).toBe('all');
    // Below the cap ceiling, it's still mixed.
    expect(masterState(99, 150)).toBe('mixed');
  });

  it('respects a custom cap (mirrors clampSelection\'s cap parameter)', () => {
    expect(masterState(10, 20, 10)).toBe('all');
    expect(masterState(9, 20, 10)).toBe('mixed');
  });

  it('reads "none" when there is nothing selectable at all (no registered cards)', () => {
    expect(masterState(0, 0)).toBe('none');
  });
});

describe('clampSelection — the 100-id cap (AC7/AC8)', () => {
  it('caps a 101-id array to exactly 100, preserving order', () => {
    const ids = Array.from({ length: 101 }, (_, i) => `id-${i}`);
    const clamped = clampSelection(ids);
    expect(clamped).toHaveLength(100);
    expect(clamped).toEqual(ids.slice(0, 100));
    expect(clamped[0]).toBe('id-0');
    expect(clamped[99]).toBe('id-99');
  });

  it('leaves an array at or under the cap untouched', () => {
    const ids = ['a', 'b', 'c'];
    expect(clampSelection(ids)).toEqual(['a', 'b', 'c']);
    const atCap = Array.from({ length: 100 }, (_, i) => `id-${i}`);
    expect(clampSelection(atCap)).toEqual(atCap);
  });

  it('respects a custom cap', () => {
    const ids = ['a', 'b', 'c', 'd'];
    expect(clampSelection(ids, 2)).toEqual(['a', 'b']);
  });

  it('handles an empty array', () => {
    expect(clampSelection([])).toEqual([]);
  });
});

describe('reconcileBulk — split selected ids against the server-confirmed affected ids (AC24)', () => {
  it('splits removed (affected) vs reexpand (selected but NOT affected) when affected is a proper subset', () => {
    const selected = ['a', 'b', 'c', 'd'];
    const affected = ['b', 'd'];
    const { removed, reexpand } = reconcileBulk(selected, affected);
    expect(removed).toEqual(['b', 'd']);
    expect(reexpand).toEqual(['a', 'c']);
  });

  it('reexpands nothing when every selected id was affected', () => {
    const selected = ['a', 'b', 'c'];
    const affected = ['a', 'b', 'c'];
    const { removed, reexpand } = reconcileBulk(selected, affected);
    expect(removed).toEqual(['a', 'b', 'c']);
    expect(reexpand).toEqual([]);
  });

  it('reexpands everything when nothing was affected (a total commit failure surfaced as an empty array)', () => {
    const selected = ['a', 'b', 'c'];
    const { removed, reexpand } = reconcileBulk(selected, []);
    expect(removed).toEqual([]);
    expect(reexpand).toEqual(['a', 'b', 'c']);
  });

  it('preserves the ORDER of `selected` in both output arrays (not the order of `affected`)', () => {
    const selected = ['x', 'y', 'z'];
    const affected = ['z', 'x']; // deliberately out of order vs `selected`
    const { removed, reexpand } = reconcileBulk(selected, affected);
    expect(removed).toEqual(['x', 'z']);
    expect(reexpand).toEqual(['y']);
  });

  it('ignores an affected id that was never in the selected set (defensive — never invents a removal)', () => {
    const selected = ['a', 'b'];
    const affected = ['a', 'foreign-id'];
    const { removed, reexpand } = reconcileBulk(selected, affected);
    expect(removed).toEqual(['a']);
    expect(reexpand).toEqual(['b']);
  });

  it('handles an empty selection', () => {
    expect(reconcileBulk([], [])).toEqual({ removed: [], reexpand: [] });
  });
});
