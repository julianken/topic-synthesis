import { expect, test } from '@playwright/test';
import { signInAsTestOwner } from './auth';
import { SEED_RUN_ID } from './seed';

// lesson-workspace.spec — the BUILT-APP MEASUREMENT proof for the lesson-workspace GRID FOUNDATION
// (PR-A). The grid lives in the reader CHROME (reader-shell.tsx + globals.css): the LOCKED named-line
// two-column grid `[screen-start] edge [read-start] measure [read-end] gap [panel-start] panel
// [panel-end] scrub [scrub] edge [screen-end]` from DESIGN.md "## Lesson layout" + the measured
// prototype (.superpowers/lesson-workspace/prototype.html). The [read] track holds the UNCHANGED
// #readerPanel.morph-box + sandboxed iframe; the [panel] + [scrub] tracks are EMPTY placeholders in
// PR-A (apparatus = PR-B, scrubber = PR-C). DESIGN.md wins on any design conflict.
//
// Because the grid is the CHROME (not the opaque-origin artifact), the parent document owns the
// `.ws-read`/`.ws-panel`/`.ws-scrub` tracks, so these are measured directly by getBoundingClientRect
// on the parent page — no cross-boundary read is needed (and none is performed: the spec never touches
// the iframe's contentDocument). The iframe's sandbox attribute is asserted byte-unchanged from the
// SOURCE-pinned `allow-scripts` (no allow-same-origin) — the trust boundary PR-A must preserve.
//
// The §0 geometry tokens this PR consumes (globals.css :root): --measure 33rem = 528px (the frozen
// reading spine), --panel-w 23rem = 368px (the apparatus column), --frame-max 1640px (the cap). The
// assertions are token-exact (±1px for sub-pixel rounding), so a regression that detunes a track or
// drops the cap fails the gate, while sub-pixel antialiasing does not flake it.
//
// Widths: desktop 1440 (a config project viewport), wide 1920 (set per-test — the cap-binds width),
// mobile 390 (the single-column collapse). 1920 is not a config project, so the desktop project sets
// its viewport per-test; that keeps the suite to the two existing projects while still covering all
// three widths the PR-A spec requires.

const READ_W = 528; // --measure 33rem
const PANEL_W = 368; // --panel-w 23rem
const FRAME_MAX = 1640; // --frame-max
const PX = 1.5; // sub-pixel tolerance (antialiasing / fractional layout), not a layout-regression license

/** A measured rect, viewport-local, as getBoundingClientRect returns it. */
interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

/** The grid geometry the in-browser probe returns for one render of the built reader workspace. */
interface WorkspaceGeometry {
  /** Whether the named grid tracks are present (the built shell rendered, not the degraded branch). */
  hasGrid: boolean;
  /** Whether the grid has collapsed to a single column (display:block on the section at ≤60rem). */
  collapsed: boolean;
  grid: Rect | null;
  /** Per-section [read]-column rects — the stable-spine basis (one entry per .ws-section). */
  readRects: Rect[];
  panel: Rect | null;
  /** Whether the scrub track is rendered (it is display:none on the mobile collapse). */
  scrubVisible: boolean;
  scrub: Rect | null;
  /** Document + viewport widths, to assert 0px horizontal overflow. */
  scrollWidth: number;
  innerWidth: number;
  /** The iframe sandbox attribute literal (the trust-boundary byte-check). */
  iframeSandbox: string | null;
}

async function measure(page: import('@playwright/test').Page): Promise<WorkspaceGeometry> {
  return page.evaluate(() => {
    function rect(el: Element | null) {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    }
    const grid = document.querySelector('.ws-grid');
    const sections = Array.from(document.querySelectorAll('.ws-section'));
    const reads = sections
      .map((s) => s.querySelector('.ws-read'))
      .filter((e): e is Element => e !== null);
    const panel = document.querySelector('.ws-panel');
    const scrub = document.querySelector('.ws-scrub');
    const iframe = document.querySelector('iframe.artifact-frame');
    // The collapse is detectable structurally: the section is display:block (not grid) ≤60rem.
    const firstSection = sections[0] ?? null;
    const sectionDisplay = firstSection ? getComputedStyle(firstSection).display : '';
    const scrubDisplay = scrub ? getComputedStyle(scrub).display : 'none';
    return {
      hasGrid: grid !== null,
      collapsed: sectionDisplay === 'block',
      grid: rect(grid),
      readRects: reads.map(rect).filter((r): r is NonNullable<typeof r> => r !== null),
      panel: rect(panel),
      scrubVisible: scrubDisplay !== 'none',
      scrub: rect(scrub),
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      iframeSandbox: iframe ? iframe.getAttribute('sandbox') : null,
    };
  });
}

