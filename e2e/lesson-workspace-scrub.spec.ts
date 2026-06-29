import { expect, test, type Page } from '@playwright/test';
import { signInAsTestOwner } from './auth';
import { SEED_RUN_ID } from './seed';

// lesson-workspace-scrub.spec — the BUILT-APP proof for the lesson-workspace SCRUB RAIL + SECTION JUMP
// (PR-C). The [scrub] track (reader-shell.tsx + globals.css) is now a VERTICAL DOT-RAIL of KEYBOARD-
// OPERABLE jump <button>s — one dot per SHIPPED section (from the coordinate-only { sections,
// scrollProgress } postMessage, lesson-message.ts UNCHANGED), sticky, justify-self:center INSIDE the
// --scrub-w track (never viewport/edge-pinned), active/done by style + aria-label (not color alone), the
// active dot driven by { sections, scrollProgress }. Activating a dot posts the COORDINATE-ONLY
// parent→child message `{ type:'lesson:scrollTo', id }` to iframe.contentWindow — it tries targetOrigin
// 'null' but Chromium rejects 'null' for an opaque-origin frame, so it actually ships on the '*' fallback
// (safe: a non-navigable sandbox under strict CSP has no foreign-origin frame to leak to). The chrome
// NEVER reaches into the iframe DOM. PR-C ships the SENDER; the lesson acts on it once PR-F adds the
// receiver (best-effort here).
//
// The seeded built lesson's HTML carries a coordinate-only STUB SENDER (e2e/seed.ts) that posts the
// SHIPPED { sections, scrollProgress } contract on load + re-posts at a TEST-CHOSEN progress when the
// spec posts a `lesson:set-progress` driver message INTO the iframe. So the spec drives a deterministic
// reading position and asserts the dot count + active-dot tracking; to assert the exact OUTBOUND jump
// payload it installs a postMessage SPY on the iframe.contentWindow and clicks/keyboard-activates a dot.
//
// The spec NEVER reads the iframe contentDocument — it only POSTS coordinate-only data INTO the frame and
// (for the spy) WRAPS the frame's own postMessage. The trust boundary is unchanged.

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
 * only: posts a number, reads no iframe DOM. Resilient: retried via expect.poll until the scrub rail has
 * rendered its dots (the seed sender registers its listener on load — a race the poll absorbs, no sleep).
 */
async function driveProgress(page: Page, progress: number): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.evaluate((p) => {
          const iframe = document.querySelector('iframe.artifact-frame') as HTMLIFrameElement | null;
          iframe?.contentWindow?.postMessage({ type: 'lesson:set-progress', scrollProgress: p }, '*');
        }, progress);
        return page.locator('.ws-scrub__dot').count();
      },
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0);
}

/**
 * Listen on the PARENT window for the seed stub's `lesson:scrollTo-ack` echo. We CANNOT spy on the iframe's
 * own `postMessage` from the parent (the frame is cross-origin/opaque — a SecurityError), so instead the
 * seed stub (e2e/seed.ts) ACTS as a minimal PR-F-stand-in receiver: it gets the chrome's coordinate-only
 * `{type:'lesson:scrollTo', id}` jump and echoes a `{type:'lesson:scrollTo-ack', id}` back OUT. The ack
 * ARRIVING on the parent PROVES the jump message actually crossed the opaque boundary carrying the right id.
 * (The targetOrigin behavior — tries 'null', ships on the '*' fallback Chromium forces for an opaque frame
 * — is pinned at the UNIT level, lesson-scroll-sender.test.ts; arrival alone can't distinguish the two.)
 * Returns the recorded ack ids.
 */
async function installAckListener(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __scrollToAcks?: string[] };
    w.__scrollToAcks = [];
    window.addEventListener('message', (e: MessageEvent) => {
      const d = e.data as { type?: unknown; id?: unknown };
      if (d && typeof d === 'object' && d.type === 'lesson:scrollTo-ack' && typeof d.id === 'string') {
        w.__scrollToAcks!.push(d.id);
      }
    });
  });
}

