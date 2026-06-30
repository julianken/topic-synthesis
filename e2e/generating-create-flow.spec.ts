import { expect, test, type Route } from '@playwright/test';
import { signInAsTestOwner } from './auth';
import { SEED_GENERATING_RUN_ID } from './seed';
import { STEP_SEQUENCE, type StepSnapshot } from './stepthrough-fixture';

// generating-create-flow.spec — the REAL user-path regression test for run-lifecycle #225. The live
// code-phase progress bar (#180/#183) never appeared for real users because there were TWO divergent
// <GeneratingView> consumers: the in-place shell at `/` (what users saw during generation) OMITTED
// codeProgress, and the wired consumer at /lesson/[id] was only reached AFTER the run landed. The existing
// generating specs drive the /lesson/[id] route DIRECTLY (a `page.goto`), so they never exercised the screen
// users actually traverse — the gap the divergence slipped through. THIS spec drives the ACTUAL path:
// library → +New → fill topic → Generate → assert the create form NAVIGATES to /lesson/[id], the typed topic
// reaches the header server-side (run-lifecycle #225 — via the run's owner-gated `meta`), AND the
// "Writing the lesson…" progress bar renders with a RISING aria-valuenow while the `code` stage runs.
//
// DETERMINISM (rigorous + robust e2e — no flaky sleeps): /api/generate is pinned to the seeded in-flight run
// id so no in-process run executes + persists (which would navigate to a BUILT lesson); the status poll is
// intercepted with a MUTABLE cursor + the run's `meta`. Every assertion is a web-first auto-retrying matcher
// over DOM state, with the fill growth measured via getBoundingClientRect (not eyeballed). Reduced motion is
// forced. Selectors are role / data-testid / class hooks — never brittle copy.

const META = { topic: 'Photosynthesis', level: 'intro', depth: 2 };

const find = (name: string): StepSnapshot => {
  const s = STEP_SEQUENCE.find((x) => x.name === name);
  if (!s) throw new Error(`fixture snapshot "${name}" not found`);
  return s;
};

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('the create-form flow NAVIGATES to /lesson/[id] and the live code bar RISES while code runs (#225)', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(60_000);
  await signInAsTestOwner(context, baseURL ?? '');

  // The MUTABLE status cursor — advancing it + the page's poll lands the next state (no sleeps). Start in
  // the early code-running snapshot (fraction 0.2 → aria-valuenow 20); later push raises it to 0.6 → 60.
  let current: StepSnapshot = find('code-running');
  const codeLater = find('code-running-2');

  // Pin /api/generate to the seeded in-flight run id: the REAL POST fires (we still drive the real form),
  // but the canned 202 means no in-process stub run executes + persists (which would navigate to a built
  // lesson). The status poll carries the scripted code progress + the run's `meta` (so the destination
  // header shows the typed topic + settings SERVER-side — the create form no longer passes them client-side).
  await page.route('**/api/generate', async (route) => {
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ id: SEED_GENERATING_RUN_ID }),
    });
  });
  await page.route(`**/api/lesson/${SEED_GENERATING_RUN_ID}/status`, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: SEED_GENERATING_RUN_ID, ...current.payload, meta: META }),
    });
  });

  // THE REAL USER PATH (the screen the divergence slipped through): library → +New → fill topic → Generate.
  await page.goto('/');
  await page.getByRole('button', { name: /new lesson/i }).click();
  await page.getByRole('textbox').first().fill('Photosynthesis');
  await page.getByRole('button', { name: /generate/i }).click();

  // AC1/AC5 — on the 202 the create form NAVIGATES to the SINGLE generating screen at /lesson/[id].
  await expect(page).toHaveURL(new RegExp(`/lesson/${SEED_GENERATING_RUN_ID}$`));

  // AC3 — the typed topic reaches the header SERVER-side (run-lifecycle #225: via the run's owner-gated
  // `meta` from `run_owner`), not a bare "Generating…".
  const h1 = page.getByRole('heading', { level: 1 });
  await expect(h1).toContainText(/generating/i);
  await expect(h1.locator('.gen-topic__topic')).toHaveText('Photosynthesis');

  // AC5 — the live "Writing the lesson…" bar renders while `code` runs (the whole point: it never rendered
  // for real users because the in-place consumer omitted codeProgress). State by LABEL + bar (a
  // role=progressbar with aria-valuenow), never color alone — §Accessibility.
  const bar = page.getByTestId('gen-codebar');
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute('role', 'progressbar');
  await expect(bar).toContainText(/writing the lesson/i);
  await expect(bar).toHaveAttribute('aria-valuenow', '20');
  const fillWidth = async (): Promise<number> =>
    page.locator('.gen-codebar__fill').evaluate((el) => el.getBoundingClientRect().width);
  const w1 = await fillWidth();

  // Advance the SAME code step → aria-valuenow RISES 20 → 60 and the fill GROWS (measured, not eyeballed).
  current = codeLater;
  await expect(bar).toHaveAttribute('aria-valuenow', '60');
  const w2 = await fillWidth();
  expect(w2, `the bar fill grows ${w1.toFixed(1)}→${w2.toFixed(1)}px as the fraction rises 0.2→0.6`).toBeGreaterThan(w1);
});