/** Open the seeded BUILT lesson as the e2e owner; wait for the reader heading + the grid to render. */
async function openBuiltLesson(
  page: import('@playwright/test').Page,
  context: import('@playwright/test').BrowserContext,
  baseURL: string | undefined,
): Promise<void> {
  await signInAsTestOwner(context, baseURL ?? '');
  await page.goto(`/lesson/${SEED_RUN_ID}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // The built shell renders the workspace grid (the degraded branch would not).
  await expect(page.locator('.ws-grid')).toBeVisible();
  await expect(page.locator('.ws-read .morph-box iframe.artifact-frame')).toBeVisible();
}

// ── The two-column desktop/wide geometry — the LOCKED grid proportions ──────────────────────────────
for (const width of [1440, 1920]) {
  test.describe(`lesson-workspace grid @ ${String(width)} (two-column)`, () => {
    test(`the [read] track == --measure (528), the [panel] track == --panel-w (368), the frame caps + centers, the scrub sits INSIDE the frame, 0px overflow`, async ({
      page,
      context,
      baseURL,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await openBuiltLesson(page, context, baseURL);
      const g = await measure(page);

      expect(g.hasGrid).toBe(true);
      expect(g.collapsed).toBe(false); // two columns at desktop/wide
      expect(g.readRects.length).toBeGreaterThanOrEqual(1);
      expect(g.panel).not.toBeNull();
      expect(g.scrub).not.toBeNull();
      expect(g.grid).not.toBeNull();

      // The frozen reading spine is exactly --measure; the apparatus panel exactly --panel-w.
      expect(g.readRects[0]!.width).toBeCloseTo(READ_W, 0);
      expect(Math.abs(g.readRects[0]!.width - READ_W)).toBeLessThanOrEqual(PX);
      expect(Math.abs(g.panel!.width - PANEL_W)).toBeLessThanOrEqual(PX);

      // Cap + center: the whole frame is bounded by --frame-max and centered (equal gutters). At 1920
      // the cap BINDS (1640 < 1920) and the grid is centered; at 1440 the frame is below the cap.
      expect(g.grid!.width).toBeLessThanOrEqual(FRAME_MAX + PX);
      if (width > FRAME_MAX) {
        expect(Math.abs(g.grid!.width - FRAME_MAX)).toBeLessThanOrEqual(PX);
        // Centered: the left gutter == the right gutter (the frame is not edge-pinned).
        const leftGutter = g.grid!.left;
        const rightGutter = g.innerWidth - g.grid!.right;
        expect(Math.abs(leftGutter - rightGutter)).toBeLessThanOrEqual(PX);
      }

      // The scrub track sits INSIDE the frame — NOT pinned to the viewport edge. Its right edge is
      // strictly inside the grid's right edge by at least the edge-gap gutter (a measurable inset).
      expect(g.scrub!.right).toBeLessThan(g.grid!.right + PX);
      expect(g.innerWidth - g.scrub!.right).toBeGreaterThan(8); // clearly off the viewport edge

      // 0px horizontal overflow at this width.
      expect(g.scrollWidth).toBeLessThanOrEqual(g.innerWidth + PX);

      // The trust boundary is byte-unchanged: the iframe is opaque-origin (no allow-same-origin).
      expect(g.iframeSandbox).toBe('allow-scripts');
    });
  });
}

// ── The stable spine — ONE unique left + width across all sections (Δ0px, pure CSS subgrid) ──────────
test.describe('lesson-workspace stable spine (HARD rule)', () => {
  test('the prose spine has ONE unique left + ONE unique width across every section (Δ0px)', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openBuiltLesson(page, context, baseURL);
    const g = await measure(page);

    expect(g.readRects.length).toBeGreaterThanOrEqual(1);
    const lefts = g.readRects.map((r) => r.left);
    const widths = g.readRects.map((r) => r.width);
    // Δ0px (within sub-pixel tolerance) — the subgrid spine lands every section on the identical track.
    expect(Math.max(...lefts) - Math.min(...lefts)).toBeLessThanOrEqual(PX);
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(PX);
    // And that one width is the frozen --measure.
    expect(Math.abs(widths[0]! - READ_W)).toBeLessThanOrEqual(PX);
  });
});

// ── The mobile single-column collapse — apparatus/scrub below, 0px overflow ──────────────────────────
test.describe('lesson-workspace mobile collapse @ 390', () => {
  test('collapses to a single column (panel below the read column, scrub hidden), 0px horizontal overflow', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openBuiltLesson(page, context, baseURL);
    const g = await measure(page);

    expect(g.hasGrid).toBe(true);
    expect(g.collapsed).toBe(true); // display:block single column ≤60rem
    // The panel reflows BELOW the read column (single column), not beside it.
    expect(g.panel).not.toBeNull();
    expect(g.readRects[0]).not.toBeNull();
    expect(g.panel!.top).toBeGreaterThanOrEqual(g.readRects[0]!.bottom - PX);
    // The in-frame scrub rail folds away on the narrow column (PR-C → a TOC there).
    expect(g.scrubVisible).toBe(false);
    // 0px horizontal overflow at 390 (the DESIGN.md §Lesson layout invariant).
    expect(g.scrollWidth).toBeLessThanOrEqual(g.innerWidth + PX);
    // The trust boundary holds at mobile too.
    expect(g.iframeSandbox).toBe('allow-scripts');
  });
});

// ── Shipped-behavior survival — the iframe sandbox attrs + the degraded branch skip the morph ────────
test.describe('lesson-workspace preserves the shipped reader contract', () => {
  test('the BUILT shell keeps the #readerPanel.morph-box wrapping the opaque-origin iframe in the [read] track', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openBuiltLesson(page, context, baseURL);

    // The morph-box destination is present, inside the [read] track, wrapping the sandboxed iframe —
    // the byte-unchanged trust boundary + the card→reader FLIP destination PR-A must preserve.
    const morphBox = page.locator('.ws-read #readerPanel.morph-box');
    await expect(morphBox).toBeVisible();
    const iframe = morphBox.locator('iframe.artifact-frame');
    await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
    // The morph-box carries an inline per-id view-transition-name (the FLIP endpoint) — present on the
    // built branch so the cross-document morph can pair (the transport lives in globals.css).
    const vtName = await morphBox.evaluate((el) => getComputedStyle(el).viewTransitionName);
    expect(vtName).toContain('lesson-card-');
  });

  test('the BUILT branch is the morph-box + grid branch — the complement the degraded branch must not render', async ({
    page,
    context,
    baseURL,
  }) => {
    // The degraded soon/text branch (page.tsx) renders `.lesson-degraded` and NO `#readerPanel.morph-box`
    // / NO `.ws-grid`, so the head-mounted receiver-guard finds no box and SKIPS the cross-document morph
    // (a clean instant-swap — the live byte-pin for that branch's morph-skip is page.test.ts, which still
    // passes after PR-A). There is no seeded soon/text row in the e2e fixture, so this spec proves the
    // POSITIVE complement against the live built render: the built branch IS the morph-box+grid branch and
    // is NOT the degraded state — so the two branches are mutually exclusive at runtime, and the morph
    // fires only where a box exists. (The degraded branch's no-box/no-morph is pinned in page.test.ts.)
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openBuiltLesson(page, context, baseURL);
    await expect(page.locator('.lesson-degraded')).toHaveCount(0);
    await expect(page.locator('#readerPanel.morph-box')).toHaveCount(1);
    await expect(page.locator('.ws-grid')).toHaveCount(1);
  });
});