async function readAcks(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __scrollToAcks?: string[] };
    return w.__scrollToAcks ?? [];
  });
}

// ── The dot-rail: one dot per shipped section, inside the [scrub] track, active dot tracks progress ────
test.describe('lesson-workspace scrubber — dot-rail count + active tracking', () => {
  test('renders one keyboard-operable dot per shipped section; the active dot tracks scrollProgress', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openBuiltLesson(page, context, baseURL);

    // Drive to ~60% → floor(0.6*6)=3 → the 4th dot is the approximate-active one.
    await driveProgress(page, 0.6);

    // One dot per POSTED section (== the seed section list).
    await expect(page.locator('.ws-scrub__dot')).toHaveCount(SEED_SECTION_COUNT);
    // Each dot is a real keyboard-operable control (a <button>), not an inert span.
    const dotButtons = page.locator('.ws-scrub button.ws-scrub__dot');
    await expect(dotButtons).toHaveCount(SEED_SECTION_COUNT);

    // The active dot tracks scrollProgress: exactly one active, and it carries aria-current.
    await expect(page.locator('.ws-scrub__dot[data-active]')).toHaveCount(1);
    await expect(page.locator('.ws-scrub__dot[aria-current="true"]')).toHaveCount(1);
    // The active is the 4th dot (index 3, the floor(0.6*6) estimate).
    await expect(page.locator('.ws-scrub__dot').nth(3)).toHaveAttribute('data-active', 'true');

    // Re-drive to the END → the active dot MOVES to the last dot (it tracks, not a fixed value).
    await driveProgress(page, 1);
    await expect(page.locator('.ws-scrub__dot').nth(SEED_SECTION_COUNT - 1)).toHaveAttribute(
      'data-active',
      'true',
    );
    await expect(page.locator('.ws-scrub__dot[data-active]')).toHaveCount(1);
  });
});

