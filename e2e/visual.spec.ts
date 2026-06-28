import { expect, test } from '@playwright/test';
import { signInAsTestOwner } from './auth';
import { SEED_RUN_ID } from './seed';

// visual.spec — per-screen full-page VISUAL snapshots at the two DESIGN.md viewports (390×844 mobile +
// 1440×900 desktop, set per-project in playwright.config.ts), under FORCED reduced motion (config
// `use.reducedMotion: 'reduce'` + `toHaveScreenshot animations:'disabled'`) so the captures are
// deterministic — no in-flight stagger/keyframe/View-Transition. DESIGN.md wins on any design conflict.
//
// PLACEHOLDER BASELINES (read this before re-capturing): the committed -linux / -darwin baselines under
// e2e/visual.spec.ts-snapshots/ snapshot the CURRENT chrome. The frontend is mid-rebuild against the
// Figma reference frames (Sign-in 5:2 · Library 6:2 · Generating 1:2 · Lesson workspace 3:2); each
// screen here is EXPECTED to be re-captured (`npm run test:e2e:update`) as its rebuilt surface lands.
// A failing visual diff during the rebuild is the gate working, not a defect — update the baseline in
// the PR that ships the new screen. The suite ships SOFT (a non-required CI job) precisely so a
// first-run/rebuild baseline change never blocks a merge.
//
// The snapshot name is platform-suffixed by Playwright automatically (e.g. -linux on CI). The project
// name (desktop|mobile) is folded into the file name by Playwright, so one logical name yields one PNG
// per viewport. Dynamic regions (relative-time stamps, run ids) are masked where they appear so a
// re-render at a different wall-clock can't flake the diff.

// Force reduced motion before any navigation (belt-and-suspenders to the config's context option).
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test.describe('visual — sign-in (unauthenticated)', () => {
  test('the sign-in screen matches the committed baseline', async ({ page }) => {
    await page.goto('/sign-in');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page).toHaveScreenshot('sign-in.png', { fullPage: true });
  });
});

test.describe('visual — library (authed)', () => {
  // The library is owner-scoped over a SHARED Postgres the smoke spec's generate test also writes to, so
  // a FULL-PAGE capture is non-deterministic — the lesson-card grid's count, titles, and total page
  // HEIGHT change run to run. So (per the existing element-scoped pattern) snapshot only the chrome that
  // is INVARIANT of the owner's lesson history: the shared app header (.appbar — wordmark + user chip,
  // Figma 6:6) and the dense seeded poster card. The generation entry is now the `+ New lesson` card (the
  // first grid cell, which GROWS into the intake form on click — the create-form flow), so the always-open
  // intake section is gone; the create card + the revealed form are graded structurally below. The
  // run-dependent card grid count + the section title's right-aligned hint are deliberately NOT captured
  // here. DESIGN.md wins on any design conflict.

  test('the library app-header chrome matches the committed baseline', async ({ page, context, baseURL }) => {
    await signInAsTestOwner(context, baseURL ?? '');
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // The signed-in top-bar chrome (Figma 6:6): wordmark + user chip. The chip's account name is derived
    // from the seeded e2e owner's email (stable across runs), so this element is deterministic.
    const appbar = page.locator('.appbar');
    await expect(appbar).toBeVisible();
    await expect(appbar).toHaveScreenshot('library-appbar.png');
  });

  test('the DENSE library poster card (eyebrow + description) matches the committed baseline', async ({
    page,
    context,
    baseURL,
  }) => {
    await signInAsTestOwner(context, baseURL ?? '');
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // The global setup (e2e/seed.ts) seeded ONE deterministic DENSE card (Figma 6:2: subject eyebrow +
    // serif title + one-line description + built badge + meta) for the e2e owner. Snapshot just THAT card
    // by its stable href, NOT the whole grid — the smoke spec's generate test can add another card for the
    // same owner, so the grid count isn't deterministic, but the seeded card's pixels are. The seed uses a
    // FIXED system serif (Iowan Old Style) for the title; unlike the intake's native <select>/range that AA-
    // shimmer, a plain serif text card is stable, so this IS a pixel snapshot (the dense-card render gate).
    const card = page.locator(`a.library-poster__card[href$="/curriculum/${SEED_RUN_ID}"]`);
    await expect(card).toBeVisible();
    // Assert the dense rows are present (the eyebrow + description the card adds), then pixel-grade it.
    await expect(card.locator('.library-poster__eyebrow')).toHaveText('BIOLOGY');
    await expect(card.locator('.library-poster__desc')).toBeVisible();
    await expect(card).toHaveScreenshot('library-dense-card.png');
  });

});

