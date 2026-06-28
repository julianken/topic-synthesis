import { expect, test } from '@playwright/test';
import { signInAsTestOwner } from './auth';
import { SEED_GENERATING_RUN_ID } from './seed';
import { GENERATING_STATUS_PAYLOAD, GENERATING_STATUS_PAYLOAD_STRESS } from './generating-fixture';

// generating-geometry.spec — the BUILT-APP MEASUREMENT proof for the full-width column-table generating
// view (SPEC §10 item 4 in .superpowers/generating-layout/SPEC.md). The visual.spec captures the SHIPPED
// pixels; THIS spec asserts the four deterministic GEOMETRY GUARANTEES against the REAL rendered DOM of
// the Next.js standalone server (the same deploy entrypoint the harness serves), not the prototype's own
// verifier. It promotes the prototype's control-bar readout into hard E2E assertions, closing the gap the
// review flagged: "the measured Δ0.00px / FITS / LOCKED values were from the prototype, not E2E over the
// real app", and supplies the edge-anchor Δ metric (|edge.sy − src.cy| < 1px, |edge.ey − dst.cy| < 1px)
// that the full-width PR shots could not independently verify.
//
// The four guarantees (SPEC §10.4), measured at the desktop viewport (1440×900) on the BUILT app:
//   (a) COLUMN-LOCK — every phase node's x-center == its stepper header's x-center (|Δ| ≤ 1px). The
//       constructional property of the shared repeat(6,1fr) Grid track set (SPEC §2.1).
//   (b) RESEARCH MARGINS — the rendered Research stack never bleeds to the plane edges: its top AND bottom
//       margin against the plane are each ≥ --gen-col-pad − 1px (the inset-budget guarantee, SPEC §2.3).
//   (c) SPINE UNIFORMITY — the five single-node spine cards (Plan/Brief/Spec/Code/Critic) render the SAME
//       height (max − min ≤ 1px), so the spine reads as one uniform row.
//   (d) EDGE ANCHORS — every drawn edge's source/target endpoint lands on the corresponding node's vertical
//       center: |edge.sy − src.cy| < 1px and |edge.ey − dst.cy| < 1px, measured AFTER the entrance settles
//       (forced reduced motion makes the nodes mount at rest, so there is no +stagger-distance displacement).
//
// Two cases: N=3 (all research visible, no overflow) and N=8 (the fit-math caps at 3 visible and the
// remaining 5 overflow DOWN into the band — the "+K below" chip is reserved inside the column budget). The
// guarantees must hold in BOTH, including with the overflow chip present. Desktop-only: the ≤60rem mobile
// collapse drops the SVG edges + the fixed-height plane by design (SPEC §9), so the geometry model that
// these guarantees describe does not apply there.

/** A measured node rect, plane-local (origin = the plane's top-left), as the edge measurer computes it. */
interface NodeMetric {
  id: string;
  cx: number; // x-center, plane-local
  cy: number; // y-center, plane-local
  top: number; // plane-local top
  bottom: number; // plane-local bottom
  height: number;
}

/** A parsed edge endpoint pair from an SVG path's `M sx sy C …, …, ex ey` command (plane-local px). */
interface EdgeMetric {
  id: string;
  sx: number;
  sy: number;
  ex: number;
  ey: number;
}

/** The geometry the in-browser probe returns for a single render of the generating table. */
interface TableGeometry {
  planeH: number;
  colPad: number;
  /** Per-phase column-lock delta: |node.cx − header.cx| for plan/brief/spec/code/critic (single nodes). */
  columnLock: { phase: string; delta: number }[];
  /** The Research stack's top/bottom margin against the plane (content extent incl. the overflow chip). */
  researchMargins: { top: number; bottom: number };
  /** The five spine cards' rendered heights (Plan/Brief/Spec/Code/Critic). */
  spineHeights: number[];
  /** Every drawn edge with its parsed endpoints + the measured center of its source/target node. */
  edges: { edge: EdgeMetric; srcCy: number | null; dstCy: number | null }[];
  /** The fit readout (visible research nodes + overflow count) for the case assertion. */
  visibleResearch: number;
  overflowChip: string | null;
}

