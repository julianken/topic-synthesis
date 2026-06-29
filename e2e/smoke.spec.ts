import { expect, test } from '@playwright/test';
import { signInAsTestOwner } from './auth';

// smoke.spec — proves the whole harness end to end: the auth gate, the test-auth seam, and the
// generate→generating flow with the LLM pipeline + Job dispatch MOCKED (the webServer runs with
// E2E=1 → network-free stub deps, and no PIPELINE_JOB_NAME → in-process, never a real Cloud Run Job).
// No real Google OAuth, no model spend, no real Cloud Run dispatch — fast and hermetic.
//
// Selectors are deliberately RESILIENT to the upcoming Figma-driven chrome rebuild: they assert
// landmarks (main), roles (heading/button/textbox), and accessible names — NOT brittle exact copy or
// styling. A heading-name regex tolerates copy tweaks; where a name is load-bearing it is matched
// loosely. The point is to survive a re-skin while still catching a broken auth gate or a dead route.

test.describe('smoke — auth gate', () => {
  test('an UNAUTHENTICATED visit to the library redirects to /sign-in', async ({ page }) => {
    await page.goto('/');
    // The library route is auth-gated (page.tsx: getSessionIdentity() → redirect('/sign-in')).
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/sign in/i);
    // The sole sign-in affordance is a button (the Google consent trigger). Assert the role, not copy.
    await expect(page.getByRole('button')).toBeVisible();
  });
});

test.describe('smoke — test-auth seam (the allowlisted library render)', () => {
  test('with the seeded e2e session, the authed library renders with the +New create card', async ({
    page,
    context,
    baseURL,
  }) => {
    await signInAsTestOwner(context, baseURL ?? '');
    await page.goto('/');

    // Authed: NOT bounced to sign-in, and the library landmark + the create affordance are present.
    await expect(page).toHaveURL(/\/$|\/(?!sign-in)/);
    await expect(page).not.toHaveURL(/\/sign-in/);
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // The library's generation entry is the `+ New lesson` card (the morph ORIGIN) — assert by its
    // accessible name (a button), not brittle copy. Clicking it reveals the intake form.
    const newCard = page.getByRole('button', { name: /new lesson/i });
    await expect(newCard).toBeVisible();
    await newCard.click();
    // The revealed form exposes the topic textbox + the Generate submit.
    await expect(page.getByRole('textbox').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /generate/i })).toBeVisible();
  });
});

test.describe('smoke — generate → generating (pipeline + dispatch mocked)', () => {
  test('opening +New, filling a topic, and submitting POSTs /api/generate with the right body', async ({
    page,
    context,
    baseURL,
  }) => {
    await signInAsTestOwner(context, baseURL ?? '');
    await page.goto('/');

    // Open the create form via the +New card (the card-grows-into-form reveal; under the harness's forced
    // reduced motion the swap is instant, so the form is immediately interactive).
    await page.getByRole('button', { name: /new lesson/i }).click();

    // Capture the POST so we can assert the body shape the contract preserves: the four trimmed keys.
    const requestBodyPromise = page
      .waitForRequest((req) => req.url().endsWith('/api/generate') && req.method() === 'POST')
      .then((req) => req.postDataJSON() as Record<string, unknown>);

    // Fill the topic and submit. The form POSTs /api/generate which (E2E=1) runs the NETWORK-FREE stub
    // pipeline in-process and returns a runId; the in-place generating shell polls + navigates to
    // /lesson/<id> once the (fast) stub run lands.
    await page.getByRole('textbox').first().fill('Fourier transforms');
    await page.getByRole('button', { name: /generate/i }).click();

    // The submit contract is UNCHANGED: POST /api/generate { topic, level, depth, audience } (trimmed).
    const body = await requestBodyPromise;
    expect(body.topic).toBe('Fourier transforms');
    expect(body.level).toBe('intermediate'); // the default
    expect(body.depth).toBe(3); // the default
    expect(body).toHaveProperty('audience'); // present (empty string when unfilled)

    // Land on the reader route for the new run (the in-place generating shell navigates on ready).
    await expect(page).toHaveURL(/\/lesson\/[0-9a-f-]+$/i, { timeout: 30_000 });

    // The reader shows EITHER the generating state (run still in flight, polling status) OR — once the
    // fast network-free stub run has persisted — the built lesson. BOTH are valid harness-proving
    // outcomes, and which one renders is a timing race (the stub run completes in well under a second),
    // so the assertion must accept either WITHOUT depending on the built lesson's generated title.
    // Resilient contract: the reader landmark + a level-1 heading are present (the route resolved an
    // owned run, not a 404), and the page is NOT the unauth bounce or an error. That proves the whole
    // generate → reader path end to end; the rendered-lesson fidelity is the visual spec's job.
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page).not.toHaveURL(/\/sign-in/);
  });
});
