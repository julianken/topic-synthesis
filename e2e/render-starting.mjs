// One-off render of the NEW dispatch-window "Starting…" state (issue #162) + the resolved "Planning"
// frame, via the reader-route generating branch. NOT part of the suite (run by hand for PR screenshots):
// reuses e2e/auth.ts's seeded __session cookie + SEED_GENERATING_RUN_ID (a run_owner-stamped in-flight
// run with no persisted curriculum) against a running standalone server (AUTH_PROVIDER=fake). It pins the
// owner-scoped status poll to a FIXED payload so the captures are deterministic.
import { chromium } from '@playwright/test';

const BASE = process.env.RENDER_BASE_URL ?? 'http://localhost:4399';
const SESSION_COOKIE = '__session';
const E2E_SESSION_COOKIE = 'e2e-session';
const RUN_ID = 'e2e-seed-generating-run'; // = e2e/seed.ts SEED_GENERATING_RUN_ID

// The dispatch marker exactly as recordDispatch writes it (non-running, already-finished → never a timer).
const DISPATCH = {
  name: 'dispatch',
  stepKey: 'dispatch',
  startedAt: '2026-06-21T00:00:00.000Z',
  finishedAt: '2026-06-21T00:00:00.050Z',
  status: 'dispatched',
};
// (1) the cold-start window: ONLY the dispatch marker → the leading "Starting…" indicator.
const STARTING = { id: RUN_ID, ready: false, steps: [DISPATCH], research: [] };
// (2) the first real step lands: plan running → "Starting…" resolves to "Planning" (the single live timer).
const PLANNING = {
  id: RUN_ID,
  ready: false,
  steps: [DISPATCH, { name: 'plan', stepKey: 'plan:k', startedAt: new Date(Date.now() - 1500).toISOString(), finishedAt: null, status: 'running' }],
  research: [],
};

const SHOTS = [
  { name: 'starting', payload: STARTING, width: 1440, height: 900, out: '/tmp/ts162-starting-desktop.png' },
  { name: 'starting', payload: STARTING, width: 390, height: 844, out: '/tmp/ts162-starting-mobile.png' },
  { name: 'planning', payload: PLANNING, width: 1440, height: 900, out: '/tmp/ts162-planning-desktop.png' },
];

const browser = await chromium.launch();
try {
  const { hostname } = new URL(BASE);
  for (const shot of SHOTS) {
    const context = await browser.newContext({
      viewport: { width: shot.width, height: shot.height },
      reducedMotion: 'reduce',
    });
    await context.addCookies([
      { name: SESSION_COOKIE, value: E2E_SESSION_COOKIE, domain: hostname, path: '/', httpOnly: true, sameSite: 'Lax' },
    ]);
    const page = await context.newPage();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route(`**/api/lesson/${RUN_ID}/status`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(shot.payload) });
    });
    await page.goto(`${BASE}/lesson/${RUN_ID}`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { level: 1 }).first().waitFor();
    const expected = shot.name === 'starting' ? 'Starting…' : 'Planning';
    await page.getByTestId('gen-live-phase').filter({ hasText: expected }).waitFor({ timeout: 15000 });
    // Freeze the live cells (the plan live timer ticks off the wall clock) so the render has no flicker.
    await page.addStyleTag({ content: '.gen-pstep--running .gen-pstep__time{visibility:hidden}' });
    await page.screenshot({ path: shot.out, fullPage: true, animations: 'disabled' });
    console.log(`wrote ${shot.out} (${shot.width}x${shot.height}) — ${expected}`);
    await context.close();
  }
} finally {
  await browser.close();
}