// Probe the BUILT view's geometry directly from the rendered DOM (getBoundingClientRect on the real nodes
// + the SVG path strings), plane-local — the SAME measurement basis the prototype verifier + the edge
// measurer use. Runs in the page so it reads live layout, not React state.
async function measureGeometry(page: import('@playwright/test').Page): Promise<TableGeometry> {
  return page.evaluate(() => {
    const PHASES = ['plan', 'research', 'brief', 'spec', 'code', 'critic'];
    const SPINE = ['plan', 'brief', 'spec', 'code', 'critic'];
    const plane = document.querySelector('.gen-plane');
    const stepper = document.querySelector('.gen-stepper');
    if (!plane || !stepper) throw new Error('generating table not rendered');
    const planeRect = plane.getBoundingClientRect();

    const readToken = (name: string): number => {
      const v = getComputedStyle(plane as Element).getPropertyValue(name).trim();
      const probe = document.createElement('div');
      probe.style.cssText = `position:absolute;visibility:hidden;height:${v || name}`;
      (plane as Element).appendChild(probe);
      const px = probe.getBoundingClientRect().height;
      probe.remove();
      return px;
    };

    const nodeRect = (id: string): NodeMetricLite | null => {
      const el = (plane as Element).querySelector(`[data-node="${id}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        cx: r.left - planeRect.left + r.width / 2,
        cy: r.top - planeRect.top + r.height / 2,
        top: r.top - planeRect.top,
        bottom: r.bottom - planeRect.top,
        height: r.height,
      };
    };
    interface NodeMetricLite {
      cx: number;
      cy: number;
      top: number;
      bottom: number;
      height: number;
    }

    // (a) COLUMN-LOCK — single-node phases (the research column fans, so its per-row x equals the column
    //     center too, but the single spine nodes are the cleanest probe of the shared-track lock).
    const headers = Array.from(stepper.querySelectorAll('.gen-step'));
    const columnLock: { phase: string; delta: number }[] = [];
    PHASES.forEach((phase, ci) => {
      const header = headers[ci]?.getBoundingClientRect();
      if (!header) return;
      const hx = header.left - planeRect.left + header.width / 2;
      // For research, probe the first visible research node; for the rest, the single spine node.
      const probeId = phase === 'research' ? 'research-0' : phase;
      const n = nodeRect(probeId);
      if (!n) return;
      columnLock.push({ phase, delta: Math.abs(n.cx - hx) });
    });

    // (b) RESEARCH MARGINS — the rendered Research stack's content extent (top of the first node → bottom
    //     of the overflow chip if present, else the last node) against the plane.
    const researchCell = (plane as Element).querySelector('.gen-cell[data-phase="research"]');
    const researchNodes = researchCell
      ? Array.from(researchCell.querySelectorAll('.gen-node'))
      : [];
    const chip = researchCell?.querySelector('.gen-overflow') ?? null;
    let researchMargins = { top: 0, bottom: 0 };
    const firstNode = researchNodes[0];
    const lastNode = researchNodes[researchNodes.length - 1];
    if (firstNode && lastNode) {
      const firstTop = firstNode.getBoundingClientRect().top - planeRect.top;
      const lastEl = chip ?? lastNode;
      const lastBottom = lastEl.getBoundingClientRect().bottom - planeRect.top;
      researchMargins = { top: firstTop, bottom: planeRect.height - lastBottom };
    }

    // (c) SPINE UNIFORMITY — the five single-node spine card heights.
    const spineHeights = SPINE.map((p) => nodeRect(p))
      .filter((n): n is NodeMetricLite => n !== null)
      .map((n) => n.height);

    // (d) EDGE ANCHORS — parse each SVG path's `M sx sy C c1x c1y, c2x c2y, ex ey` and pair its endpoints
    //     with the measured centers of the source/target node the edge id encodes (`from->to`).
    const paths = Array.from((plane as Element).querySelectorAll('.gen-plane__edges path'));
    const edges = paths.map((p) => {
      const d = p.getAttribute('d') ?? '';
      // M sx sy C c1x c1y, c2x c2y, ex ey  — grab the leading M coords + the trailing pair.
      const nums = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
      const sx = nums[0] ?? NaN;
      const sy = nums[1] ?? NaN;
      const ex = nums[nums.length - 2] ?? NaN;
      const ey = nums[nums.length - 1] ?? NaN;
      // The view mirrors each edge's `from->to` id onto `data-edge`, so we can pair an endpoint with the
      // measured center of the exact node it connects (not a nearest-neighbour guess).
      const id = p.getAttribute('data-edge') ?? '';
      const [fromId, toId] = id.includes('->') ? id.split('->') : [null, null];
      const src = fromId ? nodeRect(fromId) : null;
      const dst = toId ? nodeRect(toId) : null;
      return {
        edge: { id, sx, sy, ex, ey },
        srcCy: src ? src.cy : null,
        dstCy: dst ? dst.cy : null,
      };
    });

    const visibleResearch = researchNodes.length;
    const overflowChip = chip ? (chip.textContent ?? '').trim() : null;

    return {
      planeH: readToken('--gen-plane-h'),
      colPad: readToken('--gen-col-pad'),
      columnLock,
      researchMargins,
      spineHeights,
      edges,
      visibleResearch,
      overflowChip,
    };
  });
}

// Assert the four SPEC §10.4 guarantees over a measured TableGeometry. Tolerances per the spec:
// column-lock ≤ 1px, research margins ≥ --gen-col-pad − 1px, spine uniformity ≤ 1px, edge anchors < 1px.
function assertGuarantees(geom: TableGeometry): void {
  // (a) COLUMN-LOCK — every probed column ≤ 1px.
  expect(geom.columnLock.length).toBeGreaterThanOrEqual(6);
  const maxLock = Math.max(...geom.columnLock.map((c) => c.delta));
  expect(maxLock, `column-lock Δ (max ${maxLock.toFixed(3)}px over ${JSON.stringify(geom.columnLock)})`).toBeLessThanOrEqual(1.0);

  // (b) RESEARCH MARGINS — both ends clear the inset budget.
  const marginFloor = geom.colPad - 1;
  expect(
    geom.researchMargins.top,
    `research top margin ${geom.researchMargins.top.toFixed(2)}px ≥ ${marginFloor.toFixed(2)}px`,
  ).toBeGreaterThanOrEqual(marginFloor);
  expect(
    geom.researchMargins.bottom,
    `research bottom margin ${geom.researchMargins.bottom.toFixed(2)}px ≥ ${marginFloor.toFixed(2)}px`,
  ).toBeGreaterThanOrEqual(marginFloor);

  // (c) SPINE UNIFORMITY — the five spine cards are one height.
  expect(geom.spineHeights.length).toBe(5);
  const spineSpread = Math.max(...geom.spineHeights) - Math.min(...geom.spineHeights);
  expect(spineSpread, `spine height spread ${spineSpread.toFixed(3)}px over ${JSON.stringify(geom.spineHeights)}`).toBeLessThanOrEqual(1.0);

  // (d) EDGE ANCHORS — every edge endpoint sits on its node's center.
  expect(geom.edges.length, 'at least one edge drawn').toBeGreaterThan(0);
  let maxEdgeDelta = 0;
  for (const e of geom.edges) {
    expect(e.edge.id, 'edge carries a data-edge from->to id').toContain('->');
    expect(e.srcCy, `edge ${e.edge.id} resolves its source node`).not.toBeNull();
    expect(e.dstCy, `edge ${e.edge.id} resolves its target node`).not.toBeNull();
    if (e.srcCy !== null) maxEdgeDelta = Math.max(maxEdgeDelta, Math.abs(e.edge.sy - e.srcCy));
    if (e.dstCy !== null) maxEdgeDelta = Math.max(maxEdgeDelta, Math.abs(e.edge.ey - e.dstCy));
  }
  expect(maxEdgeDelta, `edge-anchor Δ (max ${maxEdgeDelta.toFixed(3)}px)`).toBeLessThan(1.0);
}

test.describe('generating geometry — the four SPEC §10.4 guarantees (BUILT app)', () => {
  // Desktop only — the ≤60rem collapse intentionally drops the edges + the fixed-height plane (SPEC §9),
  // so the geometry model doesn't apply on mobile. Skip the mobile project for this measurement spec.
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'geometry guarantees are a desktop-only model (SPEC §9)');

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('N=3 (no overflow) — column-lock, research margins, spine uniformity, edge anchors', async ({
    page,
    context,
    baseURL,
  }) => {
    await signInAsTestOwner(context, baseURL ?? '');
    await page.route(`**/api/curriculum/${SEED_GENERATING_RUN_ID}/status`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: SEED_GENERATING_RUN_ID, ...GENERATING_STATUS_PAYLOAD }),
      });
    });
    await page.goto(`/curriculum/${SEED_GENERATING_RUN_ID}`);
    await expect(page.getByText('Where does a plant’s mass come from?')).toBeVisible();
    await expect(page.getByText(/2 \/ 3 extracted/)).toBeVisible();
    // Let the layout effect measure + the edges draw (reduced motion → no entrance to wait out).
    await expect.poll(async () => (await measureGeometry(page)).edges.length).toBeGreaterThan(0);

    const geom = await measureGeometry(page);
    expect(geom.visibleResearch, 'N=3 shows all three research nodes').toBe(3);
    expect(geom.overflowChip, 'N=3 has no overflow chip').toBeNull();
    assertGuarantees(geom);
  });

  test('N=8 (overflow → band) — guarantees hold WITH the "+K below" chip reserved', async ({
    page,
    context,
    baseURL,
  }) => {
    await signInAsTestOwner(context, baseURL ?? '');
    await page.route(`**/api/curriculum/${SEED_GENERATING_RUN_ID}/status`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: SEED_GENERATING_RUN_ID, ...GENERATING_STATUS_PAYLOAD_STRESS }),
      });
    });
    await page.goto(`/curriculum/${SEED_GENERATING_RUN_ID}`);
    await expect(page.getByText('Where does a plant’s mass come from?')).toBeVisible();
    await expect.poll(async () => (await measureGeometry(page)).edges.length).toBeGreaterThan(0);

    const geom = await measureGeometry(page);
    // The fit-math caps the visible research stack (3 @ 1440×900) and overflows the rest into the band.
    expect(geom.visibleResearch, 'N=8 caps the visible research column at 3').toBe(3);
    expect(geom.overflowChip, 'N=8 shows the "+5 below" overflow chip').toMatch(/\+5 below/);
    assertGuarantees(geom);
  });
});
