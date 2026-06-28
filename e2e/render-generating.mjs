// One-off full-page render of the live-research GENERATING view (the B view — Figma 1:2) at both
// DESIGN.md viewports, via the test-auth seam. NOT part of the suite (run by hand): reuses e2e/auth.ts's
// seeded __session cookie + e2e/seed.ts's SEED_GENERATING_RUN_ID (a `run_owner`-stamped in-flight run
// with no persisted curriculum) against a running standalone server (AUTH_PROVIDER=fake).
//
// TOPIC-BEARING (Figma 1:2's headline — the topic as the large H1 in --interactive): the captures drive
// the CREATE-FORM path (the path that carries the typed topic), NOT the reader-route refresh path (which
// has no topic pre-persist and degrades to a bare "Generating…"). We intercept /api/generate to return
// the seeded in-flight run id (so no real run executes — the stub pipeline would otherwise persist and
// navigate away) and intercept that run's owner-scoped status poll with a FIXED mid-run research+steps
// payload, so the create-form's in-place generating shell renders the shared GeneratingView with `topic`
// set — "Generating Photosynthesis…" — over a deterministic node-graph + LIVE RESEARCH panel. Writes
// clean /tmp PNGs (the live rail timer is hidden via injected CSS so there's no flicker — and no mask).
import { chromium } from '@playwright/test';

const BASE = process.env.RENDER_BASE_URL ?? 'http://localhost:4399';
const SESSION_COOKIE = '__session';
const E2E_SESSION_COOKIE = 'e2e-session';
const RUN_ID = 'e2e-seed-generating-run'; // = e2e/seed.ts SEED_GENERATING_RUN_ID
const TOPIC = 'Photosynthesis'; // the typed topic the create-form path lifts into the header (Figma 1:2)

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
    // Pin the generate POST to the seeded in-flight run id (so no real run executes), and pin that run's
    // status poll to the fixed mid-run payload — the create-form's generating shell stays in the
    // generating state with the topic showing.
    await page.route('**/api/generate', async (route) => {
      await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ id: RUN_ID }) });
    });
    await page.route(`**/api/curriculum/${RUN_ID}/status`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PAYLOAD) });
    });
    // Drive the CREATE-FORM path so the typed topic lands in the header: open +New → type the topic →
    // submit. On the 202 the form recedes and the shared GeneratingView renders in place with `topic` set.
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { level: 1 }).first().waitFor();
    await page.getByRole('button', { name: /new lesson/i }).click();
    await page.getByRole('textbox').first().fill(TOPIC);
    await page.getByRole('button', { name: /generate/i }).click();
    // Wait for the topic header + the FIRST status poll to land the mid-run payload (POLL_MS=2500), not
    // the initial empty paint — the topic span + the populated count prove the create-form render filled.
    await page.locator('.genb__topic').filter({ hasText: TOPIC }).waitFor({ timeout: 15000 });
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
