// One-off full-page render of the AUTHED library at both DESIGN.md viewports, via the test-auth seam.
// NOT part of the suite (run by hand): reuses e2e/auth.ts's seeded __session cookie against a running
// standalone server (AUTH_PROVIDER=fake) and the global-setup-seeded dense card. Writes /tmp PNGs.
import { chromium } from '@playwright/test';

const BASE = process.env.RENDER_BASE_URL ?? 'http://localhost:4399';
const SESSION_COOKIE = '__session';
const E2E_SESSION_COOKIE = 'e2e-session';

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, out: '/tmp/library-desktop.png' },
  { name: 'mobile', width: 390, height: 844, out: '/tmp/library-mobile.png' },
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
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { level: 1 }).first().waitFor();
    await page.screenshot({ path: vp.out, fullPage: true, animations: 'disabled' });
    console.log(`wrote ${vp.out} (${vp.width}x${vp.height})`);
    await context.close();
  }
} finally {
  await browser.close();
}
