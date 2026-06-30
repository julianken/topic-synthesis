import { expect, test, type Page } from '@playwright/test';
import { signInAsTestOwner } from './auth';
import { SEED_INFLIGHT_RUN_ID, clearInFlightCard, persistInFlightRun, seedInFlightCard } from './seed';

// library-inflight-card.spec — run-lifecycle 2/4 (#231). The IN-FLIGHT library tile: a dispatched-but-not-
// yet-persisted run shows as a distinct "Generating" card on the library home the instant it starts,
// clickable to the #225 single generating screen, and REPLACED by the run's poster once it persists (dedup,
// never both). Implemented to Figma node 98:2.
//
// The in-flight run (SEED_INFLIGHT_RUN_ID) is a `run_owner` stamp WITH meta and NO persisted curriculum, so
// `listInFlightRuns` surfaces it. Seeded describe-scoped (NOT globally) so the library-snapshot baselines
// stay at exactly the one dense card; the dedup test PERSISTS it and the afterAll clears both.
//
// SERIAL (mode: 'serial') so the read tests (appears / link / nav / geometry) run BEFORE the mutating dedup
// test — which persists the shared id — on a single worker, declaration-ordered. Reduced motion is forced.
// Every assertion is a web-first auto-retrying matcher over DOM state; geometry is measured via
// getBoundingClientRect (never eyeballed); selectors are class / role hooks, never brittle copy.

test.describe.configure({ mode: 'serial' });

/** The seeded in-flight tile: the `<li class="library-poster--inflight">` whose card links to the run. */
const inflightTile = (page: Page) =>
  page.locator(
    `li.library-poster--inflight:has(a.library-poster__card[href$="/lesson/${SEED_INFLIGHT_RUN_ID}"])`,
  );

