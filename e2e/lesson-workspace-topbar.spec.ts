import { expect, test, type Page } from '@playwright/test';
import { signInAsTestOwner } from './auth';
import { SEED_RUN_ID } from './seed';

// lesson-workspace-topbar.spec — the BUILT-APP proof for the integrated TOPBAR + reading-progress
// HAIRLINE + FOCUS-READING toggle (PR-D). The topbar (reader-shell.tsx + globals.css) is the ONLY chrome
// OUTSIDE the iframe: a 54px frosted `1fr auto 1fr` bar (back-to-Library link · the two-tone
// topic·synthesis wordmark REUSING the shipped `.appbar` tokens · the ⌘K/⇧F chord chips + the
// Focus-reading toggle + the user pill, reusing the shipped `.appbar__chip`/avatar/name). The
// reading-progress HAIRLINE sits at y=0 driven by the SHIPPED coordinate-only { sections, scrollProgress }
// postMessage (lesson-message.ts UNCHANGED) — role=progressbar + aria-valuenow, NO iframe DOM read.
// Focus-reading (Shift+F or the labeled button) is a pure-CHROME CSS state that hides the [panel] +
// [scrub] tracks and re-centers/widens the reading spine — NO postMessage, the morph + lesson-message.ts
// untouched. DESIGN.md wins on any design conflict.
//
// The spec drives a deterministic scrollProgress by POSTING the test-only `lesson:set-progress` message
// INTO the iframe (the seed stub re-emits the SHIPPED coordinate-only progress outward) — it NEVER reads
// the iframe contentDocument. The trust boundary is unchanged.

const PX = 1.5; // sub-pixel tolerance (antialiasing / fractional layout), not a regression license
const READ_W = 528; // --measure 33rem — the frozen reading spine in the two-column (non-focus) state

