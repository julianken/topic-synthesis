import { expect, test } from '@playwright/test';
import { signInAsTestOwner } from './auth';

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
  // Figma 6:6) and the folded-in generation intake (.library-intake — "New lesson" heading + form, Figma
  // 6:2 frame copy). The run-dependent card grid (.library-grid) and the section title's right-aligned
  // hint are deliberately NOT captured here. DESIGN.md wins on any design conflict.

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

  test('the library intake chrome renders its full load-bearing structure', async ({
    page,
    context,
    baseURL,
  }) => {
    await signInAsTestOwner(context, baseURL ?? '');
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // The intake section (the generation entry chrome — DESIGN.md "## Components" Library/Intake) is
    // graded STRUCTURALLY here, NOT by a pixel snapshot. It is text-dense with a SERIF system heading
    // (Iowan Old Style — NOT a self-hosted webfont) plus the native `<select>`/range controls, which on
    // macOS font-SMOOTHING render with sub-pixel AA variance frame-to-frame — a whole-element shimmer no
    // mask/scale/tolerance combination stabilised reliably across runs. Rather than ship a locally-flaky
    // pixel baseline, this test asserts the intake's full load-bearing structure is present and correct
    // (the "New lesson" heading, every labelled field, and the Generate pill). A re-skin that DROPS a
    // field or the heading fails here; the deterministic pixel grading of the rebuilt library lives on
    // the stable `.appbar` header snapshot above. (When the form's fonts/controls become deterministic
    // — e.g. a self-hosted serif — promote this back to a pixel snapshot.)
    const intake = page.locator('.library-intake');
    await expect(intake).toBeVisible();
    await expect(intake.getByRole('heading', { name: /new lesson/i })).toBeVisible();
    await expect(intake.getByText(/Topic/)).toBeVisible();
    await expect(intake.getByText(/Level/)).toBeVisible();
    await expect(intake.getByText(/Depth/)).toBeVisible();
    await expect(intake.getByText(/Audience/)).toBeVisible();
    await expect(intake.getByRole('textbox').first()).toBeVisible();
    await expect(intake.getByRole('combobox')).toBeVisible();
    await expect(intake.getByRole('slider')).toBeVisible();
    await expect(intake.getByRole('button', { name: /generate/i })).toBeVisible();
  });
});