// ── generating view (Figma 1:2) — the in-place generating shell, status MOCKED to a frozen mid-run ──────
test.describe('visual — generating (Figma 1:2, status mocked)', () => {
  // Deterministic capture of the rebuilt generating view (Figma frame 1:2): sign in, open the +New form,
  // and submit with BOTH /api/generate and /api/curriculum/[id]/status MOCKED — generate returns a fake
  // id and status returns a FROZEN mid-run state (plan done, research running, the rest pending; never
  // ready) so the in-place generating shell renders without a real LLM run. The live elapsed timer on the
  // running step is the only non-deterministic pixel, so it is MASKED. DESIGN.md wins on any design conflict.
  const FAKE_ID = '00000000-0000-4000-8000-000000000abc';

  // A mid-run timeline computed RELATIVE to now (a fixed past date would show a huge elapsed span). plan
  // ran 2.1s; research started ~11s ago with one researcher done and two still running.
  function midRunStepsJSON(): string {
    const now = Date.now();
    const iso = (ms: number) => new Date(now - ms).toISOString();
    return JSON.stringify({
      id: FAKE_ID,
      ready: false,
      steps: [
        { name: 'plan', stepKey: 'plan:k', startedAt: iso(14_000), finishedAt: iso(11_900), status: 'done' },
        { name: 'research', stepKey: 'research:a', startedAt: iso(11_400), finishedAt: iso(4_000), status: 'done' },
        { name: 'research', stepKey: 'research:b', startedAt: iso(11_400), finishedAt: null, status: 'running' },
        { name: 'research', stepKey: 'research:c', startedAt: iso(11_400), finishedAt: null, status: 'running' },
      ],
    });
  }

  test('the generating view matches the committed baseline', async ({ page, context, baseURL }) => {
    await signInAsTestOwner(context, baseURL ?? '');

    // Mock the generate POST → a fake run id, and the status poll → the frozen mid-run state (never ready).
    await page.route('**/api/generate', (route) =>
      route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ id: FAKE_ID }) }),
    );
    await page.route('**/api/curriculum/*/status', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: midRunStepsJSON() }),
    );

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Open the +New form, type a topic, submit → the in-place generating shell renders the Figma-1:2 frame.
    await page.getByRole('button', { name: /new lesson/i }).click();
    await page.getByRole('textbox').first().fill('Photosynthesis');
    await page.getByRole('button', { name: /generate/i }).click();

    // Wait for the first poll to fold the mocked steps onto the rail (a running + a done column appear).
    const frame = page.locator('.generating-frame');
    await expect(frame).toBeVisible();
    await expect(page.locator('.stagestrip__col--running').first()).toBeVisible();
    await expect(page.locator('.stagestrip__col--done').first()).toBeVisible();

    // Mask the live elapsed timer on the running step (the one non-deterministic pixel) so the ticking
    // value can't flake the diff; everything else in the frame is stable under the mocked timeline.
    await expect(frame).toHaveScreenshot('generating.png', {
      mask: [page.locator('.genstep--running .genstep__time')],
    });
  });
});

test.describe('visual — library (authed) — intake structure', () => {
  test('the +New create card grows into the intake form with its full load-bearing structure', async ({
    page,
    context,
    baseURL,
  }) => {
    await signInAsTestOwner(context, baseURL ?? '');
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // The generation entry is the `+ New lesson` card (the morph ORIGIN, the first grid cell) — present
    // on a fresh account too, so the library is never an empty grid. Assert it, then open it.
    const newCard = page.getByRole('button', { name: /new lesson/i });
    await expect(newCard).toBeVisible();
    await newCard.click();

    // The revealed intake form (the generation entry chrome — DESIGN.md §Components → Intake form) is
    // graded STRUCTURALLY, NOT by a pixel snapshot. It is text-dense with a SERIF system heading + the
    // native `<select>`/range controls, which on macOS font-SMOOTHING render with sub-pixel AA variance
    // frame-to-frame — a whole-element shimmer no mask/scale/tolerance combination stabilised reliably.
    // So this asserts the form's full load-bearing structure (the "New lesson" header, every labelled
    // field, and the Generate pill); a re-skin that DROPS a field or the header fails here. The
    // deterministic pixel grading of the rebuilt library lives on the stable `.appbar` snapshot above.
    const intake = page.locator('.intake');
    await expect(intake).toBeVisible();
    await expect(intake.getByText(/New lesson/)).toBeVisible();
    await expect(intake.getByText(/Topic/)).toBeVisible();
    await expect(intake.getByText(/Level/)).toBeVisible();
    await expect(intake.getByText(/Depth/)).toBeVisible();
    await expect(intake.getByText(/Audience/)).toBeVisible();
    await expect(intake.getByRole('textbox').first()).toBeVisible();
    await expect(intake.getByRole('combobox')).toBeVisible();
    await expect(intake.getByRole('slider')).toBeVisible();
    await expect(intake.getByRole('button', { name: /generate/i })).toBeVisible();
    // Cancel collapses the form back to the +New card (the morph in reverse).
    await intake.getByRole('button', { name: /cancel/i }).click();
    await expect(page.getByRole('button', { name: /new lesson/i })).toBeVisible();
  });
});
