// One-off render of the BUILT lesson-workspace INTEGRATED TOPBAR (PR-D) — desktop 1440 (normal),
// desktop 1440 (Focus-reading ON), and mobile 390 — via the test-auth seam. NOT part of the suite (run
// by hand): reuses e2e/auth.ts's seeded __session cookie against a running standalone server
// (AUTH_PROVIDER=fake) + the global-setup-seeded built lesson, drives a deterministic scrollProgress so
// the y=0 hairline shows a partial fill, and (for the focus shot) toggles Focus-reading via Shift+F.
import { chromium } from '@playwright/test';

const BASE = process.env.RENDER_BASE_URL ?? 'http://localhost:4311';
const SESSION_COOKIE = '__session';
const E2E_SESSION_COOKIE = 'e2e-session';
const SEED_RUN_ID = 'e2e-seed-photosynthesis';

const SHOTS = [
  { name: 'desktop', width: 1440, height: 1000, focus: false, out: '/tmp/wsd-desktop.png' },
  { name: 'focus', width: 1440, height: 1000, focus: true, out: '/tmp/wsd-focus.png' },
  { name: 'mobile', width: 390, height: 844, focus: false, out: '/tmp/wsd-mobile.png' },
];

const browser = await chromium.launch();
try {
  const { hostname } = new URL(BASE);
  for (const vp of SHOTS) {
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
    await page.locator('.ws-topbar').waitFor();
    // Drive a deterministic reading position (~45%) so the y=0 hairline shows a partial fill.
    // Retried until the topbar progressbar's aria-valuenow reflects the drive (the seed sender registers
    // its listener on load — a race the loop absorbs).
    for (let i = 0; i < 40; i += 1) {
      await page.evaluate(() => {
        const f = document.querySelector('iframe.artifact-frame');
        f?.contentWindow?.postMessage({ type: 'lesson:set-progress', scrollProgress: 0.45 }, '*');
      });
      const v = await page.locator('.ws-topbar [role="progressbar"]').getAttribute('aria-valuenow');
      if (v === '45') break;
      await page.waitForTimeout(100);
    }
    if (vp.focus) {
      // Toggle Focus-reading ON via the labeled button (deterministic) and wait for the CSS state.
      await page.locator('.ws-topbar__focus').click();
      await page.locator('.reader--ws[data-focus]').waitFor();
    }
    await page.screenshot({ path: vp.out, animations: 'disabled' });
    console.log(`wrote ${vp.out} (${vp.width}x${vp.height}${vp.focus ? ', focus' : ''})`);
    await context.close();
  }
} finally {
  await browser.close();
}
