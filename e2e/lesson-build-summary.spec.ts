import { expect, test } from '@playwright/test';
import { signInAsTestOwner } from './auth';
import { SEED_DEGRADED_RUN_ID, SEED_RUN_ID, clearDegradedLesson, seedDegradedLesson } from './seed';

// lesson-build-summary.spec — the owner-only "How this was built" disclosure (issue #175, epic PR-5).
// RIGOROUS + DETERMINISTIC behavioural assertions (DOM + text, not pixels) at BOTH DESIGN.md viewports
// (the desktop + mobile projects run every test). The global setup (e2e/seed.ts) seeds:
//   • SEED_RUN_ID — a BUILT lesson with a DURABLE six-stage step_event timeline (kept past persist), and
//   • SEED_DEGRADED_RUN_ID — a `soon` (degraded) lesson whose `code` step THREW (status='error').
// Both are owned by the e2e owner. Pixel grading lives in visual.spec.ts; this spec proves the contract.

// The raw engine stage identifiers that must NEVER reach this reading surface (no-project-internals).
const RAW_STAGE_NAMES = ['plan', 'research', 'brief', 'spec', 'code', 'critic'];

/** Assert the disclosure's full (expanded) text leaks none of the forbidden internals (the copy-gate at
 *  the LIVE rendered level, complementing the unit copy-gate in build-summary.test.ts). */
