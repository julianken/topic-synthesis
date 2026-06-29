import { expect, test } from '@playwright/test';
import { signInAsTestOwner } from './auth';
import { SEED_RUN_ID } from './seed';

// lesson-route-morph.spec — the guard for the /curriculum → /lesson route rename (issue #172). Two proofs
// the rename is LOCKSTEP-correct and behavior-preserving:
//   (1) the create → generating → reader flow runs end-to-end on the RENAMED route — the in-place
//       generating shell polls `/api/lesson/<id>/status` and navigates to `/lesson/<id>`. A missed fetch
//       literal or a stale `router.replace` target would 404 here, which is the rename's #1 hazard.
//   (2) the card → reader `@view-transition` morph's SAME-ORIGIN contract survives the rename — the library
//       card (FLIP origin) and the reader panel (FLIP destination) carry the SAME id-scoped
//       `view-transition-name` on the new `/lesson` route, the cross-document transport
//       (`@view-transition { navigation: auto }`) is live in the served CSS, and clicking the card is a
//       same-origin MPA navigation to `/lesson/<id>` — exactly the preconditions a cross-document
//       View-Transition needs. The harness forces prefers-reduced-motion (playwright.config.ts), so the
//       browser intentionally SKIPS the animation itself; this therefore asserts the morph's structural
//       CONTRACT (paired endpoints + live transport + preserved same-origin navigation), which is what the
//       path change could break — not animation frames, which would be both wrong under reduced motion and
//       flaky. The pipeline + dispatch are mocked (E2E=1, no PIPELINE_JOB_NAME), so the run is hermetic.

// morphName(id) — must stay byte-identical to library-card.ts + reader-morph.ts (`lesson-card-<id>`).
const MORPH_NAME = `lesson-card-${SEED_RUN_ID}`;

test.describe('lesson route (#172) — create → generating → reader on /lesson', () => {
  test('submitting a topic polls /api/lesson/<id>/status and lands on /lesson/<id> (never /curriculum)', async ({
    page,
    context,
    baseURL,
  }) => {
    await signInAsTestOwner(context, baseURL ?? '');
    await page.goto('/');

    // Open the create form via the +New card (under forced reduced motion the reveal is instant).
    await page.getByRole('button', { name: /new lesson/i }).click();

    // The in-place generating shell polls the RENAMED status route — capture it to prove the lockstep
    // literal is the one actually hit (this is the request that 404s if a literal was missed).
    const statusPoll = page.waitForRequest(
      (req) => /\/api\/lesson\/[0-9a-f-]+\/status$/i.test(req.url()) && req.method() === 'GET',
    );

    await page.getByRole('textbox').first().fill('Photosynthesis');
    await page.getByRole('button', { name: /generate/i }).click();

    const poll = await statusPoll;
    expect(poll.url()).toMatch(/\/api\/lesson\/[0-9a-f-]+\/status$/i);

    // The shell navigates to the RENAMED reader route once the fast network-free stub run lands.
    await expect(page).toHaveURL(/\/lesson\/[0-9a-f-]+$/i, { timeout: 30_000 });
    await expect(page).not.toHaveURL(/\/curriculum\//i); // the dead route is never emitted
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});

test.describe('lesson route (#172) — the card → reader @view-transition morph survives the rename', () => {
  test('paired FLIP endpoints on /lesson, a live transport, and a same-origin card navigation', async ({
    page,
    context,
    baseURL,
  }) => {
    await signInAsTestOwner(context, baseURL ?? '');
    await page.goto('/');

    // (a) the cross-document View-Transition TRANSPORT is live in the served CSS — `@view-transition`
    //     (navigation: auto, unit-pinned in page.test.ts) is what makes a same-origin MPA navigation
    //     between `/` and `/lesson/<id>` run as a cross-document VT rather than a hard reload.
    const hasTransport = await page.evaluate(() => {
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList | null = null;
        try {
          rules = sheet.cssRules;
        } catch {
          continue; // cross-origin sheet — not readable, skip
        }
        if (!rules) continue;
        for (const rule of Array.from(rules)) {
          const isViewTransition =
            rule.constructor?.name === 'CSSViewTransitionRule' ||
            /@view-transition/i.test(rule.cssText ?? '');
          if (isViewTransition) return true;
        }
      }
      return false;
    });
    expect(hasTransport).toBe(true);

    // (b) the seeded library card is the FLIP ORIGIN: a PLAIN same-origin <a> to the RENAMED `/lesson/<id>`
    //     route (a cross-document anchor — NOT next/link, whose soft nav would never fire the cross-doc
    //     VT), carrying the id-scoped `view-transition-name` endpoint.
    const card = page.locator(`a.library-poster__card[href$="/lesson/${SEED_RUN_ID}"]`);
    await expect(card).toBeVisible();
    expect(await card.evaluate((el) => el.tagName)).toBe('A');
    expect(await card.evaluate((el) => el.getAttribute('href'))).toBe(`/lesson/${SEED_RUN_ID}`);
    expect(await card.evaluate((el) => getComputedStyle(el).viewTransitionName)).toBe(MORPH_NAME);

    // (c) clicking the card is a SAME-ORIGIN MPA navigation to the renamed route (no SPA hijack, no 404).
    const originBefore = new URL(page.url()).origin;
    await card.click();
    await page.waitForURL(`**/lesson/${SEED_RUN_ID}`);
    expect(new URL(page.url()).origin).toBe(originBefore); // same-origin preserved
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // (d) the reader renders the FLIP DESTINATION: `#readerPanel.morph-box` carrying the SAME id-scoped
    //     `view-transition-name` as the card (the cross-document VT pairs an old/new snapshot ONLY when the
    //     two names are the SAME custom-ident), wrapping the OPAQUE-ORIGIN artifact iframe
    //     (sandbox=allow-scripts WITHOUT allow-same-origin) served from the same-origin `/lesson/<id>/artifact`.
    const panel = page.locator('#readerPanel.morph-box');
    await expect(panel).toBeVisible();
    expect(await panel.evaluate((el) => getComputedStyle(el).viewTransitionName)).toBe(MORPH_NAME);

    const frame = panel.locator('iframe.artifact-frame');
    await expect(frame).toBeVisible();
    const sandbox = await frame.evaluate((el) => el.getAttribute('sandbox') ?? '');
    expect(sandbox).toContain('allow-scripts');
    expect(sandbox).not.toContain('allow-same-origin'); // opaque origin preserved across the rename
    const src = await frame.evaluate((el) => el.getAttribute('src') ?? '');
    expect(src).toMatch(new RegExp(`/lesson/${SEED_RUN_ID}/artifact/`)); // same-origin, renamed route
  });
});