/** Open the seeded BUILT lesson as the e2e owner; wait for the reader heading + the grid + the topbar. */
async function openBuiltLesson(
  page: Page,
  context: import('@playwright/test').BrowserContext,
  baseURL: string | undefined,
): Promise<void> {
  await signInAsTestOwner(context, baseURL ?? '');
  await page.goto(`/lesson/${SEED_RUN_ID}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('.ws-grid')).toBeVisible();
  await expect(page.locator('.ws-topbar')).toBeVisible();
}

/**
 * Drive the lesson iframe to a deterministic scrollProgress by POSTING the test-only `lesson:set-progress`
 * message INTO it (the seed stub re-emits the SHIPPED coordinate-only progress outward). Coordinate-only:
 * posts a number, reads no iframe DOM. Resilient: retried via expect.poll until the topbar progressbar's
 * aria-valuenow reaches the expected percent (the seed sender registers its listener on load — a race the
 * poll absorbs, no sleep).
 */
async function driveProgress(page: Page, progress: number): Promise<void> {
  const expectedPct = Math.round(progress * 100);
  await expect
    .poll(
      async () => {
        await page.evaluate((p) => {
          const iframe = document.querySelector('iframe.artifact-frame') as HTMLIFrameElement | null;
          iframe?.contentWindow?.postMessage({ type: 'lesson:set-progress', scrollProgress: p }, '*');
        }, progress);
        const v = await page
          .locator('.ws-topbar [role="progressbar"]')
          .getAttribute('aria-valuenow');
        return v ? Number(v) : -1;
      },
      { timeout: 10_000 },
    )
    .toBe(expectedPct);
}

// ── The topbar is present, ~54px, a 3-track 1fr/auto/1fr bar, with the reused chrome tokens ────────────
test.describe('lesson-workspace topbar — present, 54px, 3-track', () => {
  test('the integrated topbar renders at ~54px as a 3-track bar carrying the wordmark, chips, pill, back-link, and the y=0 hairline', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openBuiltLesson(page, context, baseURL);

    // The integrated topbar replaces the global appbar: exactly one workspace topbar, and the GLOBAL
    // <SessionNav> appbar (a direct child of <body>) is suppressed under body.has-ws-topbar.
    await expect(page.locator('.ws-topbar')).toHaveCount(1);
    const globalAppbarVisible = await page.evaluate(() => {
      const el = document.querySelector('body > header.appbar');
      return el ? getComputedStyle(el).display !== 'none' : false;
    });
    expect(globalAppbarVisible).toBe(false);

    const m = await page.evaluate(() => {
      const bar = document.querySelector('.ws-topbar') as HTMLElement | null;
      if (!bar) return null;
      const cs = getComputedStyle(bar);
      const r = bar.getBoundingClientRect();
      // Count the explicit grid template tracks (the `1fr auto 1fr` 3-track layout).
      const tracks = cs.gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length;
      return {
        height: r.height,
        display: cs.display,
        tracks,
        position: cs.position,
        hasWordmark: !!bar.querySelector('.ws-topbar__wordmark'),
        hasBack: !!bar.querySelector('.ws-topbar__back'),
        hasChips: !!bar.querySelector('.ws-topbar__chips'),
        hasPill: !!bar.querySelector('.ws-topbar__pill .appbar__avatar'),
        hasFocusBtn: !!bar.querySelector('.ws-topbar__focus'),
        hasHairline: !!bar.querySelector('[role="progressbar"]'),
      };
    });

    expect(m).not.toBeNull();
    // ~54px (the shipped .appbar height) — exact, not a range it can drift out of.
    expect(Math.abs(m!.height - 54)).toBeLessThanOrEqual(PX);
    expect(m!.display).toBe('grid');
    expect(m!.tracks).toBe(3); // 1fr auto 1fr
    expect(m!.position).toBe('sticky');
    // Every required element is present (reused chrome).
    expect(m!.hasWordmark).toBe(true);
    expect(m!.hasBack).toBe(true);
    expect(m!.hasChips).toBe(true);
    expect(m!.hasPill).toBe(true);
    expect(m!.hasFocusBtn).toBe(true);
    expect(m!.hasHairline).toBe(true);

    // The back link points at the Library home as a plain <a> (the cross-document nav the morph rides).
    await expect(page.locator('.ws-topbar__back')).toHaveAttribute('href', '/');
    // The wordmark reuses the shipped two-tone treatment (the `.appbar__wordmark` + accent span).
    await expect(page.locator('.ws-topbar__wordmark.appbar__wordmark')).toHaveCount(1);
    await expect(page.locator('.ws-topbar__wordmark .appbar__wordmark-accent')).toHaveText('synthesis');
  });
});

// ── The y=0 reading-progress hairline tracks the posted scrollProgress (width + aria-valuenow) ─────────
test.describe('lesson-workspace topbar — reading-progress hairline tracks posted scrollProgress', () => {
  test('posting scrollProgress moves the hairline FILL width and sets aria-valuenow (coordinate-only)', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openBuiltLesson(page, context, baseURL);

    const bar = page.locator('.ws-topbar [role="progressbar"]');
    // The progressbar a11y contract is present (role + valuemin/max).
    await expect(bar).toHaveAttribute('aria-valuemin', '0');
    await expect(bar).toHaveAttribute('aria-valuemax', '100');

    async function fillWidth(): Promise<number> {
      return page.evaluate(() => {
        const fill = document.querySelector('.ws-topbar .reading-progress__fill') as HTMLElement | null;
        return fill ? fill.getBoundingClientRect().width : -1;
      });
    }

    // Drive to 25% → aria-valuenow=25, the hairline fill is ~25% of the track. Poll the rendered fill
    // width to absorb a paint settle (the inline width % → laid-out px is one frame behind the attr flip).
    await driveProgress(page, 0.25);
    await expect(bar).toHaveAttribute('aria-valuenow', '25');
    let w25 = 0;
    await expect.poll(async () => (w25 = await fillWidth()), { timeout: 5_000 }).toBeGreaterThan(0);

    // Drive to 75% → aria-valuenow=75, the fill GROWS (it tracks, not a fixed value).
    await driveProgress(page, 0.75);
    await expect(bar).toHaveAttribute('aria-valuenow', '75');
    let w75 = 0;
    await expect
      .poll(async () => (w75 = await fillWidth()), { timeout: 5_000 })
      .toBeGreaterThan(w25 + 10); // a real, measurable advance, not noise

    expect(w25).toBeGreaterThan(0);
    expect(w75).toBeGreaterThan(w25 + 10);
    // The hairline pins to the bar's TOP edge (y=0) — its top aligns with the topbar's top.
    const aligned = await page.evaluate(() => {
      const bar2 = document.querySelector('.ws-topbar')?.getBoundingClientRect();
      const rp = document.querySelector('.ws-topbar .reading-progress')?.getBoundingClientRect();
      if (!bar2 || !rp) return false;
      return Math.abs(rp.top - bar2.top) <= 1.5;
    });
    expect(aligned).toBe(true);
  });
});

// ── Focus-reading (Shift+F + the button): hides [panel]+[scrub], widens the spine, restores ────────────
test.describe('lesson-workspace topbar — Focus-reading toggle (Shift+F + button)', () => {
  async function measureTracks(page: Page): Promise<{
    panelVisible: boolean;
    scrubVisible: boolean;
    readWidth: number;
    pressed: string | null;
  }> {
    const m = await page.evaluate(() => {
      const disp = (sel: string) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el).display !== 'none' : false;
      };
      const read = document.querySelector('.ws-read');
      const btn = document.querySelector('.ws-topbar__focus');
      return {
        panelVisible: disp('.ws-panel'),
        scrubVisible: disp('.ws-scrub'),
        readWidth: read ? read.getBoundingClientRect().width : -1,
        pressed: btn ? btn.getAttribute('aria-pressed') : null,
      };
    });
    return m;
  }

  test('Shift+F hides the [panel]+[scrub] tracks and WIDENS the reading spine; Shift+F again restores', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openBuiltLesson(page, context, baseURL);

    // Off by default: two columns, the spine is the frozen --measure (528).
    const off = await measureTracks(page);
    expect(off.panelVisible).toBe(true);
    expect(off.scrubVisible).toBe(true);
    expect(Math.abs(off.readWidth - READ_W)).toBeLessThanOrEqual(PX);
    expect(off.pressed).toBe('false');

    // Shift+F → focus ON: panel + scrub hidden, the read track GROWS (re-centered wider spine).
    await page.keyboard.press('Shift+F');
    await expect(page.locator('.reader--ws[data-focus]')).toHaveCount(1);
    const on = await measureTracks(page);
    expect(on.panelVisible).toBe(false);
    expect(on.scrubVisible).toBe(false);
    expect(on.readWidth).toBeGreaterThan(READ_W + 10); // the spine measurably widened
    expect(on.pressed).toBe('true');

    // Shift+F again → focus OFF: restored to two columns + the frozen spine.
    await page.keyboard.press('Shift+F');
    await expect(page.locator('.reader--ws[data-focus]')).toHaveCount(0);
    const back = await measureTracks(page);
    expect(back.panelVisible).toBe(true);
    expect(back.scrubVisible).toBe(true);
    expect(Math.abs(back.readWidth - READ_W)).toBeLessThanOrEqual(PX);
    expect(back.pressed).toBe('false');
  });

  test('the labeled Focus-reading BUTTON toggles the same state (keyboard-operable, aria-pressed + label swap)', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openBuiltLesson(page, context, baseURL);

    const btn = page.locator('.ws-topbar__focus');
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
    await expect(btn).toContainText('Focus reading');
    await expect(btn).toHaveAttribute('aria-keyshortcuts', 'Shift+F');

    // Keyboard-operable: focus the button and activate with Enter (the platform <button> activation).
    await btn.focus();
    await expect(btn).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    await expect(btn).toContainText('Exit focus');
    await expect(page.locator('.ws-panel')).toBeHidden();

    // Click toggles it back off.
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.ws-panel')).toBeVisible();
  });
});

// ── ≤640 the wordmark + chord chips hide (the user pill alone anchors the right; bar fits) ──────────────
test.describe('lesson-workspace topbar — ≤640 fold (wordmark + chips hidden)', () => {
  test('at 390 the wordmark + chord chips are hidden, the pill stays, 0px horizontal overflow', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openBuiltLesson(page, context, baseURL);

    const m = await page.evaluate(() => {
      const disp = (sel: string) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el).display !== 'none' : false;
      };
      return {
        wordmark: disp('.ws-topbar__wordmark'),
        chips: disp('.ws-topbar__chips'),
        pill: disp('.ws-topbar__pill'),
        focusBtn: disp('.ws-topbar__focus'),
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      };
    });
    expect(m.wordmark).toBe(false); // hidden ≤640 (DESIGN.md invariant)
    expect(m.chips).toBe(false); // chord chips hidden ≤640
    expect(m.pill).toBe(true); // the user pill anchors the right on mobile
    expect(m.focusBtn).toBe(true); // the Focus-reading control stays operable by touch
    // 0px horizontal overflow at 390 (the DESIGN.md §Lesson layout invariant).
    expect(m.scrollWidth).toBeLessThanOrEqual(m.innerWidth + PX);
  });
});

// ── focus-visible rings on the topbar's keyboard controls (a11y) ──────────────────────────────────────
test.describe('lesson-workspace topbar — focus-visible rings', () => {
  test('the back link, the Focus-reading button, and (when reachable) controls show a focus-visible outline', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openBuiltLesson(page, context, baseURL);

    // The Focus-reading button shows a non-`none` outline when focused via the keyboard (:focus-visible).
    const focusBtn = page.locator('.ws-topbar__focus');
    await focusBtn.focus();
    const btnOutline = await focusBtn.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(btnOutline).not.toBe('none');

    // The back link likewise shows a focus-visible outline.
    const back = page.locator('.ws-topbar__back');
    await back.focus();
    const backOutline = await back.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(backOutline).not.toBe('none');
  });
});

// ── Reduced motion: the hairline + focus transitions are zeroed (the global guard) ─────────────────────
// The harness forces prefers-reduced-motion: reduce project-wide (playwright.config.ts), so the global
// @media (prefers-reduced-motion: reduce) guard caps every transition-duration at 0.01ms. The hairline
// fill (and the focus-widen transition) must therefore resolve to ~0 — motion is gated, not unconditional.
test.describe('lesson-workspace topbar — reduced motion zeroes the hairline transition', () => {
  test('the reading-progress hairline fill transition-duration is ~0 under forced reduced motion', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openBuiltLesson(page, context, baseURL);

    const durMs = await page.evaluate(() => {
      const fill = document.querySelector('.ws-topbar .reading-progress__fill') as HTMLElement | null;
      if (!fill) return -1;
      // The longest declared transition-duration, in ms (the global guard caps it at 0.01ms).
      const raw = getComputedStyle(fill).transitionDuration; // e.g. "0.01ms" or "0s, 0.01ms"
      const parts = raw.split(',').map((s) => s.trim());
      const ms = parts.map((p) => (p.endsWith('ms') ? parseFloat(p) : parseFloat(p) * 1000));
      return Math.max(...ms);
    });
    expect(durMs).toBeGreaterThanOrEqual(0);
    expect(durMs).toBeLessThanOrEqual(1); // effectively instant — the reduced-motion gate fired
  });
});

// ── 0px horizontal overflow at 1440 / 1920 / 390 with the topbar present ───────────────────────────────
for (const width of [1440, 1920, 390]) {
  test.describe(`lesson-workspace topbar — 0px overflow @ ${String(width)}`, () => {
    test('the topbar adds no horizontal overflow (and the hairline tracks)', async ({
      page,
      context,
      baseURL,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await openBuiltLesson(page, context, baseURL);
      await driveProgress(page, 0.5);

      const g = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        topbarVisible: !!document.querySelector('.ws-topbar'),
      }));
      expect(g.topbarVisible).toBe(true);
      expect(g.scrollWidth).toBeLessThanOrEqual(g.innerWidth + PX);
    });
  });
}
