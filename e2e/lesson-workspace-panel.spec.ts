import { expect, test, type Page } from '@playwright/test';
import { signInAsTestOwner } from './auth';
import { SEED_RUN_ID } from './seed';

// lesson-workspace-panel.spec — the BUILT-APP proof for the lesson-workspace APPARATUS PANEL (PR-B). The
// panel lives in the reader CHROME's [panel] track (reader-shell.tsx + globals.css) and is fed ONLY by
// the SHIPPED coordinate-only { sections, scrollProgress } postMessage (lesson-message.ts — UNCHANGED).
// The seeded built lesson's HTML carries a coordinate-only STUB SENDER (e2e/seed.ts) that posts that
// contract on load and re-posts at a TEST-CHOSEN progress when the spec posts a `lesson:set-progress`
// driver message INTO the iframe. So the spec drives a deterministic reading position and asserts:
//   • the where-am-i widget shows the EXACT overall percent + an overall-progress fill strip, and an
//     EXPLICITLY APPROXIMATE position ("around section N of M") — never a confident tracked NN/total
//     (the data-contract limit: the channel carries only an overall scalar, no active-section signal);
//   • the section list (moved INTO the widget) populates from the posted sections;
//   • the percent + the approximate marker TRACK scrollProgress (re-driving progress moves both);
//   • the 6 apparatus card slots render in the [panel] track within --panel-w with NO overflow;
//   • NO message → the empty state renders + no crash (decision-13 best-effort);
//   • the [read] spine stays Δ0 across the chrome [read]-track blocks;
//   • @1440/1920/390 no overflow + the mobile single-column collapse (panel below read).
//
// The spec NEVER reads the iframe contentDocument — it only POSTS coordinate-only data INTO the frame
// (the same channel a real in-iframe sender uses) and measures the CHROME's own panel DOM. The trust
// boundary is unchanged.

const PANEL_W = 368; // --panel-w 23rem
const SEED_SECTION_COUNT = 6; // e2e/seed.ts SEED_SECTIONS
const PX = 1.5; // sub-pixel tolerance (antialiasing / fractional layout), not a regression license