// ── The rail sits INSIDE the [scrub] track — measured within the frame, NOT edge-pinned ───────────────
// (Desktop only: at ≤900 the [scrub] track folds away — `display:none` — so an in-frame measurement is
// meaningless there; the mobile collapse is asserted in its own describe below.)
test.describe('lesson-workspace scrubber — inside the frame (not edge-pinned)', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) <= 900, 'scrub is hidden on the ≤900 collapse');
  test('the dot-rail sits within the [scrub] track, inset from the viewport edge, 0px overflow', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openBuiltLesson(page, context, baseURL);
    await driveProgress(page, 0.5);

    const g = await page.evaluate(() => {
      const r = (sel: string) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { left: b.left, right: b.right, width: b.width };
      };
      const panel = (() => {
        const el = document.querySelector('.ws-panel');
        return el ? el.getBoundingClientRect().right : null;
      })();
      const dots = Array.from(document.querySelectorAll('.ws-scrub__dot')).map((el) => {
        const b = el.getBoundingClientRect();
        // The center is robust to the active dot's `transform: scale(1.4)` (which symmetrically enlarges
        // the box but keeps the center fixed) — so a centered rail measures clean regardless of state.
        return { center: b.left + b.width / 2 };
      });
      return {
        scrub: r('.ws-scrub'),
        grid: r('.ws-grid'),
        panelRight: panel,
        dots,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      };
    });

    expect(g.scrub).not.toBeNull();
    expect(g.grid).not.toBeNull();
    expect(g.dots.length).toBe(SEED_SECTION_COUNT);

    // Every dot's CENTER sits WITHIN the [scrub] track's measured box (justify-self:center keeps the rail
    // centered, not pinned to either edge of the track). Centers are scale-robust (the active dot scales).
    for (const dot of g.dots) {
      expect(dot.center).toBeGreaterThanOrEqual(g.scrub!.left - PX);
      expect(dot.center).toBeLessThanOrEqual(g.scrub!.right + PX);
    }
    // The track is the NARROW --scrub-w track (1.1rem ≈ 17.6px), NOT the wide outer 1fr gutter: it sits
    // in the `panel-end / scrub` span immediately right of the panel, not orphaned in the screen-edge
    // gutter (the MAJOR finding — a rail in the `scrub / screen-end` track would be ~--scrub-w wide but
    // floated ~140px right against the viewport edge). Assert (a) the track is narrow, and (b) it abuts
    // the panel's right edge — both false if it were placed in the outer gutter.
    expect(g.panelRight).not.toBeNull();
    expect(g.scrub!.width).toBeLessThan(40); // ≈1.1rem track, not a ~140px+ gutter
    expect(g.scrub!.left).toBeGreaterThanOrEqual(g.panelRight! - PX); // immediately right of [panel-end]
    expect(g.scrub!.left - g.panelRight!).toBeLessThan(8); // abuts the panel, not floated into the gutter
    // The track sits INSIDE the capped frame (its right edge ≤ the grid's right edge) and is clearly OFF
    // the viewport edge — NOT pinned to the screen edge (DESIGN.md §Lesson layout decision 3).
    expect(g.scrub!.right).toBeLessThanOrEqual(g.grid!.right + PX);
    expect(g.innerWidth - g.scrub!.right).toBeGreaterThan(8);
    // 0px horizontal overflow at this width.
    expect(g.scrollWidth).toBeLessThanOrEqual(g.innerWidth + PX);
  });

  // ── a11y SC 2.5.8 (Target Size Minimum, WCAG 2.2 AA): each dot's POINTER hit target ≥ 24×24 CSS px ──
  // The VISIBLE dot stays 8px (a centered ::before), but the focusable <button>'s OWN box (its
  // getBoundingClientRect — the real pointer/touch target, padding included) is enlarged to ≥ 24×24
  // CSS px, and adjacent hit boxes do NOT overlap (the 20px-pitch spacing-exception failure is gone).
  // Crucially this is achieved WITHOUT widening the [scrub] track — re-asserted here so the a11y fix
  // can't silently regress the in-frame layout the test above proves.
  test('each dot has a ≥24×24 CSS-px POINTER hit target, non-overlapping, with the track unwidened', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openBuiltLesson(page, context, baseURL);
    await driveProgress(page, 0.5);

    const m = await page.evaluate(() => {
      const buttons = Array.from(
        document.querySelectorAll('.ws-scrub button.ws-scrub__dot'),
      ) as HTMLElement[];
      // The button's OWN box = its pointer/touch hit target (getBoundingClientRect includes the
      // transparent padding that grows the 8px visible dot's button to the 24px target). The active
      // dot's `transform: scale` is on the inner ::before, never the button box, so the hit rect is
      // state-independent.
      const hits = buttons.map((b) => {
        const r = b.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height };
      });
      // The visible dot (the ::before) stays 8px — read its rendered size so the fix is proven to keep
      // the dot VISUALLY unchanged while only the hit box grew.
      const firstDot = buttons[0];
      const dotW = firstDot ? parseFloat(getComputedStyle(firstDot, '::before').width) : 0;
      const dotH = firstDot ? parseFloat(getComputedStyle(firstDot, '::before').height) : 0;
      const scrub = (() => {
        const el = document.querySelector('.ws-scrub');
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { left: b.left, right: b.right, width: b.width };
      })();
      const grid = (() => {
        const el = document.querySelector('.ws-grid');
        return el ? el.getBoundingClientRect().right : null;
      })();
      return {
        hits,
        dotW,
        dotH,
        scrub,
        gridRight: grid,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      };
    });

    expect(m.hits.length).toBe(SEED_SECTION_COUNT);

    // (a) Every dot's POINTER hit target is ≥ 24×24 CSS px (SC 2.5.8 Target Size Minimum). PX tolerance
    // is sub-pixel only — 24 is the hard floor, not a target to round down to.
    for (const h of m.hits) {
      expect(h.w).toBeGreaterThanOrEqual(24 - PX);
      expect(h.h).toBeGreaterThanOrEqual(24 - PX);
    }

    // (b) Adjacent hit targets do NOT overlap: the vertical pitch is ≥ the 24px target height, so a
    // dot's box never intrudes on its neighbour's (the failing exception of the old 20px pitch). Sorted
    // top-to-bottom, each box's top is at or below the previous box's bottom (no vertical overlap).
    const sorted = [...m.hits].sort((a, b) => a.top - b.top);
    for (let i = 1; i < sorted.length; i += 1) {
      const cur = sorted[i]!;
      const prev = sorted[i - 1]!;
      expect(cur.top).toBeGreaterThanOrEqual(prev.bottom - PX);
    }

    // (c) The VISIBLE dot is still 8px — the fix grew only the (transparent) hit box, not the dot.
    expect(m.dotW).toBeGreaterThanOrEqual(8 - PX);
    expect(m.dotW).toBeLessThanOrEqual(8 + PX);
    expect(m.dotH).toBeGreaterThanOrEqual(8 - PX);
    expect(m.dotH).toBeLessThanOrEqual(8 + PX);

    // (d) The track was NOT widened to fit the 24px hit boxes: the [scrub] track stays the narrow
    // ≈1.1rem column (< 40px), inside the capped frame, 0px horizontal overflow. The 24px hit box
    // overflows the track centered (negative inline margin) instead of growing it.
    expect(m.scrub).not.toBeNull();
    expect(m.scrub!.width).toBeLessThan(40);
    expect(m.gridRight).not.toBeNull();
    expect(m.scrub!.right).toBeLessThanOrEqual(m.gridRight! + PX);
    expect(m.innerWidth - m.scrub!.right).toBeGreaterThan(8);
    expect(m.scrollWidth).toBeLessThanOrEqual(m.innerWidth + PX);
  });
});

