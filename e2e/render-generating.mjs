// One-off full-page render of the GENERATING view (Figma 1:2) at both DESIGN.md viewports, via the
// library `/` in-place generating shell — the submit handoff target. NOT part of the suite (run by hand):
// reuses e2e/auth.ts's seeded __session cookie against a running standalone server (AUTH_PROVIDER=fake),
// then MOCKS /api/generate (a fake id) + /api/curriculum/[id]/status (a FROZEN mid-run state: plan done,
// research running, the rest pending — the Figma 1:2 "Researching" beat) so the generating frame renders
// deterministically without a real LLM run. Writes /tmp PNGs.
import { chromium } from '@playwright/test';

const BASE = process.env.RENDER_BASE_URL ?? 'http://localhost:4399';
const SESSION_COOKIE = '__session';
const E2E_SESSION_COOKIE = 'e2e-session';
const FAKE_ID = '00000000-0000-4000-8000-000000000abc';

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, out: '/tmp/generating-desktop.png' },
  { name: 'mobile', width: 390, height: 844, out: '/tmp/generating-mobile.png' },
];

// A mid-run timeline (plan done, research running, brief..critic pending). Timestamps are computed
// RELATIVE to now so the captured live timer reads a sensible elapsed value (a fixed past date would show
// a huge span). plan ran 2.1s; research started ~11s ago (one researcher finished, two still running).
function midRunSteps() {
  const now = Date.now();
  const iso = (ms) => new Date(now - ms).toISOString();
  const planStart = iso(14_000);
  const planEnd = iso(11_900); // 2.1s
  const researchStart = iso(11_400);
  return [
    { name: 'plan', stepKey: 'plan:k', startedAt: planStart, finishedAt: planEnd, status: 'done' },
    { name: 'research', stepKey: 'research:a', startedAt: researchStart, finishedAt: iso(4_000), status: 'done' },
    { name: 'research', stepKey: 'research:b', startedAt: researchStart, finishedAt: null, status: 'running' },
    { name: 'research', stepKey: 'research:c', startedAt: researchStart, finishedAt: null, status: 'running' },
  ];
}

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

    // Mock the generate POST → a fake run id, and the status poll → the frozen mid-run state (never ready).
    await page.route('**/api/generate', (route) =>
      route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ id: FAKE_ID }) }),
    );
    await page.route('**/api/curriculum/*/status', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: FAKE_ID, ready: false, steps: midRunSteps() }),
      }),
    );

    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { level: 1 }).first().waitFor();

    // Open the +New card → intake form, type a topic, submit → the in-place generating shell.
    await page.getByRole('button', { name: /new lesson/i }).click();
    await page.getByRole('textbox').first().fill('Photosynthesis');
    await page.getByRole('button', { name: /generate/i }).click();

    // Wait for the generating frame, then for the FIRST poll to fold the mocked mid-run steps onto the
    // rail (a running column + a done column appear) — otherwise we'd capture the pre-poll all-pending
    // frame. The poll interval is 2.5s, so allow for it.
    await page.locator('.generating-frame').waitFor();
    await page.locator('.stagestrip__col--running').first().waitFor({ timeout: 15_000 });
    await page.locator('.stagestrip__col--done').first().waitFor({ timeout: 15_000 });

    await page.screenshot({ path: vp.out, fullPage: true, animations: 'disabled' });
    console.log(`wrote ${vp.out} (${vp.width}x${vp.height})`);
    await context.close();
  }
} finally {
  await browser.close();
}
