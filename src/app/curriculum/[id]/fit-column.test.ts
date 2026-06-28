import { describe, expect, it } from 'vitest';
import { fitColumn } from './fit-column';

// The fit-math is the load-bearing guarantee of the full-width column-table generating view: the Research
// column's vertical fan ALWAYS fits its fixed-height column at any N, overflowing the remainder DOWN into
// the relocated research band. These assert the SPEC §2.3 / §8 arithmetic over the DOCUMENTED tokens (the
// same values the prototype measured Δ0px-sound) WITHOUT a DOM — the pure core the `.tsx` calls with the
// live-measured token px.

// The documented tokens (SPEC §8): plane 480px, --gen-col-pad 24px each end → usable colH = 432px; gap
// 16px; node FLOOR 104px (the measured 2-line-title content height); CEILING 112px; chip ≈ 24px.
const COL_H = 432;
const GAP = 16;
const MIN_H = 104;
const MAX_H = 112;
const CHIP_H = 24;

describe('fitColumn — the research-column fan fit-math (SPEC §2.3)', () => {
  it('fits a lone node centered (N=1) at the ceiling, no overflow', () => {
    const fit = fitColumn(COL_H, 1, GAP, MIN_H, MAX_H, CHIP_H);
    expect(fit.visible).toBe(1);
    expect(fit.overflow).toBe(0);
    // A single node clamps to the ceiling (ideal = colH ≫ maxH), never balloons to the full column.
    expect(fit.nodeH).toBe(MAX_H);
  });

  it('shows all three when N=3 (the cap), no overflow', () => {
    const fit = fitColumn(COL_H, 3, GAP, MIN_H, MAX_H, CHIP_H);
    expect(fit.visible).toBe(3);
    expect(fit.overflow).toBe(0);
    expect(fit.nodeH).toBe(MAX_H); // 3 @ 112px fits 432px with margin → clamped to the ceiling
  });

  it('caps at 3 visible and overflows the rest into the band (N=5 → 3 + "+2 below")', () => {
    const fit = fitColumn(COL_H, 5, GAP, MIN_H, MAX_H, CHIP_H);
    expect(fit.visible).toBe(3);
    expect(fit.overflow).toBe(2);
    expect(fit.nodeH).toBe(MAX_H);
  });

  it('caps at 3 visible at the STRESS count (N=8 → 3 + "+5 below")', () => {
    const fit = fitColumn(COL_H, 8, GAP, MIN_H, MAX_H, CHIP_H);
    expect(fit.visible).toBe(3);
    expect(fit.overflow).toBe(5);
  });

  it('caps at 3 visible at the EXTREME count (N=14 → 3 + "+11 below")', () => {
    const fit = fitColumn(COL_H, 14, GAP, MIN_H, MAX_H, CHIP_H);
    expect(fit.visible).toBe(3);
    expect(fit.overflow).toBe(11);
  });

  it('GUARANTEE: the visible stack always fits the usable column at every N', () => {
    for (const n of [1, 2, 3, 5, 8, 14, 50]) {
      const fit = fitColumn(COL_H, n, GAP, MIN_H, MAX_H, CHIP_H);
      const stackH = fit.visible * fit.nodeH + (fit.visible - 1) * GAP;
      const chipBand = fit.overflow > 0 ? CHIP_H + GAP : 0;
      // The stack PLUS the reserved overflow-chip band fits the usable column — the core invariant.
      expect(stackH + chipBand).toBeLessThanOrEqual(COL_H + 0.5);
      // visible + overflow accounts for every node, and the node height respects the floor/ceiling.
      expect(fit.visible + fit.overflow).toBe(n);
      expect(fit.nodeH).toBeGreaterThanOrEqual(MIN_H);
      expect(fit.nodeH).toBeLessThanOrEqual(MAX_H);
    }
  });

  it('never returns 0 visible or a negative overflow (degenerate guards)', () => {
    expect(fitColumn(COL_H, 0, GAP, MIN_H, MAX_H, CHIP_H).visible).toBe(1);
    expect(fitColumn(COL_H, 0, GAP, MIN_H, MAX_H, CHIP_H).overflow).toBe(0);
    // A column far too short for even one floor-height node still shows 1 (never 0).
    expect(fitColumn(50, 5, GAP, MIN_H, MAX_H, CHIP_H).visible).toBe(1);
  });
});
