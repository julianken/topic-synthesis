// One-off render of the BUILT lesson-workspace APPARATUS PANEL WITH REAL DATA (PR-F) for the PR
// screenshots. NOT part of the suite (run by hand): reuses e2e/auth.ts's seeded __session cookie against
// a running standalone server (AUTH_PROVIDER=fake) + the global-setup-seeded built lesson (whose stub
// sender now posts the coordinate-only `apparatus` extension). Drives the channel by posting
// `lesson:set-progress` INTO the iframe (the stub re-emits progress + apparatus outward), then captures:
//   • desktop 1440 — the panel with REAL key terms / figure caption / source link / self-check / takeaways;
//   • mobile 390   — the same apparatus in the collapsed single-column panel (below the read column);
//   • desktop 1440 OLD-SHAPE — driver withApparatus:false → the richer cards fall back to placeholders.
import { chromium } from '@playwright/test';

const BASE = process.env.RENDER_BASE_URL ?? 'http://localhost:4311';
const SESSION_COOKIE = '__session';
const E2E_SESSION_COOKIE = 'e2e-session';
const SEED_RUN_ID = 'e2e-seed-photosynthesis';

async function driveProgress(page, p, withApparatus = true) {
  for (let i = 0; i < 40; i++) {
    await page.evaluate(
      ({ prog, wa }) => {
        const f = document.querySelector('iframe.artifact-frame');
        f?.contentWindow?.postMessage({ type: 'lesson:set-progress', scrollProgress: prog, withApparatus: wa }, '*');
      },
      { prog: p, wa: withApparatus },
    );
    const sel = withApparatus ? '.ws-glosscard[data-filled]' : '.ws-glosscard[data-awaiting]';
    if ((await page.locator(sel).count()) > 0) return;
    await page.waitForTimeout(100);
  }
}

const browser = await chromium.launch();
try {
  const { hostname } = new URL(BASE);

  async function shot({ width, height, out, progress, withApparatus = true, openCheck = false, scrollToPanel = false }) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
    await context.addCookies([
      { name: SESSION_COOKIE, value: E2E_SESSION_COOKIE, domain: hostname, path: '/', httpOnly: true, sameSite: 'Lax' },
    ]);
    const page = await context.newPage();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${BASE}/curriculum/${SEED_RUN_ID}`, { waitUntil: 'networkidle' });
    await page.locator('.ws-panel .ws-app').waitFor();
    await driveProgress(page, progress, withApparatus);
    if (openCheck) await page.locator('.ws-check[data-filled] .ws-check__prompt').first().click();
    // On the mobile single-column collapse the apparatus reflows below the read column — scroll it into
    // view so the capture shows the apparatus DATA, not just the read column above it.
    if (scrollToPanel) await page.locator('.ws-glosscard[data-filled]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: out, animations: 'disabled' });
    console.log(`wrote ${out} (${width}x${height}${withApparatus ? '' : ', old-shape'})`);
    await context.close();
  }

  await shot({ width: 1440, height: 1100, out: '/tmp/wsf-desktop.png', progress: 0.5, openCheck: true });
  await shot({ width: 390, height: 900, out: '/tmp/wsf-mobile.png', progress: 0.5, openCheck: true, scrollToPanel: true });
  await shot({ width: 1440, height: 1100, out: '/tmp/wsf-oldshape.png', progress: 0.5, withApparatus: false });
} finally {
  await browser.close();
}
