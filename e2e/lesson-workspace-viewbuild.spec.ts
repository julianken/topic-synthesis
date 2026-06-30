import { expect, test } from '@playwright/test';
import { signInAsTestOwner } from './auth';
import { SEED_RUN_ID } from './seed';

// lesson-workspace-viewbuild.spec — the BUILT-reader "See the full build" affordance (run-lifecycle 4/4,
// issue #233): the quiet escalation in the reader head (`.reader-build-link`, slotted after the #175 "How
// this was built" disclosure) that links the owner to 3/4's preserved completed-build page
// (`/lesson/[id]/workflow`). RIGOROUS + DETERMINISTIC behavioural assertions (DOM + accessible role +
// measured geometry, not pixels) at BOTH DESIGN.md viewports (the mobile fold-geometry block runs ≤640
// only). The global setup (e2e/seed.ts) seeds SEED_RUN_ID — a BUILT lesson owned by the e2e owner — so the
// reader shell (and thus this affordance) renders. Pixel grading lives in visual.spec.ts.
//
// The route segment `/workflow` is a CODE PATH, never user copy — the affordance's accessible NAME is the
// bare "See the full build", with NO dev-speak (§"No project internals in user UI"); these tests assert
// that boundary as well as the link target + keyboard reachability + the cross-document navigation.

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test.describe('lesson-workspace-viewbuild — the "See the full build" affordance (issue #233)', () => {
  test('renders ONCE in the built reader for the owner, with the bare-label accessible name + the 3/4 href (AC1–3,7)', async ({
    page,
    context,
    baseURL,
  }) => {
    await signInAsTestOwner(context, baseURL ?? '');
    await page.goto(`/lesson/${SEED_RUN_ID}`);

    // The built reader shell renders (not the degraded state), so the affordance is present.
    await expect(page.locator('.reader.reader--ws')).toBeVisible();

    // ACCESSIBLE NAME is the bare label — the decorative `→` is aria-hidden, and NO dev-speak leaks in
    // (no "workflow"/"pipeline"/route ids); the route segment is a code path, never the label.
    const link = page.getByRole('link', { name: 'See the full build', exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveClass(/reader-build-link/);
    const accName = (await link.getAttribute('aria-label')) ?? (await link.innerText());
    expect(accName).not.toMatch(/workflow|pipeline/i);

    // HREF equals 3/4's exact route literal `/lesson/${id}/workflow`.
    await expect(link).toHaveAttribute('href', `/lesson/${SEED_RUN_ID}/workflow`);

    // It lives INSIDE the reader head, directly after the "How this was built" disclosure (placement).
    await expect(page.locator('.reader-head > .reader-build-link')).toHaveCount(1);

    // SOLE built-reader link to /workflow — the BUILT-branch BuildSummary stays byte-unchanged, so its
    // degraded-only "See the full workflow" link never renders here (no double link — AC6).
    await expect(page.locator('.reader-build-link')).toHaveCount(1);
    await expect(page.locator('.build-summary__workflow-link')).toHaveCount(0);
  });

  test('keyboard focus reaches the affordance and it shows a :focus-visible ring (AC4,8)', async ({
    page,
    context,
    baseURL,
  }) => {
    await signInAsTestOwner(context, baseURL ?? '');
    await page.goto(`/lesson/${SEED_RUN_ID}`);

    // Tab from the disclosure's <summary> (the only focusable target in the collapsed disclosure, which
    // sits immediately before the affordance in the DOM) so focus arrives via the KEYBOARD — the condition
    // that makes :focus-visible match. This proves real keyboard reachability, not a programmatic .focus().
    const summary = page.locator('.build-summary summary');
    await expect(summary).toBeVisible();
    await summary.focus();
    await page.keyboard.press('Tab');

    const link = page.locator('.reader-build-link');
    await expect(link).toBeFocused();
    // The :focus-visible ring is applied (status/affordance by a real outline, §Accessibility), and it is a
    // solid outline of non-zero width — the keyboard-focus ring, not a removed/zero outline.
    const ring = await link.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { focusVisible: el.matches(':focus-visible'), style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) };
    });
    expect(ring.focusVisible).toBe(true);
    expect(ring.style).toBe('solid');
    expect(ring.width).toBeGreaterThan(0);
  });

  test('clicking the affordance navigates cross-document to /workflow and renders the 3/4 frozen view (AC9)', async ({
    page,
    context,
    baseURL,
  }) => {
    await signInAsTestOwner(context, baseURL ?? '');
    await page.goto(`/lesson/${SEED_RUN_ID}`);

    await page.locator('.reader-build-link').click();

    // It lands on the EXACT 3/4 route...
    await expect(page).toHaveURL(new RegExp(`/lesson/${SEED_RUN_ID}/workflow$`));
    // ...and renders 3/4's FROZEN completed-build composition (GeneratingView in mode="frozen"): the .gen
    // root + the terminal disposition chip (the live-only phase shimmer is absent on the frozen page).
    await expect(page.locator('.gen')).toBeVisible();
    const chip = page.getByTestId('gen-disposition');
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('Built');
    await expect(page.getByTestId('gen-live-phase')).toHaveCount(0);
  });
});

test.describe('lesson-workspace-viewbuild — mobile fold geometry (≤640, AC10)', () => {
  // ≤640 only: the affordance must not crowd the narrow reader head. The desktop project (1440) skips —
  // its head has ample room; the fold-crowd risk is the phone width.
  test.skip(({ viewport }) => (viewport?.width ?? 0) > 640, 'the mobile fold-crowd check applies only at ≤640');

  test('the reader head + the affordance lay out without crowding past the fold', async ({
    page,
    context,
    baseURL,
    viewport,
  }) => {
    await signInAsTestOwner(context, baseURL ?? '');
    await page.goto(`/lesson/${SEED_RUN_ID}`);

    const link = page.locator('.reader-build-link');
    const disclosure = page.locator('.build-summary');
    await expect(link).toBeVisible();
    await expect(disclosure).toBeVisible();

    const vw = viewport?.width ?? 390;
    const linkBox = await link.boundingBox();
    const discBox = await disclosure.boundingBox();
    expect(linkBox).not.toBeNull();
    expect(discBox).not.toBeNull();
    if (!linkBox || !discBox) return;

    // (1) The affordance STACKS BELOW the disclosure — it doesn't overlap the build concept above it.
    expect(linkBox.y).toBeGreaterThanOrEqual(discBox.y + discBox.height - 1);

    // (2) It fits within the viewport width — no horizontal crowding/clipping past the right edge.
    expect(linkBox.x).toBeGreaterThanOrEqual(0);
    expect(linkBox.x + linkBox.width).toBeLessThanOrEqual(vw + 1);

    // (3) The reader head introduces NO horizontal document overflow at the narrow width (the whole head,
    // affordance included, fits the fold — a real "doesn't crowd" guarantee).
    const noHOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    );
    expect(noHOverflow).toBe(true);
  });
});
