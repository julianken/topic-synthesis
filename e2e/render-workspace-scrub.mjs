// One-off render of the BUILT lesson-workspace SCRUB RAIL (PR-C) at desktop + mobile via the test-auth
// seam. NOT part of the suite (run by hand): reuses e2e/auth.ts's seeded __session cookie against a
// running standalone server (AUTH_PROVIDER=fake) + the global-setup-seeded built lesson, drives a
// deterministic scrollProgress so the dot-rail shows an active dot, and writes /tmp PNGs.
import { chromium } from '@playwright/test';

const BASE = process.env.RENDER_BASE_URL ?? 'http://localhost:4399';
const SESSION_COOKIE = '__session';
const E2E_SESSION_COOKIE = 'e2e-session';
const SEED_RUN_ID = 'e2e-seed-photosynthesis';

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 1000, out: '/tmp/wsc-desktop.png' },
  { name: 'mobile', width: 390, height: 844, out: '/tmp/wsc-mobile.png' },
];

const browser = await chromium.launch();
try {
  const { hostname } = new URL(BASE);
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      reducedMotion: 'reduce',
    });
    await context.addCookies([
      { name: SESSION_COOKIE, value: E2E_SESSION_COOKIE, domain: hostname, path: '/', httpOnly: true, sameSite: 'Lax' },
    ]);
    const page = await context.newPage();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${BASE}/curriculum/${SEED_RUN_ID}`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { level: 1 }).first().waitFor();
    await page.locator('.ws-grid').waitFor();
    // Drive a deterministic reading position (~60%) so the dot-rail lights an active dot + the where-am-i.
    // Retried until the where-am-i percent appears (the seed sender registers its listener on load).
    for (let i = 0; i < 40; i += 1) {
      await page.evaluate(() => {
        const f = document.querySelector('iframe.artifact-frame');
        f?.contentWindow?.postMessage({ type: 'lesson:set-progress', scrollProgress: 0.6 }, '*');
      });
      if ((await page.locator('.ws-where__percent').count()) > 0) break;
      await page.waitForTimeout(100);
    }
    await page.screenshot({ path: vp.out, animations: 'disabled' });
    console.log(`wrote ${vp.out} (${vp.width}x${vp.height})`);
    await context.close();
  }
} finally {
  await browser.close();
}
