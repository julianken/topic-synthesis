// One-off render of the BUILT lesson-workspace APPARATUS PANEL (PR-B) for the PR screenshots. NOT part
// of the suite (run by hand): reuses e2e/auth.ts's seeded __session cookie against a running standalone
// server (AUTH_PROVIDER=fake) + the global-setup-seeded built lesson (which carries the coordinate-only
// stub sender). Drives the SHIPPED { sections, scrollProgress } channel by posting `lesson:set-progress`
// INTO the iframe (the stub re-emits the shipped progress outward), then captures three states:
//   • desktop 1440 POPULATED — the where-am-i widget lit + the section list + the scrubber, mid-lesson;
//   • desktop 1440 EMPTY — the artifact blocked so it posts NOTHING (decision-13 best-effort empty state);
//   • mobile 390 — the panel collapsed BELOW the read column (single column).
import { chromium } from '@playwright/test';

const BASE = process.env.RENDER_BASE_URL ?? 'http://localhost:4311';
const SESSION_COOKIE = '__session';
const E2E_SESSION_COOKIE = 'e2e-session';
const SEED_RUN_ID = 'e2e-seed-photosynthesis';

async function driveProgress(page, p) {
  // Retry the post until the chrome's where-am-i percent reflects it (absorbs the sender's load race).
  for (let i = 0; i < 40; i++) {
    await page.evaluate((prog) => {
      const f = document.querySelector('iframe.artifact-frame');
      f?.contentWindow?.postMessage({ type: 'lesson:set-progress', scrollProgress: prog }, '*');
    }, p);
    if ((await page.locator('.ws-where__percent').count()) > 0) return;
    await page.waitForTimeout(100);
  }
}

const browser = await chromium.launch();
try {
  const { hostname } = new URL(BASE);

  async function shot({ width, height, out, empty, progress }) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
    await context.addCookies([
      { name: SESSION_COOKIE, value: E2E_SESSION_COOKIE, domain: hostname, path: '/', httpOnly: true, sameSite: 'Lax' },
    ]);
    const page = await context.newPage();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    if (empty) await page.route('**/artifact/**', (r) => r.fulfill({ status: 204, body: '' }));
    await page.goto(`${BASE}/curriculum/${SEED_RUN_ID}`, { waitUntil: 'networkidle' });
    await page.locator('.ws-panel .ws-app').waitFor();
    if (!empty) await driveProgress(page, progress);
    await page.screenshot({ path: out, animations: 'disabled' });
    console.log(`wrote ${out} (${width}x${height}${empty ? ', empty' : ''})`);
    await context.close();
  }

  await shot({ width: 1440, height: 1000, out: '/tmp/wsb-desktop.png', progress: 0.6 });
  await shot({ width: 1440, height: 1000, out: '/tmp/wsb-empty.png', empty: true });
  await shot({ width: 390, height: 844, out: '/tmp/wsb-mobile.png', progress: 0.5 });
} finally {
  await browser.close();
}
