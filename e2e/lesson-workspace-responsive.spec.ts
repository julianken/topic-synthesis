import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signInAsTestOwner } from './auth';
import { SEED_RUN_ID } from './seed';

// lesson-workspace-responsive.spec — the BUILT-APP proof for the FINAL chrome piece (PR-E): the ≤900
// single-column COLLAPSE (apparatus reflows DIRECTLY under the prose, 0px overflow @390/768/900), the
// MOBILE SECTION-JUMP TOC (the folded-away [scrub] dot-rail is REPLACED by a labeled phone disclosure
// whose item tap posts the SAME coordinate-only parent→child `lesson:scrollTo`), the A11Y hardening
// (logical topbar→prose→panel→scrub tab order, SR landmarks/labels, state by aria not color alone, an
// AXE scan with zero serious/critical at desktop + mobile), and REDUCED-MOTION completeness (every
// workspace transition zeroed). The trust boundary + morph are UNCHANGED (lesson-message.ts is COMMENT-
// ONLY); the TOC reuses the shipped coordinate-only sender. DESIGN.md wins on any design conflict.
//
// As in the scrub/topbar specs, the seeded built lesson's HTML carries a coordinate-only STUB SENDER
// (e2e/seed.ts) that posts the SHIPPED { sections, scrollProgress } contract on load + re-posts at a
// TEST-CHOSEN progress when the spec posts `lesson:set-progress` INTO the iframe, and ACKS a parent→child
// `lesson:scrollTo` back OUT. The spec NEVER reads the iframe contentDocument — it only POSTS coordinate-
// only data INTO the frame; the trust boundary is unchanged.

const SEED_SECTION_COUNT = 6; // e2e/seed.ts SEED_SECTIONS
const PX = 1.5; // sub-pixel tolerance (antialiasing / fractional layout), not a regression license