/** Open the seeded BUILT lesson as the e2e owner; wait for the reader heading, the grid, and the panel. */
async function openBuiltLesson(
  page: Page,
  context: import('@playwright/test').BrowserContext,
  baseURL: string | undefined,
): Promise<void> {
  await signInAsTestOwner(context, baseURL ?? '');
  await page.goto(`/curriculum/${SEED_RUN_ID}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('.ws-grid')).toBeVisible();
  await expect(page.locator('.ws-panel .ws-app')).toBeVisible();
}

/**
 * Drive the lesson iframe to a deterministic scrollProgress by POSTING the test-only `lesson:set-progress`
 * message INTO it (the seed stub sender re-emits the SHIPPED coordinate-only progress outward). Coordinate-
 * only: posts a number, reads no iframe DOM. Resilient: the post is retried via expect.poll until the
 * chrome's where-am-i percent reflects it (the seed sender registers its listener on load — a race the poll
 * absorbs without a fixed sleep).
 */
async function driveProgress(page: Page, progress: number): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.evaluate((p) => {
          const iframe = document.querySelector('iframe.artifact-frame') as HTMLIFrameElement | null;
          iframe?.contentWindow?.postMessage({ type: 'lesson:set-progress', scrollProgress: p }, '*');
        }, progress);
        // The where-am-i percent appears only once a valid message lands — its presence is the signal.
        return page.locator('.ws-where__percent').count();
      },
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0);
}

// ── The where-am-i widget + section list LIGHT UP from the posted { sections, scrollProgress } ─────────
test.describe('lesson-workspace apparatus — where-am-i widget (live from postMessage)', () => {
  test('the widget shows the EXACT percent + an explicitly-approximate position; the section list populates; both track scrollProgress', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openBuiltLesson(page, context, baseURL);

    // Drive to ~mid-lesson: overall 60% → EXACT percent read, APPROXIMATE position floor(0.6*6)=3 → ~4th.
    await driveProgress(page, 0.6);

    const where = page.locator('.ws-where');
    // EXACT, from the posted scalar: the overall percent read (the load-bearing honest fact).
    await expect(where.locator('.ws-where__percent')).toContainText('60');
    // APPROXIMATE, explicitly labeled: the position is stated as an estimate ("≈ around section 4 of 6"),
    // NEVER a confident tracked NN/total — the reviewer's MAJOR data-contract finding, honest degradation.
    await expect(where.locator('.ws-where__approx')).toContainText('around section 4 of 6');
    await expect(where.locator('.ws-where__approx')).toContainText('Measuring the gas exchange');

    // The progress strip is a single OVERALL fill (mirrors the exact percent), not per-section segments.
    await expect(where.locator('.ws-where__seg-fill')).toHaveCount(1);

    // The section list (moved INTO the widget) populates with the posted titles; the approximate position
    // gets a SOFT highlight (style + aria-current), framed by the "around section" copy as an estimate.
    await expect(where.locator('.ws-where__item')).toHaveCount(SEED_SECTION_COUNT);
    await expect(where.locator('.ws-where__item[aria-current="true"]')).toHaveText(/Measuring the gas exchange/);

    // Re-drive to a LATER position → the EXACT percent AND the approximate marker both MOVE (they track
    // scrollProgress, not a fixed value).
    await driveProgress(page, 1);
    await expect(where.locator('.ws-where__percent')).toContainText('100');
    await expect(where.locator('.ws-where__approx')).toContainText('around section 6 of 6');
    await expect(where.locator('.ws-where__item[aria-current="true"]')).toHaveText(/What to carry away/);

    // The scrubber dot-rail mirrors the same approximate marker (status by style AND label).
    await expect(page.locator('.ws-scrub__dot[data-active]')).toHaveCount(1);
    await expect(page.locator('.ws-scrub__dot')).toHaveCount(SEED_SECTION_COUNT);
  });
});

// ── The 6 card slots render in the [panel] track within --panel-w, no overflow ───────────────────────
test.describe('lesson-workspace apparatus — the 6 card slots within --panel-w', () => {
  test('the panel renders 6 cards (where-am-i + 5 richer placeholders), all within the [panel] track, no overflow', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openBuiltLesson(page, context, baseURL);
    await driveProgress(page, 0.4);

    // Six card slots: 1 where-am-i + 5 best-effort placeholders (gloss/figure/source/self-check/takeaways).
    await expect(page.locator('.ws-panel .ws-card')).toHaveCount(6);
    await expect(page.locator('.ws-panel .ws-where')).toHaveCount(1);
    await expect(page.locator('.ws-panel .ws-card[data-awaiting]')).toHaveCount(5);

    // Every card sits WITHIN the [panel] track and within --panel-w — no card overflows the column.
    const geom = await page.evaluate(() => {
      const panel = document.querySelector('.ws-panel');
      const cards = Array.from(document.querySelectorAll('.ws-panel .ws-card'));
      const r = (el: Element) => {
        const b = el.getBoundingClientRect();
        return { left: b.left, right: b.right, width: b.width };
      };
      return {
        panel: panel ? r(panel) : null,
        cards: cards.map(r),
      };
    });
    expect(geom.panel).not.toBeNull();
    expect(Math.abs(geom.panel!.width - PANEL_W)).toBeLessThanOrEqual(PX);
    for (const card of geom.cards) {
      // Within the column bounds (left ≥ panel.left, right ≤ panel.right) and never wider than --panel-w.
      expect(card.left).toBeGreaterThanOrEqual(geom.panel!.left - PX);
      expect(card.right).toBeLessThanOrEqual(geom.panel!.right + PX);
      expect(card.width).toBeLessThanOrEqual(PANEL_W + PX);
    }
  });
});

// ── NO message → the empty state renders, no crash (decision-13 best-effort) ─────────────────────────
test.describe('lesson-workspace apparatus — empty state (no message)', () => {
  test('with NO posted progress the panel renders the empty/zero state and the shell stays usable', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await signInAsTestOwner(context, baseURL ?? '');
    // Block the seeded artifact's HTML so the iframe loads NOTHING and posts NOTHING — the strict
    // decision-13 "lesson posting nothing" case, asserted without depending on sender timing.
    await page.route('**/artifact/**', (route) => route.fulfill({ status: 204, body: '' }));
    await page.goto(`/curriculum/${SEED_RUN_ID}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('.ws-panel .ws-app')).toBeVisible();

    // Nothing was ever posted → no percent/position/strip, the empty-state blurb instead.
    await expect(page.locator('.ws-where__percent')).toHaveCount(0);
    await expect(page.locator('.ws-where__approx')).toHaveCount(0);
    await expect(page.locator('.ws-where__seg-fill')).toHaveCount(0);
    await expect(page.locator('.ws-where .ws-empty')).toBeVisible();
    // The scrubber rail is empty (no posted sections) but does not crash the shell.
    await expect(page.locator('.ws-scrub__dot')).toHaveCount(0);
    // The richer placeholders STILL render (the panel shape is real even with no data).
    await expect(page.locator('.ws-panel .ws-card[data-awaiting]')).toHaveCount(5);
    // The reading column + the trust boundary are intact.
    await expect(page.locator('.ws-read #readerPanel.morph-box iframe.artifact-frame')).toHaveAttribute(
      'sandbox',
      'allow-scripts',
    );
  });
});

