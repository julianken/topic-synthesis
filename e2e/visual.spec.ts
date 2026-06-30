import { expect, test } from '@playwright/test';
import { signInAsTestOwner } from './auth';
import {
  SEED_DEGRADED_RUN_ID,
  SEED_GENERATING_RUN_ID,
  SEED_HELD_RUN_ID,
  SEED_RUN_ID,
  clearDegradedLesson,
  clearHeldLesson,
  seedDegradedLesson,
  seedHeldLesson,
} from './seed';
import { GENERATING_STATUS_PAYLOAD, GENERATING_STATUS_PAYLOAD_CODE } from './generating-fixture';

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
  // curriculum (and deliberately NO topic meta), so page.tsx renders the generating branch for the owner
  // (not a 404) and the header honestly degrades to a bare "Generating…". DESIGN.md wins.
  //
  // This captures the reader-route refresh path's honest NO-TOPIC degrade (a run_owner with no recorded
  // topic — e.g. a legacy dispatch). After consolidation there is ONE generating screen (run-lifecycle
  // #225), so the TOPIC-BEARING header ("Generating <topic>…", Figma 1:2's headline) is the SAME screen
  // with the run's `run_owner.topic` supplied via the poll's `meta`; it is exercised FUNCTIONALLY by the
  // real create-flow spec (generating-create-flow.spec.ts) rather than a separate divergent in-place
  // shell capture (the prior `generating-create.png` capture is retired with that shell).

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

  // The CODE-PHASE capture (PR-4 / #180): the live "Writing the lesson…" bar on the Code column node while
  // `code` streams. Pin the status poll to the code-running payload (plan/research/brief/spec done, code
  // running at ~60%, research 3/3) so the bar renders deterministically; the running-code live timer +
  // caption are masked (they tick off the wall clock). The bar fill itself is fixed (the fraction is
  // pinned, the width transition zeroed under reduced motion).
  test('the live code-phase progress bar matches the committed baseline', async ({ page, context, baseURL }) => {
    await signInAsTestOwner(context, baseURL ?? '');
    await page.route(`**/api/lesson/${SEED_GENERATING_RUN_ID}/status`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: SEED_GENERATING_RUN_ID, ...GENERATING_STATUS_PAYLOAD_CODE }),
      });
    });

    await page.goto(`/lesson/${SEED_GENERATING_RUN_ID}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/generating/i);
    // The Code column node carries the live bar (code running). Assert it before capturing.
    const bar = page.getByTestId('gen-codebar');
    await expect(bar).toBeVisible();
    await expect(bar).toHaveAttribute('aria-valuenow', '60');
    await expect(bar).toContainText(/writing the lesson/i);

    const liveTimer = page.locator('.gen-pstep--running .gen-pstep__time, .gen-progress__caption');
    await expect(page).toHaveScreenshot('generating-code.png', {
      fullPage: true,
      mask: [liveTimer],
    });
  });
});

test.describe('visual — frozen completed-workflow page (issue #232, owner-only)', () => {
  // The PRESERVED completed-workflow page (run-lifecycle 3/4) — GeneratingView in mode="frozen" at the
  // /lesson/[id]/workflow route, re-rendered AT REST from the durable step_event + research_event the
  // BUILT seed carries. It is fully static (no LiveTimer, no pulse, the entrance suppressed) and the
  // seeded timelines are FIXED, so the whole page is byte-stable — no masking needed. DESIGN.md wins.

  test('the frozen /workflow page matches the committed baseline', async ({ page, context, baseURL }) => {
    await signInAsTestOwner(context, baseURL ?? '');
    await page.goto(`/lesson/${SEED_RUN_ID}/workflow`);
    // The frozen surfaces are present before capture (past-tense header, the terminal chip, the band).
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Generated');
    await expect(page.getByTestId('gen-disposition')).toContainText('Built');
    await expect(page.getByTestId('gen-research-band')).toContainText('3 / 3 extracted');
    await expect(page).toHaveScreenshot('workflow-frozen.png', { fullPage: true });
  });
});

test.describe('visual — build-summary disclosure (issue #175, owner-only)', () => {
  // The owner-only "How this was built" disclosure on the persisted lesson page. ELEMENT-scoped snapshots
  // (the disclosure box, not the whole page) so the captures are deterministic regardless of the iframe
  // artifact / library grid. The seeded timelines (e2e/seed.ts) are FIXED, so the frozen per-step
  // durations + wall-clock span are byte-stable — no masking needed (the LiveTimer is dropped at rest).

  // The DEGRADED `soon` lesson is a 2nd owner library card, so it is seeded ONLY for this describe (not
  // globally) and cleared after — keeping the earlier library-dense-card snapshot at exactly one card.
  test.beforeAll(seedDegradedLesson);
  test.afterAll(clearDegradedLesson);

  test('BUILT — collapsed then expanded matches the committed baseline', async ({ page, context, baseURL }) => {
    await signInAsTestOwner(context, baseURL ?? '');
    await page.goto(`/lesson/${SEED_RUN_ID}`);
    const disclosure = page.locator('.build-summary');
    await expect(disclosure).toBeVisible();
    // COLLAPSED Tier-0 summary.
    await expect(disclosure.locator('summary')).toContainText('How this was built');
    await expect(disclosure).toHaveScreenshot('build-summary-built-collapsed.png');
    // EXPANDED frozen rail.
    await disclosure.locator('summary').click();
    await expect(disclosure.locator('.build-summary__rail')).toBeVisible();
    await expect(disclosure).toHaveScreenshot('build-summary-built-expanded.png');
  });

  test('DEGRADED — collapsed then expanded matches the committed baseline', async ({ page, context, baseURL }) => {
    await signInAsTestOwner(context, baseURL ?? '');
    await page.goto(`/lesson/${SEED_DEGRADED_RUN_ID}`);
    const disclosure = page.locator('.build-summary');
    await expect(disclosure).toBeVisible();
    await expect(disclosure.locator('summary')).toContainText('See what happened');
    await expect(disclosure).toHaveScreenshot('build-summary-degraded-collapsed.png');
    await disclosure.locator('summary').click();
    await expect(disclosure.locator('.build-summary__rail')).toBeVisible();
    await expect(disclosure).toHaveScreenshot('build-summary-degraded-expanded.png');
  });
});

// The HELD disclosure (issue #215): a critic-rejected lesson that DID render (status `soon` + html present)
// reads "See what happened · held back for review · ✗ not published" over an ALL-✓ six-stage rail. A NET-NEW
// visible state (not a shifted screen) — its baseline is committed fresh. Seeded describe-scoped (the held
// `soon` curriculum is a 2nd owner library card) so the earlier library-dense-card snapshot stays one card.
test.describe('visual — build-summary disclosure HELD (issue #215, owner-only)', () => {
  test.beforeAll(seedHeldLesson);
  test.afterAll(clearHeldLesson);

  test('HELD — collapsed then expanded matches the committed baseline', async ({ page, context, baseURL }) => {
    await signInAsTestOwner(context, baseURL ?? '');
    await page.goto(`/lesson/${SEED_HELD_RUN_ID}`);
    const disclosure = page.locator('.build-summary');
    await expect(disclosure).toBeVisible();
    await expect(disclosure.locator('summary')).toContainText('held back for review');
    await expect(disclosure).toHaveScreenshot('build-summary-held-collapsed.png');
    await disclosure.locator('summary').click();
    await expect(disclosure.locator('.build-summary__rail')).toBeVisible();
    await expect(disclosure).toHaveScreenshot('build-summary-held-expanded.png');
  });
});