test.describe('library — in-flight tile (#231)', () => {
  test.beforeAll(seedInFlightCard);
  test.afterAll(clearInFlightCard);

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('AC13 — a seeded in-flight card appears in the library for the owner', async ({
    page,
    context,
    baseURL,
  }) => {
    await signInAsTestOwner(context, baseURL ?? '');
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const tile = inflightTile(page);
    await expect(tile).toBeVisible();
    // AC8 — the run topic is the serif title, a distinct Generating badge (label + icon, never color
    // alone), and the time-free `level · d{depth}` meta line (Figma 98:2).
    await expect(tile.locator('.library-poster__title')).toHaveText('Neural networks');
    const badge = tile.locator('.badge--inflight');
    await expect(badge).toContainText(/generating/i);
    await expect(badge.locator('.badge__icon')).toHaveText('⟳'); // the icon half of "label + icon"
    await expect(tile.locator('.library-poster__meta')).toHaveText('intermediate · d1');
    // AC8 — NOT a built/soon/text PageStatus badge.
    await expect(tile.locator('.badge--built, .badge--soon, .badge--text')).toHaveCount(0);
    // AC8 — no eyebrow / description rows (an in-flight run has neither yet).
    await expect(tile.locator('.library-poster__eyebrow, .library-poster__desc')).toHaveCount(0);

    // AC10 — the tile is NOT a PosterCard and does not consume the selection context: a single link, NO
    // select/delete affordance (a button/checkbox), and NO card→reader morph view-transition-name (which
    // a PosterCard's anchor always carries). So the selection layer never targets a non-persisted run id.
    await expect(tile.getByRole('link')).toHaveCount(1);
    await expect(tile.getByRole('button')).toHaveCount(0);
    await expect(tile.getByRole('checkbox')).toHaveCount(0);
    await expect(tile.locator('a.library-poster__card')).not.toHaveAttribute(
      'style',
      /view-transition-name/,
    );
  });

  test('AC14 — the in-flight card href equals /lesson/${SEED_INFLIGHT_RUN_ID}', async ({
    page,
    context,
    baseURL,
  }) => {
    await signInAsTestOwner(context, baseURL ?? '');
    await page.goto('/');
    const anchor = inflightTile(page).locator('a.library-poster__card');
    await expect(anchor).toHaveAttribute('href', `/lesson/${SEED_INFLIGHT_RUN_ID}`);
  });

  test('AC15 — clicking the in-flight card lands on the generating screen at that route', async ({
    page,
    context,
    baseURL,
  }) => {
    await signInAsTestOwner(context, baseURL ?? '');
    await page.goto('/');
    await inflightTile(page).locator('a.library-poster__card').click();
    // A plain cross-document navigation to the #225 single generating screen.
    await expect(page).toHaveURL(new RegExp(`/lesson/${SEED_INFLIGHT_RUN_ID}$`));
    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toContainText(/generating/i);
    // The typed topic reaches the header server-side (run-lifecycle #225 — via the run's owner-gated meta).
    await expect(h1).toContainText('Neural networks');
  });

  test('AC17/AC18 — the in-flight card occupies a single grid cell and does not overflow (390 + 1440)', async ({
    page,
    context,
    baseURL,
  }) => {
    // Runs at BOTH viewports (the desktop + mobile projects): AC17 (single cell @390) + AC18 (no overflow
    // @1440) are both satisfied by the same geometric invariants, measured via getBoundingClientRect.
    await signInAsTestOwner(context, baseURL ?? '');
    await page.goto('/');
    const tile = inflightTile(page);
    await expect(tile).toBeVisible();

    const box = await tile.boundingBox();
    if (!box) throw new Error('in-flight tile has no bounding box');
    // It occupies a single fixed library grid cell — the frame's 291px column × 262px poster height
    // (same fixed cell the dense poster + the +New card use, so the grid rhythm is unbroken).
    expect(box.width, 'one 291px grid column').toBeGreaterThan(289);
    expect(box.width, 'one 291px grid column').toBeLessThan(293);
    expect(box.height, 'the fixed 262px poster height').toBeGreaterThan(260);
    expect(box.height, 'the fixed 262px poster height').toBeLessThan(264);

    // It does not overflow its grid cell / the grid container at either viewport.
    const grid = await page.locator('ul.lessons-grid').boundingBox();
    if (!grid) throw new Error('lessons-grid has no bounding box');
    expect(box.x, 'left edge within the grid').toBeGreaterThanOrEqual(grid.x - 1);
    expect(box.x + box.width, 'right edge within the grid').toBeLessThanOrEqual(grid.x + grid.width + 1);

    // It sits AFTER the +New cell and BEFORE the persisted posters in DOM order (AC7): the create cell is
    // the grid's first child; the in-flight tile precedes the dense poster.
    const order = await page.locator('ul.lessons-grid > li').evaluateAll((lis) =>
      lis.map((li) => {
        if (li.classList.contains('lessons-grid__create')) return 'create';
        if (li.classList.contains('library-poster--inflight')) return 'inflight';
        return 'poster';
      }),
    );
    expect(order[0]).toBe('create');
    expect(order.indexOf('inflight')).toBeLessThan(order.indexOf('poster'));
  });

  // DEDUP — declared LAST + serial: it MUTATES the shared id (persist), so it runs after the read tests.
  test('AC11/AC16 — after the run persists, exactly one card shows for the id (the poster), never two', async ({
    page,
    context,
    baseURL,
  }) => {
    // The dispatched run completes: persistRun PRUNES the run_owner stamp and lands a curriculum row.
    await persistInFlightRun();

    await signInAsTestOwner(context, baseURL ?? '');
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Exactly ONE card for the id — never the in-flight tile AND the poster.
    const cards = page.locator(`a.library-poster__card[href$="/lesson/${SEED_INFLIGHT_RUN_ID}"]`);
    await expect(cards).toHaveCount(1);
    // …and it's the POSTER, not the in-flight tile (the in-flight `--inflight` li / Generating badge are gone).
    await expect(inflightTile(page)).toHaveCount(0);
    await expect(cards.locator('xpath=ancestor::li').locator('.badge--inflight')).toHaveCount(0);
  });
});