// ── The rail is a MINIMAP that SPANS the reading column (anchored, NOT a top cluster) ─────────────────
// The fix's geometric contract: the lesson scrolls INSIDE the iframe (.artifact-frame is a fixed-height
// viewport), so the outer chrome is near-static and a `position: sticky` rail had nothing to stick to —
// it bunched as a ~180px cluster at the TOP of the 720px reading column (reading as absolutely-positioned,
// not anchored). The fix stretches the [scrub] cell and spans the rail to the reading column's height,
// distributing the dots evenly read-start → read-end, with the active dot's vertical position tracking
// scrollProgress DOWN the column. Every threshold below is chosen to FAIL on the pre-fix CSS (rail
// height ≈180, dot span ≈140, active movement ≈140) and PASS on the fix (rail ≈720, span ≈696, ≈696).
// (Desktop only: the [scrub] track folds away ≤900 — asserted in its own describe below.)
test.describe('lesson-workspace scrubber — minimap spans the reading column (not a top cluster)', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) <= 900, 'scrub is hidden on the ≤900 collapse');

  test('the rail spans the reading column height and distributes its dots, top→bottom (not bunched)', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openBuiltLesson(page, context, baseURL);
    await driveProgress(page, 0.5);

    const g = await page.evaluate(() => {
      const box = (sel: string) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { top: b.top, bottom: b.bottom, height: b.height };
      };
      const dots = Array.from(document.querySelectorAll('.ws-scrub__dot')).map((el) => {
        const b = el.getBoundingClientRect();
        return b.top + b.height / 2;
      });
      return { read: box('.ws-read'), rail: box('.ws-scrub__rail'), dots };
    });

    expect(g.read).not.toBeNull();
    expect(g.rail).not.toBeNull();
    expect(g.dots.length).toBe(SEED_SECTION_COUNT);
    const readH = g.read!.height;

    // (a) The rail SPANS the reading column: its height is essentially the reading column's height (the
    // minimap is the SAME height as the reading area it maps onto), and its top/bottom are ANCHORED to
    // the reading column's top/bottom — not a short content cluster floating at the top.
    expect(g.rail!.height).toBeGreaterThanOrEqual(0.92 * readH); // pre-fix ≈180 << 0.92×720 → fails
    expect(Math.abs(g.rail!.top - g.read!.top)).toBeLessThanOrEqual(4); // anchored to read-start
    expect(Math.abs(g.rail!.bottom - g.read!.bottom)).toBeLessThanOrEqual(8); // and to read-end (pre-fix off by ~540)

    // (b) The dots are DISTRIBUTED across the reading column, not bunched: the first dot sits near the
    // top, the last near the bottom, and their span covers most of the column.
    const first = g.dots[0]!;
    const last = g.dots[g.dots.length - 1]!;
    expect(first).toBeLessThanOrEqual(g.read!.top + 0.15 * readH); // first dot near read-start
    expect(last).toBeGreaterThanOrEqual(g.read!.bottom - 0.15 * readH); // last dot near read-end (pre-fix fails)
    expect(last - first).toBeGreaterThanOrEqual(0.6 * readH); // span ≈696 ≥ 432 (pre-fix ≈140 → fails)

    // (c) The distribution is EVEN (a minimap, not a random scatter): adjacent pitches are within a tight
    // band of their mean, so no two dots overlap and none is clustered.
    const pitches = g.dots.slice(1).map((cy, i) => cy - g.dots[i]!);
    const meanPitch = pitches.reduce((s, p) => s + p, 0) / pitches.length;
    for (const p of pitches) {
      expect(Math.abs(p - meanPitch)).toBeLessThanOrEqual(2); // evenly spaced (space-between)
      expect(p).toBeGreaterThanOrEqual(24); // ≥ the 24px hit-box height → adjacent boxes never overlap
    }
  });

  test('the active dot tracks scrollProgress DOWN the column — its y rises with progress', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openBuiltLesson(page, context, baseURL);

    const readH = await page.evaluate(() => document.querySelector('.ws-read')!.getBoundingClientRect().height);

    const activeCy = async (): Promise<number> => {
      return page.evaluate(() => {
        const el = document.querySelector('.ws-scrub__dot[data-active]');
        if (!el) return Number.NaN;
        const b = el.getBoundingClientRect();
        return b.top + b.height / 2;
      });
    };

    // Near the start: the active dot sits near the TOP of the reading column.
    await driveProgress(page, 0.02);
    const lowCy = await activeCy();
    expect(Number.isNaN(lowCy)).toBe(false);

    // Near the end: the active dot has MOVED to near the BOTTOM of the reading column.
    await driveProgress(page, 0.98);
    const highCy = await activeCy();
    expect(Number.isNaN(highCy)).toBe(false);

    // The active dot moved DOWN by most of the reading column's height as progress went 0.02 → 0.98 —
    // the minimap tracks scrollProgress vertically. Pre-fix the whole rail spanned ≈140px, so the active
    // dot could move at most ≈140px (< 0.5×720) — this assertion fails on the bunched-cluster CSS.
    expect(highCy - lowCy).toBeGreaterThanOrEqual(0.5 * readH);
  });
});

