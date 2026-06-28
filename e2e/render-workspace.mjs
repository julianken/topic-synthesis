// One-off render of the BUILT lesson-workspace (PR-A grid foundation) at three widths via the test-auth
// seam. NOT part of the suite (run by hand): reuses e2e/auth.ts's seeded __session cookie against a
// running standalone server (AUTH_PROVIDER=fake) and the global-setup-seeded built lesson. Writes /tmp PNGs.
import { chromium } from '@playwright/test';

const BASE = process.env.RENDER_BASE_URL ?? 'http://localhost:4399';
const SESSION_COOKIE = '__session';
const E2E_SESSION_COOKIE = 'e2e-session';
const SEED_RUN_ID = 'e2e-seed-photosynthesis';

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 1000, out: '/tmp/wsa-desktop.png' },
  { name: 'wide', width: 1920, height: 1080, out: '/tmp/wsa-wide.png' },
  { name: 'mobile', width: 390, height: 844, out: '/tmp/wsa-mobile.png' },
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
    await page.screenshot({ path: vp.out, animations: 'disabled' });
    console.log(`wrote ${vp.out} (${vp.width}x${vp.height})`);
    await context.close();
  }
} finally {
  await browser.close();
}