// ── The [read] spine stays Δ0 across the chrome [read]-track blocks (PR-B does not disturb it) ─────────
test.describe('lesson-workspace apparatus — the [read] spine is undisturbed', () => {
  test('the [read] track keeps ONE unique left + width across every .ws-read block with the panel filled', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openBuiltLesson(page, context, baseURL);
    await driveProgress(page, 0.5);

    const reads = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.ws-read')).map((el) => {
        const b = el.getBoundingClientRect();
        return { left: b.left, width: b.width };
      }),
    );
    expect(reads.length).toBeGreaterThanOrEqual(1);
    const lefts = reads.map((r) => r.left);
    const widths = reads.map((r) => r.width);
    expect(Math.max(...lefts) - Math.min(...lefts)).toBeLessThanOrEqual(PX);
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(PX);
  });
});

// ── Responsive: @1440/1920 no overflow with the panel beside; @390 the panel collapses BELOW the read ─
for (const width of [1440, 1920]) {
  test.describe(`lesson-workspace apparatus @ ${String(width)} (two-column, panel beside)`, () => {
    test('the panel sits beside the read column (not below) with 0px horizontal overflow', async ({
      page,
      context,
      baseURL,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await openBuiltLesson(page, context, baseURL);
      await driveProgress(page, 0.3);

      const g = await page.evaluate(() => {
        const read = document.querySelector('.ws-read');
        const panel = document.querySelector('.ws-panel');
        const r = (el: Element | null) => (el ? el.getBoundingClientRect() : null);
        const rr = r(read);
        const pr = r(panel);
        return {
          readRight: rr?.right ?? 0,
          readTop: rr?.top ?? 0,
          panelLeft: pr?.left ?? 0,
          panelTop: pr?.top ?? 0,
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
        };
      });
      // Two-column: the panel is to the RIGHT of the read column (its left ≥ the read column's right),
      // and roughly top-aligned (beside, not below).
      expect(g.panelLeft).toBeGreaterThanOrEqual(g.readRight - PX);
      expect(Math.abs(g.panelTop - g.readTop)).toBeLessThan(200);
      // 0px horizontal overflow at this width.
      expect(g.scrollWidth).toBeLessThanOrEqual(g.innerWidth + PX);
    });
  });
}

test.describe('lesson-workspace apparatus @ 390 (mobile collapse)', () => {
  test('the panel reflows BELOW the read column (single column), scrub hidden, 0px overflow', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openBuiltLesson(page, context, baseURL);
    await driveProgress(page, 0.5);

    const g = await page.evaluate(() => {
      const read = document.querySelector('.ws-read');
      const panel = document.querySelector('.ws-panel');
      const scrub = document.querySelector('.ws-scrub');
      const r = (el: Element | null) => (el ? el.getBoundingClientRect() : null);
      return {
        readBottom: r(read)?.bottom ?? 0,
        panelTop: r(panel)?.top ?? 0,
        scrubVisible: scrub ? getComputedStyle(scrub).display !== 'none' : false,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      };
    });
    // The panel reflows BELOW the read column (single column on the ≤60rem collapse).
    expect(g.panelTop).toBeGreaterThanOrEqual(g.readBottom - PX);
    // The in-frame dot-rail folds away on the narrow column.
    expect(g.scrubVisible).toBe(false);
    // The where-am-i widget still works in the collapsed panel.
    await expect(page.locator('.ws-where__percent')).toBeVisible();
    // 0px horizontal overflow at 390.
    expect(g.scrollWidth).toBeLessThanOrEqual(g.innerWidth + PX);
  });
});
