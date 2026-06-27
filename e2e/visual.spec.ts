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
  test('the library intake chrome matches the committed baseline', async ({ page, context, baseURL }) => {
    await signInAsTestOwner(context, baseURL ?? '');
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: /generate/i })).toBeVisible();

    // The library is owner-scoped over a SHARED Postgres the smoke spec's generate test also writes
    // to, so a FULL-PAGE capture would be non-deterministic — the lesson-card grid's count, titles,
    // and total page HEIGHT change run to run. Snapshot the ELEMENT that is invariant of the owner's
    // lesson history instead: the intake form section (the generation entry chrome — DESIGN.md
    // "## Components" Library/Intake). This grades the stable, load-bearing chrome (field labels,
    // inputs, the Generate button, spacing, tokens) deterministically. (When the Figma rebuild
    // re-captures the library, seed a fixed lesson fixture to add a full-page card-grid snapshot.)
    const intake = page.locator('.library-intake');
    await expect(intake).toBeVisible();
    await expect(intake).toHaveScreenshot('library-intake.png');
  });
});
