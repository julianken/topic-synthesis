import { expect, test } from '@playwright/test';
import { signInAsTestOwner } from './auth';
import { SEED_GENERATING_RUN_ID, SEED_RUN_ID } from './seed';
import { GENERATING_STATUS_PAYLOAD } from './generating-fixture';

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
    const card = page.locator(`a.library-poster__card[href$="/lesson/${SEED_RUN_ID}"]`);
    await expect(card).toBeVisible();
    // Assert the dense rows are present (the eyebrow + description the card adds), then pixel-grade it.
    await expect(card.locator('.library-poster__eyebrow')).toHaveText('BIOLOGY');
    await expect(card.locator('.library-poster__desc')).toBeVisible();
    await expect(card).toHaveScreenshot('library-dense-card.png');
  });

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

test.describe('visual — generating (live-research, mid-run)', () => {
  // The live-research GENERATING view — the FULL-WIDTH, COLUMN-LOCKED TABLE (SPEC in
  // .superpowers/generating-layout/, superseding the #154 side-rail): the six phase columns (Plan ·
  // Research · Brief · Spec · Code · Critic) under the stepper headers, with the LIVE RESEARCH evidence
  // relocated to a full-width band below the graph. Captured DETERMINISTICALLY by intercepting the status
  // poll with a FIXED mid-run payload (e2e/generating-fixture.ts) — no live pipeline, no model spend. The
  // seeded in-flight run id (e2e/seed.ts SEED_GENERATING_RUN_ID) has a `run_owner` stamp but NO persisted
  // curriculum, so page.tsx renders the generating branch for the owner (not a 404). DESIGN.md wins.
  //
  // TWO captures, because the SAME shared GeneratingView renders both entries with a different header
  // contract: (1) the READER-ROUTE refresh path has no topic pre-persist → a bare "Generating…" (the
  // honest degrade); (2) the CREATE-FORM path carries the typed topic → "Generating Photosynthesis…"
  // with the topic span in --interactive (Figma 1:2's HEADLINE — the topic as the large H1). The second
  // capture is what exercises the view's primary acceptance criterion; the first proves the degrade.

  test('the live-research generating view matches the committed baseline', async ({
    page,
    context,
    baseURL,
  }) => {
    await signInAsTestOwner(context, baseURL ?? '');

    // Intercept the owner-scoped status poll for the seeded in-flight run, returning the fixed mid-run
    // research+steps payload (REAL-shaped: plan done, two questions answered, one extracting, brief
    // forming). This is the SAME contract the route serves — only the data is pinned for determinism.
    await page.route(`**/api/lesson/${SEED_GENERATING_RUN_ID}/status`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: SEED_GENERATING_RUN_ID, ...GENERATING_STATUS_PAYLOAD }),
      });
    });

    await page.goto(`/lesson/${SEED_GENERATING_RUN_ID}`);
    // The view renders its own "Generating…" heading + the live-research surfaces.
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/generating/i);
    // The node-graph carries the real research questions; the panel carries the grounded findings.
    await expect(page.getByText('Where does a plant’s mass come from?')).toBeVisible();
    await expect(page.getByText('LIVE RESEARCH')).toBeVisible();
    await expect(page.getByText(/2 \/ 3 extracted/)).toBeVisible();

    // Mask the live cells: the in-progress `research` segment timer in the compact pill + the caption
    // line (both tick off the wall clock via a JS setInterval, which `animations: 'disabled'` can't
    // freeze), so a re-render at a different ms would flake the diff. Mask just those; everything else is
    // static fixture data.
    const liveTimer = page.locator('.gen-pstep--running .gen-pstep__time, .gen-progress__caption');
    await expect(page).toHaveScreenshot('generating.png', {
      fullPage: true,
      mask: [liveTimer],
    });
  });

  // The TOPIC-BEARING capture (Figma 1:2's headline: the topic as the large H1 in --interactive). The
  // reader-route capture above degrades to a bare "Generating…" by design (no topic pre-persist on a
  // refresh), so it can't exercise the view's primary acceptance criterion — the "Generating <topic>…"
  // header. This second capture drives the CREATE-FORM path (the path that DOES carry the typed topic):
  // submit a topic, intercept /api/generate to return the seeded in-flight run id (no real run), and
  // intercept that run's status poll with the SAME mid-run payload — so the create-form's in-place
  // generating shell renders the shared GeneratingView with `topic` set, showing "Generating
  // Photosynthesis…" with the topic span in --interactive. REAL contract, only the run id + the poll
  // data are pinned for determinism; no model spend, no real Cloud Run dispatch.
  test('the live-research generating view shows the topic header (create-form path)', async ({
    page,
    context,
    baseURL,
  }) => {
    await signInAsTestOwner(context, baseURL ?? '');

    // Pin the generate POST to the seeded in-flight run id (so the run never actually executes — the stub
    // pipeline would otherwise persist and navigate away) and pin that run's status poll to the fixed
    // mid-run research+steps payload. The view stays in the generating state with the topic showing.
    await page.route('**/api/generate', async (route) => {
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ id: SEED_GENERATING_RUN_ID }),
      });
    });
    await page.route(`**/api/lesson/${SEED_GENERATING_RUN_ID}/status`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: SEED_GENERATING_RUN_ID, ...GENERATING_STATUS_PAYLOAD }),
      });
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Open the create form (the +New card grows into the intake form — instant under forced reduced
    // motion), type the topic, and submit. On the 202 the form recedes and the shared GeneratingView
    // renders in place with `topic` set (the create-form path's whole point — the typed topic lands in
    // the header). The status poll then fills the node-graph + the LIVE RESEARCH panel.
    await page.getByRole('button', { name: /new lesson/i }).click();
    await page.getByRole('textbox').first().fill('Photosynthesis');
    await page.getByRole('button', { name: /generate/i }).click();

    // The headline: "Generating Photosynthesis…" — the topic in a --interactive span (the acceptance
    // criterion the reader-route capture can't exercise). Then wait for the mid-run feed to land.
    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toContainText(/generating/i);
    await expect(h1.locator('.gen-topic__topic')).toHaveText('Photosynthesis');
    await expect(page.getByText('Where does a plant’s mass come from?')).toBeVisible();
    await expect(page.getByText(/2 \/ 3 extracted/)).toBeVisible();

    const liveTimer = page.locator('.gen-pstep--running .gen-pstep__time, .gen-progress__caption');
    await expect(page).toHaveScreenshot('generating-create.png', {
      fullPage: true,
      mask: [liveTimer],
    });
  });
});
