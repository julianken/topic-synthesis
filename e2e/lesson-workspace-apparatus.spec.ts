import { expect, test, type Page } from '@playwright/test';
import { signInAsTestOwner } from './auth';
import { SEED_RUN_ID } from './seed';

// lesson-workspace-apparatus.spec — the BUILT-APP proof for the PR-F apparatus DATA path. The reader
// CHROME's richer apparatus cards (key terms / figure caption / source / self-check / takeaways) now
// light up from the OPTIONAL coordinate-only `apparatus` extension to the { sections, scrollProgress }
// postMessage (lesson-message.ts — extended + sanitized). The seeded built lesson's HTML carries a
// coordinate-only STUB SENDER (e2e/seed.ts) that posts the apparatus alongside progress; the spec drives
// it via the `lesson:set-progress` driver and asserts:
//   • the richer cards render the REAL posted glosses / figure caption / source link / self-check / takeaways;
//   • the source renders as a SAFE rel="noopener noreferrer" http(s) link (the href validated, text-only title);
//   • the self-check answer is GATED behind the prompt (native <details>) and reveals on activation;
//   • the BACKWARD-COMPAT old shape (driver withApparatus:false → no apparatus) falls back to placeholders
//     (decision-13 — a lesson posting only { sections, scrollProgress } still works, never a crash);
//   • the where-am-i widget keeps working alongside the filled cards.
//
// The spec NEVER reads the iframe contentDocument — it only POSTS coordinate-only data INTO the frame
// (the same channel a real in-iframe sender uses) and measures the CHROME's own panel DOM. The trust
// boundary (sandbox attrs + strict CSP + owner-scoping) is unchanged.

/** Open the seeded BUILT lesson as the e2e owner; wait for the reader heading, the grid, and the panel. */
async function openBuiltLesson(
  page: Page,
  context: import('@playwright/test').BrowserContext,
  baseURL: string | undefined,
): Promise<void> {
  await signInAsTestOwner(context, baseURL ?? '');
  await page.goto(`/curriculum/${SEED_RUN_ID}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('.ws-grid')).toBeVisible();
  await expect(page.locator('.ws-panel .ws-app')).toBeVisible();
}

/**
 * Drive the lesson iframe to a deterministic scrollProgress, optionally WITHOUT apparatus (the
 * backward-compat old shape). Coordinate-only: posts a number + a flag, reads no iframe DOM. Resilient:
 * retried via expect.poll until the chrome reflects the requested apparatus presence — the seed sender
 * registers its listener on load (a race the poll absorbs without a fixed sleep).
 */
async function driveProgress(page: Page, progress: number, withApparatus = true): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.evaluate(
          ({ p, wa }) => {
            const iframe = document.querySelector('iframe.artifact-frame') as HTMLIFrameElement | null;
            iframe?.contentWindow?.postMessage(
              { type: 'lesson:set-progress', scrollProgress: p, withApparatus: wa },
              '*',
            );
          },
          { p: progress, wa: withApparatus },
        );
        // When apparatus is requested, the filled gloss card is the signal; when omitted, the placeholder.
        return withApparatus
          ? page.locator('.ws-glosscard[data-filled]').count()
          : page.locator('.ws-glosscard[data-awaiting]').count();
      },
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0);
}

// ── The richer cards render REAL data from the apparatus extension ─────────────────────────────────────
test.describe('lesson-workspace apparatus — richer cards render REAL posted data (PR-F)', () => {
  test('key terms, figure caption, source link, self-check, and takeaways all light up with real values', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openBuiltLesson(page, context, baseURL);
    await driveProgress(page, 0.5);

    // Key terms — the posted glosses (term + definition) as escaped text.
    const gloss = page.locator('.ws-glosscard[data-filled]');
    await expect(gloss.locator('.ws-card__eyebrow')).toHaveText('Key terms');
    await expect(gloss.locator('.ws-gloss__term')).toHaveCount(2);
    await expect(gloss.locator('.ws-gloss__term').first()).toHaveText('Chlorophyll');
    await expect(gloss.locator('.ws-gloss__def').first()).toContainText('green pigment');

    // Figure — the posted CAPTION text only (the chrome renders no figure image; coordinate-only).
    const fig = page.locator('.ws-fig[data-filled]');
    await expect(fig.locator('.ws-fig__caption')).toContainText('leaf cross-section');

    // Source — a SAFE rel="noopener noreferrer" http(s) link: the title is the text, the validated url the href.
    const src = page.locator('.ws-src[data-filled] .ws-src__link');
    await expect(src).toHaveText('Encyclopaedia Britannica — Photosynthesis');
    await expect(src).toHaveAttribute('href', 'https://www.britannica.com/science/photosynthesis');
    const rel = (await src.getAttribute('rel')) ?? '';
    expect(rel).toContain('noopener');

    // Takeaways — the posted recap bullets as text.
    const take = page.locator('.ws-take[data-filled]');
    await expect(take.locator('.ws-take__item')).toHaveCount(2);
    await expect(take.locator('.ws-take__item').first()).toContainText('air and water');

    // The where-am-i widget keeps working alongside the filled richer cards.
    await expect(page.locator('.ws-where__percent')).toContainText('50');
  });

  test('the self-check answer is GATED behind the prompt and reveals on activation (predict-then-reveal)', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openBuiltLesson(page, context, baseURL);
    await driveProgress(page, 0.5);

    const check = page.locator('.ws-check[data-filled]');
    await expect(check.locator('.ws-check__prompt')).toContainText('mass come from');
    // Closed by default — the answer is not yet visible (native <details> hides it).
    await expect(check.locator('.ws-check__answer')).toBeHidden();
    // Activate the prompt → the answer reveals (keyboard-operable native disclosure).
    await check.locator('.ws-check__prompt').click();
    await expect(check.locator('.ws-check__answer')).toBeVisible();
    await expect(check.locator('.ws-check__answer')).toContainText('carbon in the air');
  });
});

// ── BACKWARD COMPAT: the old { sections, scrollProgress } shape → placeholders (no regression) ─────────
test.describe('lesson-workspace apparatus — backward-compatible old shape (PR-F)', () => {
  test('a lesson posting NO apparatus falls back to the 5 best-effort placeholders, never a crash', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openBuiltLesson(page, context, baseURL);
    // Drive the OLD shape (no apparatus) — the cards must revert to placeholders.
    await driveProgress(page, 0.5, false);

    // All 5 richer cards are placeholders again (the where-am-i is the 6th card, always live).
    await expect(page.locator('.ws-panel .ws-card[data-awaiting]')).toHaveCount(5);
    await expect(page.locator('.ws-panel .ws-card[data-filled]')).toHaveCount(0);
    // No real apparatus content leaked through — the gloss term/def + source link are absent.
    await expect(page.locator('.ws-gloss__term')).toHaveCount(0);
    await expect(page.locator('.ws-src__link')).toHaveCount(0);
    // The where-am-i widget (driven by the still-posted { sections, scrollProgress }) keeps working.
    await expect(page.locator('.ws-where__percent')).toContainText('50');
    // The trust boundary is intact (sandbox attr unchanged).
    await expect(page.locator('.ws-read iframe.artifact-frame')).toHaveAttribute('sandbox', 'allow-scripts');
  });
});