/** Open the seeded BUILT lesson as the e2e owner; wait for the reader heading + the grid. */
async function openBuiltLesson(
  page: Page,
  context: import('@playwright/test').BrowserContext,
  baseURL: string | undefined,
): Promise<void> {
  await signInAsTestOwner(context, baseURL ?? '');
  await page.goto(`/curriculum/${SEED_RUN_ID}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('.ws-grid')).toBeVisible();
}

/**
 * Drive the lesson iframe to a deterministic scrollProgress by POSTING the test-only `lesson:set-progress`
 * INTO it (the seed stub re-emits the SHIPPED coordinate-only { sections, scrollProgress } outward). Polls
 * until the where-am-i widget has rendered (the seed sender registers its listener on load — a race the
 * poll absorbs, no sleep); `.ws-where__percent` lights up only once sections have actually been posted, so
 * it is the universal "apparatus is live" signal at BOTH viewports (the [scrub] rail is hidden ≤900).
 */
async function driveProgress(page: Page, progress: number): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.evaluate((p) => {
          const iframe = document.querySelector('iframe.artifact-frame') as HTMLIFrameElement | null;
          iframe?.contentWindow?.postMessage({ type: 'lesson:set-progress', scrollProgress: p }, '*');
        }, progress);
        return page.locator('.ws-where__percent').count();
      },
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0);
}

/**
 * Install a PARENT-window listener for the seed stub's `lesson:scrollTo-ack` echo. We CANNOT spy on the
 * opaque/cross-origin iframe's own `postMessage` from the parent (a SecurityError), so the seed stub stands
 * in as a minimal receiver that echoes `{type:'lesson:scrollTo-ack', id}` back OUT when it gets the chrome's
 * coordinate-only `{type:'lesson:scrollTo', id}` jump. The ack ARRIVING proves the jump crossed the opaque
 * boundary carrying the right id (the targetOrigin 'null'→'*' behavior is pinned at the UNIT level,
 * lesson-scroll-sender.test.ts; arrival alone can't distinguish the two).
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

// ── (1) ≤900 single-column collapse: apparatus DIRECTLY under prose, 0px overflow @ 390/768/900 ─────────
test.describe('lesson-workspace responsive — ≤900 single-column collapse', () => {
  for (const width of [390, 768, 900]) {
    test(`at ${String(width)} the grid collapses to one column with the apparatus BELOW the prose, 0px overflow`, async ({
      page,
      context,
      baseURL,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await openBuiltLesson(page, context, baseURL);
      await driveProgress(page, 0.5);

      const m = await page.evaluate(() => {
        const cs = (sel: string) => {
          const el = document.querySelector(sel);
          return el ? getComputedStyle(el).display : null;
        };
        const rect = (sel: string) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width };
        };
        return {
          gridDisplay: cs('.ws-grid'),
          sectionDisplay: cs('.ws-section'),
          read: rect('.ws-read'),
          panel: rect('.ws-panel'),
          scrubDisplay: cs('.ws-scrub'),
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
        };
      });

      // The grid + its section collapse from `grid` to block flow (the named-line two-column layout is gone).
      expect(m.gridDisplay).toBe('block');
      expect(m.sectionDisplay).toBe('block');
      // The in-frame [scrub] dot-rail folds away on the single column (replaced by the .ws-toc disclosure).
      expect(m.scrubDisplay).toBe('none');

      // The apparatus panel reflows DIRECTLY UNDER the prose: its top is at or below the reading column's
      // bottom (vertical stack, one column) — never beside it.
      expect(m.read).not.toBeNull();
      expect(m.panel).not.toBeNull();
      expect(m.panel!.top).toBeGreaterThanOrEqual(m.read!.bottom - PX);
      // Single column: prose + panel share the SAME left edge (both block, same gutter), not two tracks.
      expect(Math.abs(m.panel!.left - m.read!.left)).toBeLessThanOrEqual(PX);

      // 0px horizontal overflow at this width (the DESIGN.md §Lesson layout invariant).
      expect(m.scrollWidth).toBeLessThanOrEqual(m.innerWidth + PX);
    });
  }
});

// ── (2) The mobile section-jump TOC: discloses, jumps via the coordinate-only sender, ≥24×24 targets ────
test.describe('lesson-workspace responsive — mobile section-jump TOC', () => {
  test('at 390 the scrub folds to a labeled TOC disclosure; opening it lists the sections; a tap posts the coordinate-only lesson:scrollTo and closes it', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openBuiltLesson(page, context, baseURL);
    await driveProgress(page, 0.6);

    // The TOC is the visible section nav on mobile; the in-frame scrub rail is hidden.
    const toc = page.locator('.ws-toc');
    await expect(toc).toBeVisible();
    await expect(page.locator('.ws-scrub')).toBeHidden();
    // It is a labeled landmark (SR navigation).
    await expect(page.locator('nav.ws-toc[aria-label="Sections"]')).toHaveCount(1);

    // Collapsed by default: the toggle reports aria-expanded=false and the list is hidden (out of the a11y
    // tree + tab order via the `hidden` attribute).
    const toggle = page.locator('.ws-toc__toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toHaveAttribute('aria-controls', 'ws-toc-list');
    await expect(page.locator('#ws-toc-list')).toBeHidden();

    // Open it → aria-expanded flips, the list reveals one jump control per posted section.
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#ws-toc-list')).toBeVisible();
    await expect(page.locator('.ws-toc__item')).toHaveCount(SEED_SECTION_COUNT);

    // Status by LABEL, not color alone: each item's accessible name carries the position + posted title;
    // the active item carries the explicit-approximate read state (no posted active-section signal).
    await expect(page.locator('.ws-toc__item').nth(0)).toHaveAttribute(
      'aria-label',
      /Jump to section 1: The tree puzzle/,
    );
    await expect(page.locator('.ws-toc__item[data-active]')).toHaveAttribute('aria-label', /\(approx\. here\)/);
    await expect(page.locator('.ws-toc__item[aria-current="true"]')).toHaveCount(1);

    // Tapping the 3rd item posts the SHIPPED coordinate-only { type:'lesson:scrollTo', id:'s3' } ACROSS the
    // opaque boundary (proven by the seed stub's ack echo) AND collapses the disclosure.
    await installAckListener(page);
    await page.locator('.ws-toc__item').nth(2).click();
    await expect.poll(async () => readAcks(page), { timeout: 5_000 }).toContain('s3');
    expect(await readAcks(page)).toEqual(['s3']);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#ws-toc-list')).toBeHidden();
  });

  test('the TOC controls each have a ≥24×24 CSS-px target (WCAG 2.2 SC 2.5.8); the TOC is hidden on desktop', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openBuiltLesson(page, context, baseURL);
    await driveProgress(page, 0.5);
    await page.locator('.ws-toc__toggle').click();

    const sizes = await page.evaluate(() => {
      const controls = Array.from(
        document.querySelectorAll('.ws-toc__toggle, .ws-toc__item'),
      ) as HTMLElement[];
      return controls.map((c) => {
        const r = c.getBoundingClientRect();
        return { w: r.width, h: r.height };
      });
    });
    expect(sizes.length).toBe(SEED_SECTION_COUNT + 1); // 6 items + the toggle
    for (const s of sizes) {
      expect(s.w).toBeGreaterThanOrEqual(24 - PX);
      expect(s.h).toBeGreaterThanOrEqual(24 - PX);
    }

    // On desktop the TOC is hidden (the in-frame scrub rail is the section nav there).
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(page.locator('.ws-toc')).toBeHidden();
    await expect(page.locator('.ws-scrub')).toBeVisible();
  });
});

// ── (3) A11y: a logical topbar→prose→panel→scrub tab order (DOM order, no positive tabindex) ────────────
test.describe('lesson-workspace responsive — logical tab order', () => {
  test('the focusable controls follow a logical topbar→prose→scrub order with no positive tabindex', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openBuiltLesson(page, context, baseURL);
    await driveProgress(page, 0.5);

    const idx = await page.evaluate(() => {
      const sel = 'a[href],button:not([disabled]),iframe,input,select,textarea,[tabindex]';
      const all = Array.from(document.querySelectorAll(`.reader--ws ${sel}`)).filter((el) => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        if ((el as HTMLElement).closest('[hidden]')) return false;
        return true;
      }) as HTMLElement[];
      const positiveTab = all.filter((el) => {
        const t = el.getAttribute('tabindex');
        return t !== null && Number(t) > 0;
      }).length;
      const find = (s: string) => all.findIndex((el) => el.matches(s));
      return {
        count: all.length,
        positiveTab,
        back: find('.ws-topbar__back'),
        focusBtn: find('.ws-topbar__focus'),
        iframe: find('iframe.artifact-frame'),
        firstScrub: all.findIndex((el) => el.matches('.ws-scrub__dot')),
      };
    });

    // No element overrides the natural order with a positive tabindex — DOM order IS the tab order.
    expect(idx.positiveTab).toBe(0);
    // Each landmark control is present and in the logical sequence: back-link → Focus-reading → prose
    // (the iframe) → the [scrub] dots. (The user pill is a non-focusable <div>; the chord chips are
    // aria-hidden, so neither is in the tab order.)
    expect(idx.back).toBeGreaterThanOrEqual(0);
    expect(idx.focusBtn).toBeGreaterThan(idx.back);
    expect(idx.iframe).toBeGreaterThan(idx.focusBtn);
    expect(idx.firstScrub).toBeGreaterThan(idx.iframe);

    // A live Tab step confirms the natural order is honored: from the back link, Tab lands on the
    // Focus-reading button (nothing focusable sits between them).
    await page.locator('.ws-topbar__back').focus();
    await expect(page.locator('.ws-topbar__back')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('.ws-topbar__focus')).toBeFocused();
  });
});

// ── (4) Reduced motion: every workspace transition is zeroed; the card reveal is GATED (absent) ─────────
// The harness forces prefers-reduced-motion: reduce project-wide (playwright.config.ts) + the spec re-
// emulates it, so the global @media (prefers-reduced-motion: reduce) guard caps every transition-duration
// at 0.01ms and the no-preference-only card-reveal keyframe never applies (animation-name resolves to
// 'none' — gated, not merely zeroed). The morph @view-transition is likewise scoped under no-preference.
test.describe('lesson-workspace responsive — reduced motion zeroes every workspace transition', () => {
  test('the focus-widen, scrub-dot, and TOC-chevron transitions are ~0 and the card reveal is gated off', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    await openBuiltLesson(page, context, baseURL);
    await driveProgress(page, 0.5);
    await page.locator('.ws-toc__toggle').click();

    const longestMs = (raw: string): number => {
      const parts = raw.split(',').map((s) => s.trim());
      const ms = parts.map((p) => (p.endsWith('ms') ? parseFloat(p) : parseFloat(p) * 1000));
      return ms.length ? Math.max(...ms) : 0;
    };

    const m = await page.evaluate(() => {
      const dur = (sel: string, pseudo?: string) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        return getComputedStyle(el, pseudo).transitionDuration;
      };
      const cardAnim = (() => {
        const el = document.querySelector('.ws-app .ws-card');
        return el ? getComputedStyle(el).animationName : null;
      })();
      return {
        readTransition: dur('.ws-read'),
        dotTransition: dur('.ws-scrub__dot', '::before'),
        chevronTransition: dur('.ws-toc__chevron'),
        cardAnim,
      };
    });

    expect(m.readTransition).not.toBeNull();
    expect(m.dotTransition).not.toBeNull();
    expect(m.chevronTransition).not.toBeNull();
    expect(longestMs(m.readTransition!)).toBeLessThanOrEqual(1);
    expect(longestMs(m.dotTransition!)).toBeLessThanOrEqual(1);
    expect(longestMs(m.chevronTransition!)).toBeLessThanOrEqual(1);
    // The panel-reveal keyframe is declared ONLY under no-preference, so under forced reduce it never
    // applies — animation-name is 'none' (the reveal is GATED off, not just zeroed).
    expect(m.cardAnim).toBe('none');
  });
});

// ── (5) AXE accessibility scan — zero serious/critical at desktop + mobile ──────────────────────────────
test.describe('lesson-workspace responsive — axe accessibility scan', () => {
  for (const vp of [
    { name: 'desktop', width: 1440, height: 1000 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    test(`no serious or critical axe violations on the built workspace (${vp.name})`, async ({
      page,
      context,
      baseURL,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await openBuiltLesson(page, context, baseURL);
      await driveProgress(page, 0.5);
      if (vp.name === 'mobile') await page.locator('.ws-toc__toggle').click();

      // Scan the chrome workspace (the opaque cross-origin artifact iframe is not reachable by axe — the
      // trust boundary — so the scan covers the chrome the shell owns). WCAG 2.0/2.1 A + AA tags.
      const results = await new AxeBuilder({ page })
        .include('.reader--ws')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      const blocking = results.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical',
      );
      // Surface a readable summary on failure (rule id + node count) instead of a bare count.
      const summary = blocking.map((v) => `${v.id} (${v.impact}) ×${String(v.nodes.length)}`);
      expect(summary, summary.join('; ')).toEqual([]);
    });
  }
});
