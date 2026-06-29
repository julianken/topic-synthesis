// Re-render the BUILT-APP full-width column-table generating view to the three review deliverable PNGs:
//   /tmp/genbuild-desktop.png  — desktop 1440 wide, N=3 (no overflow)
//   /tmp/genbuild-stress.png   — desktop 1440 wide, N=8 (fit-math overflow → "+5 below" band)
//   /tmp/genbuild-mobile.png   — mobile 390 wide, single-column collapse
//
// FULL-RESOLUTION, VIEWPORT capture (NOT fullPage — SPEC §8 capture note: Playwright's fullPage stitching
// mis-paints the position:absolute node grid inside the contain:layout plane). The viewport is sized tall
// enough to hold the whole layout. These are the BUILT Next.js standalone app (the deploy entrypoint), not
// the prototype — the review asked for full-resolution full-width shots from the real app with the edge
// geometry visible; the generating-geometry.spec proves the four §10.4 guarantees numerically, and these
// shots are the matching visual evidence.
//
// Run by hand against a RUNNING standalone server (this script starts + tears one down itself):
//   DATABASE_URL=… node e2e/render-genbuild.mjs
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = Number(process.env.RENDER_PORT ?? 4312);
const BASE = `http://localhost:${PORT}`;
const RUN_ID = 'e2e-seed-generating-run'; // = e2e/seed.ts SEED_GENERATING_RUN_ID
const E2E_OWNER_SUB = 'e2e-owner-sub';
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://topic:topic_dev@localhost:5433/topic_synthesis';

const T0 = Date.parse('2026-06-21T00:00:00.000Z');
const T = (ms) => new Date(T0 + ms).toISOString();

// N=3 (mirrors e2e/generating-fixture.ts GENERATING_STATUS_PAYLOAD).
const PAYLOAD_N3 = {
  id: RUN_ID,
  ready: false,
  steps: [
    { name: 'plan', stepKey: 'plan:k', startedAt: T(0), finishedAt: T(2100), status: 'done' },
    { name: 'research', stepKey: 'research:a', startedAt: T(2100), finishedAt: T(7400), status: 'done' },
    { name: 'research', stepKey: 'research:b', startedAt: T(2100), finishedAt: T(9200), status: 'done' },
    { name: 'research', stepKey: 'research:c', startedAt: T(2100), finishedAt: null, status: 'running' },
  ],
  research: [
    { question: 'Where does a plant’s mass come from?', subtopic: 'Carbon source', status: 'done', findings: [{ claim: 'A tree’s mass comes mostly from CO₂ in the air, not the soil.', url: 'https://www.britannica.com/science/photosynthesis', title: 'Britannica' }], sources: [{ url: 'https://www.britannica.com/science/photosynthesis', title: 'Britannica' }], findingCount: 1, startedAt: T(2100), finishedAt: T(7400) },
    { question: 'Light reactions vs. the Calvin cycle?', subtopic: 'Two stages', status: 'done', findings: [{ claim: 'Photosynthesis splits water (H₂O) to release O₂.', url: 'https://www.nature.com/articles/photosynthesis', title: 'Nature' }], sources: [{ url: 'https://www.nature.com/articles/photosynthesis', title: 'Nature' }], findingCount: 1, startedAt: T(2100), finishedAt: T(9200) },
    { question: 'Chlorophyll’s role in capturing light?', subtopic: null, status: 'pending', findings: [], sources: [], findingCount: null, startedAt: T(2100), finishedAt: null },
  ],
};