// ── Clicking dot i posts the coordinate-only { type:'lesson:scrollTo', id:<section i> } across the boundary ─
// The exact-payload + targetOrigin-'null'-never-'*' guarantee is pinned at the UNIT level
// (lesson-scroll-sender.test.ts). Here the BUILT-APP proof is that activating a dot posts a coordinate-only
// jump that ACTUALLY CROSSES the opaque boundary carrying the right section id — observed via the seed
// stub's ack echo (the spec cannot spy on the cross-origin frame's postMessage directly).
test.describe('lesson-workspace scrubber — the coordinate-only parent→child jump', () => {
  test('clicking dot i posts a coordinate-only lesson:scrollTo carrying the posted section id across the boundary', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openBuiltLesson(page, context, baseURL);
    await driveProgress(page, 0); // sections posted; rail rendered
    await installAckListener(page);

    // Click the 3rd dot (index 2) → posts the SHIPPED section id 's3' (e2e/seed.ts SEED_SECTIONS[2].id).
    await page.locator('.ws-scrub__dot').nth(2).click();

    await expect.poll(async () => readAcks(page), { timeout: 5_000 }).toContain('s3');
    const acks = await readAcks(page);
    // The jump carried EXACTLY the clicked section's id — no other id, the message round-tripped once.
    expect(acks).toEqual(['s3']);
  });

  test('the dot is KEYBOARD-operable: focus a dot and activate it posts the same coordinate-only jump', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openBuiltLesson(page, context, baseURL);
    await driveProgress(page, 0);
    await installAckListener(page);

    // Focus the FIRST dot directly (resilient — not dependent on the global tab order), then activate it
    // via the keyboard (Enter), the platform's <button> activation.
    const firstDot = page.locator('.ws-scrub__dot').first();
    await firstDot.focus();
    // The focused element IS the first dot button (keyboard reachable + focus-visible styled).
    await expect(firstDot).toBeFocused();
    await page.keyboard.press('Enter');

    // The keyboard activation posts the SAME coordinate-only jump for the first section ('s1').
    await expect.poll(async () => readAcks(page), { timeout: 5_000 }).toContain('s1');
  });
});

