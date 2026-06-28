/**
 * The generating view's FIT-MATH — the PURE, node-testable core of the full-width column-table layout
 * (`.superpowers/generating-layout/` SPEC §2.3). It is pulled out of the `.tsx` so it unit-tests in
 * vitest's `environment: 'node'` (no DOM, no React — the same discipline `stage-rail.ts` /
 * `research-graph.ts` / `lesson-message.ts` use).
 *
 * The problem it solves: the Research column is a vertical FAN of N nodes inside a fixed-height plane. At
 * high N a naive stack overflows the column (the bottom node escapes the box). The fix makes node height a
 * PURE FUNCTION of column height and count, capped, with the remainder overflowed DOWN into the relocated
 * full-width research band — so the column ALWAYS fits at any N, with no per-node magic px.
 */

/** The result of fitting `count` nodes into a column of usable height `colH`. */
export interface FitResult {
  /** How many research nodes to DRAW in the column (the rest overflow to the band). */
  visible: number;
  /** The remainder (N − visible) → the relocated research band, as queued cards. */
  overflow: number;
  /** The drawn node height (px) for each visible research node, clamped to [minH, maxH]. */
  nodeH: number;
}

/**
 * Within a column of usable height `colH` holding `count` nodes (vertical gap `g`, node height ∈
 * [minH, maxH]): fit as many as possible at the floor height, overflow the remainder.
 *
 * THE OVERFLOW-CHIP RESERVATION (the load-bearing correction, SPEC §2.3). When overflow>0 the column ALSO
 * renders a "+K below" chip inside the same centered cell as the visible nodes — so the chip's height
 * (`chipH`) + one inter-node gap (`g`) are part of the cell's content and MUST be reserved, or the stack +
 * chip together overspill the centered cell. Two passes resolve the mutual dependency (does-it-overflow ⇄
 * reserve-the-chip):
 *   - pass 1: does the FULL column overflow at the floor height?
 *   - pass 2: if so, reserve the chip band (chipH + g) before recomputing how many fit.
 * The reservation is monotone (reserving the chip can only lower the fit, which can only raise the
 * overflow), so the overflow decision never oscillates.
 *
 * PURE: reads only its args; no DOM, no magic numbers. `chipH` defaults to 0 (used by the off-DOM tests +
 * the no-overflow path); the live view passes the MEASURED chip height.
 */
export function fitColumn(
  colH: number,
  count: number,
  g: number,
  minH: number,
  maxH: number,
  chipH = 0,
): FitResult {
  const safeCount = Math.max(1, count);
  // How many nodes fit at the FLOOR height in a column of height H?  k·minH + (k−1)·g ≤ H.
  const fitCount = (H: number): number => Math.max(1, Math.floor((H + g) / (minH + g)));
  const overflowsRaw = safeCount > fitCount(colH); // pass 1
  const effColH = overflowsRaw ? colH - (chipH + g) : colH; // pass 2: reserve the chip band if so
  const maxFit = fitCount(effColH);
  const visible = Math.min(safeCount, maxFit);
  const overflow = Math.max(0, count) - visible;
  // Distribute the EFFECTIVE column evenly across the visible nodes, clamped to [minH, maxH].
  const ideal = (effColH - (visible - 1) * g) / visible;
  const nodeH = Math.max(minH, Math.min(ideal, maxH));
  return { visible, overflow: Math.max(0, overflow), nodeH };
}