// N=8 (mirrors GENERATING_STATUS_PAYLOAD_STRESS) — 3 done findings, the rest pending → "+5 below".
const STRESS = [
  ['Where does a plant’s mass come from?', 'A tree’s mass comes mostly from CO₂ in the air, not the soil.', 'https://www.britannica.com/science/photosynthesis', 'Britannica'],
  ['Light reactions vs. the Calvin cycle?', 'Photosynthesis splits water (H₂O) to release O₂.', 'https://www.nature.com/articles/photosynthesis', 'Nature'],
  ['Chlorophyll’s role in capturing light?', 'Chlorophyll absorbs red and blue light, reflecting green.', 'https://www.khanacademy.org/science/biology', 'Khan Academy'],
  ['What limits the rate of photosynthesis?', '', '', ''],
  ['C3 vs C4 vs CAM pathways?', '', '', ''],
  ['How is glucose stored and used?', '', '', ''],
  ['Photosynthesis vs cellular respiration?', '', '', ''],
  ['The role of the thylakoid membrane?', '', '', ''],
];
const PAYLOAD_N8 = {
  id: RUN_ID,
  ready: false,
  steps: [
    { name: 'plan', stepKey: 'plan:k', startedAt: T(0), finishedAt: T(2100), status: 'done' },
    { name: 'research', stepKey: 'research:a', startedAt: T(2100), finishedAt: T(7400), status: 'done' },
    { name: 'research', stepKey: 'research:b', startedAt: T(2100), finishedAt: T(9200), status: 'done' },
    { name: 'research', stepKey: 'research:c', startedAt: T(2100), finishedAt: T(10500), status: 'done' },
    { name: 'research', stepKey: 'research:d', startedAt: T(2100), finishedAt: null, status: 'running' },
  ],
  research: STRESS.map(([q, claim, url, title], i) => {
    const done = i < 3;
    return { question: q, subtopic: null, status: done ? 'done' : 'pending', findings: done ? [{ claim, url, title }] : [], sources: done ? [{ url, title }] : [], findingCount: done ? 1 : null, startedAt: T(2100), finishedAt: done ? T(7400 + i * 700) : null };
  }),
};

const SHOTS = [
  { out: '/tmp/genbuild-desktop.png', width: 1440, height: 1180, payload: PAYLOAD_N3 },
  { out: '/tmp/genbuild-stress.png', width: 1440, height: 1480, payload: PAYLOAD_N8 },
  { out: '/tmp/genbuild-mobile.png', width: 390, height: 1700, payload: PAYLOAD_N3 },
];

async function waitForServer(url, ms = 120000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.status) return;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error(`server did not come up on ${url}`);
}

// Start the standalone server the EXACT way the harness does (the deploy entrypoint), assuming the build +
// static copy already happened (the e2e run produces .next/standalone). If not built, build first.
const server = spawn('sh', ['-c', `cp -r .next/static .next/standalone/.next/static 2>/dev/null; PORT=${PORT} node .next/standalone/server.js`], {
  env: { ...process.env, AUTH_PROVIDER: 'fake', E2E: '1', AUTH_ALLOWLIST: E2E_OWNER_SUB, DATABASE_URL },
  stdio: 'inherit',
});

let browser;
try {
  await waitForServer(BASE);
  browser = await chromium.launch();
  const { hostname } = new URL(BASE);
  for (const shot of SHOTS) {
    const context = await browser.newContext({
      viewport: { width: shot.width, height: shot.height },
      reducedMotion: 'reduce',
    });
    await context.addCookies([
      { name: '__session', value: 'e2e-session', domain: hostname, path: '/', httpOnly: true, sameSite: 'Lax' },
    ]);
    const page = await context.newPage();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route(`**/api/lesson/${RUN_ID}/status`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(shot.payload) });
    });
    await page.goto(`${BASE}/lesson/${RUN_ID}`, { waitUntil: 'networkidle' });
    await page.getByText('Where does a plant’s mass come from?').waitFor({ timeout: 15000 });
    // Let the layout effect measure + the settled edges draw.
    await page.waitForFunction(() => document.querySelectorAll('.gen-plane__edges path').length > 0, null, { timeout: 5000 }).catch(() => {});
    // Hide the live ticking cells so the still is flicker-free (no mask needed).
    await page.addStyleTag({ content: '.gen-pstep--running .gen-pstep__time,.gen-progress__caption{visibility:hidden}' });
    await page.screenshot({ path: shot.out, animations: 'disabled' });
    console.log(`wrote ${shot.out} (${shot.width}x${shot.height})`);
    await context.close();
  }
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
