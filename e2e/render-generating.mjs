// One-off full-page render of the live-research GENERATING view (the B view — Figma 1:2) at both
// DESIGN.md viewports, via the test-auth seam + a status-poll interception. NOT part of the suite (run by
// hand): reuses e2e/auth.ts's seeded __session cookie + e2e/seed.ts's SEED_GENERATING_RUN_ID (a
// `run_owner`-stamped in-flight run with no persisted curriculum) against a running standalone server
// (AUTH_PROVIDER=fake), and intercepts the owner-scoped status poll with a FIXED mid-run research+steps
// payload so the captured node-graph + LIVE RESEARCH panel are deterministic. Writes clean /tmp PNGs
// (the live rail timer is hidden via injected CSS so there's no flicker — and no visual-spec mask).
import { chromium } from '@playwright/test';

const BASE = process.env.RENDER_BASE_URL ?? 'http://localhost:4399';
const SESSION_COOKIE = '__session';
const E2E_SESSION_COOKIE = 'e2e-session';
const RUN_ID = 'e2e-seed-generating-run'; // = e2e/seed.ts SEED_GENERATING_RUN_ID

const T0 = Date.parse('2026-06-21T00:00:00.000Z');
const T = (ms) => new Date(T0 + ms).toISOString();

// Mirrors e2e/generating-fixture.ts GENERATING_STATUS_PAYLOAD (kept inline so this script stays
// dependency-free, the render-library.mjs pattern).
const PAYLOAD = {
  id: RUN_ID,
  ready: false,
  steps: [
    { name: 'plan', stepKey: 'plan:k', startedAt: T(0), finishedAt: T(2100), status: 'done' },
    { name: 'research', stepKey: 'research:a', startedAt: T(2100), finishedAt: T(7400), status: 'done' },
    { name: 'research', stepKey: 'research:b', startedAt: T(2100), finishedAt: T(9200), status: 'done' },
    { name: 'research', stepKey: 'research:c', startedAt: T(2100), finishedAt: null, status: 'running' },
  ],
  research: [
    {
      question: 'Where does a plant’s mass come from?',
      subtopic: 'Carbon source',
      status: 'done',
      findings: [
        { claim: 'A tree’s mass comes mostly from CO₂ in the air, not the soil.', url: 'https://www.britannica.com/science/photosynthesis', title: 'Britannica' },
      ],
      sources: [{ url: 'https://www.britannica.com/science/photosynthesis', title: 'Britannica' }],
      findingCount: 1,
      startedAt: T(2100),
      finishedAt: T(7400),
    },
    {
      question: 'Light reactions vs. the Calvin cycle?',
      subtopic: 'Two stages',
      status: 'done',
      findings: [
        { claim: 'Photosynthesis splits water (H₂O) to release O₂.', url: 'https://www.nature.com/articles/photosynthesis', title: 'Nature' },
      ],
      sources: [{ url: 'https://www.nature.com/articles/photosynthesis', title: 'Nature' }],
      findingCount: 1,
      startedAt: T(2100),
      finishedAt: T(9200),
    },
    {
      question: 'Chlorophyll’s role in capturing light?',
      subtopic: null,
      status: 'pending',
      findings: [
        { claim: 'Chlorophyll absorbs red & blue light, reflects green.', url: 'https://www.khanacademy.org/science/biology/photosynthesis', title: 'Khan Academy' },
      ],
      sources: [{ url: 'https://www.khanacademy.org/science/biology/photosynthesis', title: 'Khan Academy' }],
      findingCount: null,
      startedAt: T(2100),
      finishedAt: null,
    },
  ],
};

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, out: '/tmp/generating-desktop.png' },
  { name: 'mobile', width: 390, height: 844, out: '/tmp/generating-mobile.png' },
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
    await page.route(`**/api/curriculum/${RUN_ID}/status`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PAYLOAD) });
    });
    await page.goto(`${BASE}/curriculum/${RUN_ID}`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { level: 1 }).first().waitFor();
    // Wait for the FIRST status poll to land the mid-run payload (POLL_MS=2500 in the poller), not the
    // initial empty paint — the populated count + a real research question prove the graph + ledger filled.
    await page.getByText('2 / 3 extracted').waitFor({ timeout: 15000 });
    await page.getByText('Where does a plant’s mass come from?').waitFor();
    // Hide the one live cell (the in-progress rail timer ticks off the wall clock) so the clean render
    // has no flicker and no mask — the rest is fixed fixture data. Injected AFTER load so it applies.
    await page.addStyleTag({ content: '.rail__stage--running .rail__time{visibility:hidden}' });
    await page.screenshot({ path: vp.out, fullPage: true, animations: 'disabled' });
    console.log(`wrote ${vp.out} (${vp.width}x${vp.height})`);
    await context.close();
  }
} finally {
  await browser.close();
}