function assertNoLeaks(text: string): void {
  for (const raw of RAW_STAGE_NAMES) {
    // word-boundary: "Planning"/"Researching" (the learner words) must not trip — only the raw token.
    expect(text, `raw stage name "${raw}" leaked`).not.toMatch(new RegExp(`\\b${raw}\\b`, 'i'));
  }
  expect(text).not.toMatch(/\btokens?\b/i);
  expect(text).not.toMatch(/\bcost\b/i);
  expect(text).not.toMatch(/\bmodel\b/i);
  expect(text).not.toMatch(/\bttft\b/i);
  expect(text).not.toMatch(/\$/);
  expect(text).not.toMatch(/\bhaiku\b|\bsonnet\b|\bopus\b|\bgpt\b|\bgemini\b|\bclaude\b/i);
  expect(text).not.toMatch(/\d\s*ms\b/i); // milliseconds — durations are whole/decimal seconds only
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test.describe('build-summary — BUILT lesson (the "How this was built" disclosure)', () => {
  test('renders collapsed by default, expands to the frozen learner-safe six-stage rail', async ({
    page,
    context,
    baseURL,
  }) => {
    await signInAsTestOwner(context, baseURL ?? '');
    await page.goto(`/lesson/${SEED_RUN_ID}`);

    const disclosure = page.locator('.build-summary');
    await expect(disclosure).toBeVisible();

    // COLLAPSED Tier-0 summary: "How this was built · built in 47s · 6 steps · ✓ passed".
    const summary = disclosure.locator('summary');
    await expect(summary).toContainText('How this was built');
    await expect(summary).toContainText('built in 47s');
    await expect(summary).toContainText('6 steps');
    await expect(summary).toContainText('passed');
    // It starts CLOSED (the rail body is not yet in the layout).
    await expect(disclosure).not.toHaveJSProperty('open', true);
    await expect(disclosure.locator('.build-summary__rail')).toBeHidden();

    // EXPAND (the only interactive target is the <summary>).
    await summary.click();
    await expect(disclosure).toHaveJSProperty('open', true);
    const rail = disclosure.locator('.build-summary__rail');
    await expect(rail).toBeVisible();

    // The FROZEN six-stage rail with LEARNER-SAFE labels (never plan/spec/critic/code).
    const rows = rail.locator('.build-summary__row');
    await expect(rows).toHaveCount(6);
    await expect(rows.locator('.build-summary__label')).toHaveText([
      /Planning/,
      /Researching/,
      /Drafting/,
      /Designing/,
      /Building/,
      /Reviewing/,
    ]);
    // Frozen per-step durations (no live timer): every row shows a "N.Ns" duration.
    for (let i = 0; i < 6; i++) {
      await expect(rows.nth(i).locator('.build-summary__time')).toHaveText(/^\d+\.\d+s$/);
    }
    // Every stage done → ✓; the state word is present for AT (status by label + icon, not colour alone).
    await expect(rows.locator('.build-summary__glyph').first()).toHaveText('✓');
    await expect(rows.first().locator('.build-summary__sr')).toContainText('done');
    // The state legend is present.
    await expect(disclosure.locator('.build-summary__legend')).toBeVisible();
  });

  test('COPY-GATE: the rendered disclosure leaks no token/cost/model/ms/raw-stage-name', async ({
    page,
    context,
    baseURL,
  }) => {
    await signInAsTestOwner(context, baseURL ?? '');
    await page.goto(`/lesson/${SEED_RUN_ID}`);
    const disclosure = page.locator('.build-summary');
    await expect(disclosure).toBeVisible();
    await disclosure.locator('summary').click(); // expand so the rail text is included
    await expect(disclosure.locator('.build-summary__rail')).toBeVisible();
    assertNoLeaks((await disclosure.innerText()).toString());
  });
});

test.describe('build-summary — DEGRADED lesson (the "See what happened" entry)', () => {
  // Seed the `soon` degraded lesson ONLY for this describe (it is a 2nd owner library card, so it is kept
  // out of the global seed) and clear it after, leaving the library-snapshot tests at one dense card.
  test.beforeAll(seedDegradedLesson);
  test.afterAll(clearDegradedLesson);

  test('the degraded branch surfaces a higher-intent disclosure with a per-stage ✗ on the thrown step', async ({
    page,
    context,
    baseURL,
  }) => {
    await signInAsTestOwner(context, baseURL ?? '');
    await page.goto(`/lesson/${SEED_DEGRADED_RUN_ID}`);

    // The degraded state renders (not the built reader shell).
    await expect(page.locator('.lesson-degraded')).toBeVisible();

    const disclosure = page.locator('.build-summary');
    await expect(disclosure).toBeVisible();
    await expect(disclosure).toHaveAttribute('data-degraded', 'true');

    const summary = disclosure.locator('summary');
    await expect(summary).toContainText('See what happened');
    await expect(summary).toContainText("couldn't finish");
    await expect(summary).toContainText('not built');

    await summary.click();
    await expect(disclosure.locator('.build-summary__rail')).toBeVisible();

    // The `code` stage THREW → its row carries a per-stage ✗ + the "didn't finish" state word; `critic`
    // never ran → "didn't run" (NOT a ✗). The learner-safe labels are Building / Reviewing.
    const building = disclosure.locator('.build-summary__row[data-state="error"]');
    await expect(building).toHaveCount(1);
    await expect(building.locator('.build-summary__label')).toContainText('Building');
    await expect(building.locator('.build-summary__glyph')).toHaveText('✗');
    await expect(building.locator('.build-summary__sr')).toContainText("didn't finish");

    const reviewing = disclosure.locator('.build-summary__row', { hasText: 'Reviewing' });
    await expect(reviewing).toHaveAttribute('data-state', 'pending');

    assertNoLeaks((await disclosure.innerText()).toString());
  });
});

test.describe('build-summary — owner gate (co-located under getLesson owner-scoping)', () => {
  test('an absent lesson id for the owner 404s — no disclosure (inherits the getLesson WHERE owner_sub filter)', async ({
    page,
    context,
    baseURL,
  }) => {
    await signInAsTestOwner(context, baseURL ?? '');
    // A lesson id the owner does NOT own → getLesson returns null AND ownsRun is false → notFound (404).
    // The disclosure is server-rendered ONLY past that gate, so a non-owned id can never surface it.
    const res = await page.goto('/lesson/not-an-owned-lesson-id');
    expect(res?.status()).toBe(404);
    await expect(page.locator('.build-summary')).toHaveCount(0);
  });

  test('an unauthenticated visitor is redirected to sign-in — never the disclosure', async ({ page }) => {
    // No session cookie → getSessionIdentity null → redirect to /sign-in before any render.
    await page.goto(`/lesson/${SEED_RUN_ID}`);
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.locator('.build-summary')).toHaveCount(0);
  });
});