// ── a11y: each dot is a labeled control (section name + position) ─────────────────────────────────────
test.describe('lesson-workspace scrubber — a11y labels (status not by color alone)', () => {
  test('each dot is a labeled jump control carrying the section name + position; the rail is a labeled nav', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openBuiltLesson(page, context, baseURL);
    await driveProgress(page, 0.6);

    // The rail is a labeled landmark.
    await expect(page.locator('.ws-scrub[aria-label="Jump to section"]')).toHaveCount(1);

    // Each dot's accessible name carries the position + the posted section title (status by LABEL, not
    // color alone): e.g. "Jump to section 1: The tree puzzle".
    const first = page.locator('.ws-scrub__dot').nth(0);
    await expect(first).toHaveAttribute('aria-label', /Jump to section 1: The tree puzzle/);
    // The active dot's label carries the explicit-approximate read state (the channel has no posted
    // active-section signal — honest degradation, the reviewer's data-contract finding).
    const active = page.locator('.ws-scrub__dot[data-active]');
    await expect(active).toHaveAttribute('aria-label', /\(approx\. here\)/);
    // A done dot (before the active) carries the "(read)" state in its label.
    await expect(page.locator('.ws-scrub__dot').nth(0)).toHaveAttribute('aria-label', /\(read\)/);
  });
});

// ── Responsive: ≤900 the scrub collapses (hidden) per the SPEC; 0px overflow @ 1440/1920/390 ───────────
for (const width of [1440, 1920]) {
  test.describe(`lesson-workspace scrubber @ ${String(width)} (visible, inside frame)`, () => {
    test('the dot-rail is visible inside the frame with 0px horizontal overflow', async ({
      page,
      context,
      baseURL,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await openBuiltLesson(page, context, baseURL);
      await driveProgress(page, 0.4);

      const g = await page.evaluate(() => {
        const scrub = document.querySelector('.ws-scrub');
        return {
          scrubVisible: scrub ? getComputedStyle(scrub).display !== 'none' : false,
          dots: document.querySelectorAll('.ws-scrub__dot').length,
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
        };
      });
      expect(g.scrubVisible).toBe(true);
      expect(g.dots).toBe(SEED_SECTION_COUNT);
      expect(g.scrollWidth).toBeLessThanOrEqual(g.innerWidth + PX);
    });
  });
}

test.describe('lesson-workspace scrubber @ 390 (mobile collapse)', () => {
  test('the scrub rail folds away on the narrow single column, 0px horizontal overflow', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openBuiltLesson(page, context, baseURL);
    await driveProgress(page, 0.5);

    const g = await page.evaluate(() => {
      const scrub = document.querySelector('.ws-scrub');
      return {
        // The in-frame dot-rail folds away on the narrow column (globals.css `.ws-scrub { display:none }`).
        scrubVisible: scrub ? getComputedStyle(scrub).display !== 'none' : false,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      };
    });
    expect(g.scrubVisible).toBe(false);
    expect(g.scrollWidth).toBeLessThanOrEqual(g.innerWidth + PX);
  });
});
