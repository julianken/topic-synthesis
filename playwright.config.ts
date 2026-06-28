import { defineConfig, devices } from '@playwright/test';

// playwright.config — the frontend E2E + VISUAL harness for the LIVE-browser contracts that the
// jsdom Vitest gate can't verify (the unauth→/sign-in redirect, the test-auth library render, the
// generate→generating→built flow, and the per-screen visual snapshots). DESIGN.md wins on any
// design conflict (AGENTS.md). It runs against the BUILT, production bundle, not the dev server.
//
// VIEWPORTS — the two DESIGN.md / PR-template viewports (DESIGN.md "## Lesson layout"; the
// design-reviewer agent's Playwright pass): mobile 390×844 and desktop 1440×900. Each is its own
// project so a spec runs at both, and a visual snapshot is captured per viewport.
//
// REDUCED MOTION — forced project-wide (`reducedMotion: 'reduce'`) so captures are deterministic:
// no in-flight stagger/keyframe/View-Transition. DESIGN.md "## Motion" requires reduced-motion be
// honored, so this is also the canonical motion-off contract.
//
// FONTS — DESERMINISTIC by construction: the app loads Inter + JetBrains Mono via `next/font/google`
// (src/app/layout.tsx), which SELF-HOSTS the font files into the build and emits a size-adjusted
// system fallback. Because the production bundle serves the fonts from its own origin (no runtime
// Google fetch) and `display: 'swap'` avoids a reflow, text metrics are stable across the machine
// that captures a baseline and the CI runner of the same OS. No extra preload wiring is needed.
//
// DEPLOY FIDELITY — the webServer serves the EXACT process Cloud Run runs: `node
// .next/standalone/server.js` (Dockerfile.app's `CMD`), the standalone-output entrypoint, NOT
// `next start` (officially-unsupported over `output: standalone` — Next logs `⚠ "next start" does not
// work with "output: standalone"` and the standalone build omits the assets `next start` expects, so
// it is a DIFFERENT, broken server than the deploy). So the e2e exercises the real shipped server, not
// a different entrypoint. See the `webServer` block below.
//
// TEST-AUTH SEAM — the webServer sets `AUTH_PROVIDER=fake` (the in-memory FakeAuthProvider seam,
// src/app/auth/provider.ts) + `E2E=1` (the network-free pipeline stub, src/pipeline/e2e-stub-deps.ts)
// + the e2e owner sub on `AUTH_ALLOWLIST`. Both seams are opt-in via those flags AND hard-DENIED on a
// deployed Cloud Run runtime (detected by `K_SERVICE`, the Knative var a deploy always carries — the
// provider selector THROWS if the fake is requested there). The e2e runs the REAL `next build`
// production bundle (NODE_ENV=production) but with NO `K_SERVICE`, so the seam is reachable; a real
// Cloud Run deploy never sets the flags and always has `K_SERVICE`, so it runs the real GCP adapter
// and would crash on a misconfigured `AUTH_PROVIDER=fake`. See provider.ts.
//
// VISUAL BASELINES — platform-suffixed committed PNGs (-darwin locally, -linux in CI) under
// e2e/visual.spec.ts-snapshots/; the toHaveScreenshot tolerance is set in `expect` below. The
// committed baselines capture the CURRENT chrome as PLACEHOLDERS — they are expected to be
// re-captured per screen during the Figma-driven frontend rebuild (see visual.spec.ts).
//
// SOFT-LAUNCH — this suite ships SOFT (a separate, non-required CI workflow — .github/workflows/
// frontend-e2e.yml, continue-on-error), per the GAPS.md "soft-launch → dated-flip → promote-to-
// blocker" ritual, so first-run baseline flake never blocks a merge while the suite proves itself.

const PORT = 4311;
const BASE_URL = `http://localhost:${String(PORT)}`;

// The e2e owner sub the FakeAuthProvider verifies the seeded cookie to (provider.ts E2E_OWNER_SUB).
// The webServer must allowlist it so getSessionIdentity resolves the test owner end to end.
const E2E_OWNER_SUB = 'e2e-owner-sub';

const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

export default defineConfig({
  testDir: './e2e',
  // Seed the deterministic DENSE library card for the e2e owner ONCE before the suite, so the library
  // visual baseline (the seeded card grid) is byte-stable run to run. Requires a migrated Postgres
  // (DATABASE_URL) — the same precondition the webServer already needs. See e2e/seed.ts.
  globalSetup: './e2e/global-setup.ts',
  // The build-and-start cold path is the slow part; per-test work is fast.
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    // A small tolerance absorbs sub-pixel antialiasing / font-hinting differences between the machine
    // that generated the committed baseline and a CI runner of the SAME OS (baselines are platform-
    // suffixed). It is a tolerance, not a license — a real layout regression moves far more than 0.2%
    // of pixels and still fails the gate.
    toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: 'disabled' },
  },
  fullyParallel: true,
  // No accidental `.only` left in a committed spec (CI only).
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // CI pins a single worker so the build-and-start webServer + the shared Postgres aren't contended;
  // omitted locally (undefined) so Playwright auto-sizes. `exactOptionalPropertyTypes` forbids an
  // explicit `undefined`, so spread it in only on CI.
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: {
    baseURL: BASE_URL,
    // Force prefers-reduced-motion at the browser-CONTEXT level so every page is created with motion
    // off (DESIGN.md "## Motion") — deterministic captures, no in-flight stagger/keyframe/View-
    // Transition. The specs ALSO call page.emulateMedia({ reducedMotion: 'reduce' }) belt-and-suspenders
    // before navigation, matching the violin-tools visual pattern.
    contextOptions: { reducedMotion: 'reduce' },
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: DESKTOP },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], viewport: MOBILE },
    },
  ],
  webServer: {
    // Build the PRODUCTION bundle, then serve it the EXACT way Cloud Run does: `node
    // .next/standalone/server.js` (Dockerfile.app's `CMD ["node", "server.js"]`), NOT `next start`.
    // next.config.ts sets `output: 'standalone'`, and `next start` is officially-unsupported over
    // standalone output (Next logs `⚠ "next start" does not work with "output: standalone"` and the
    // standalone build omits the assets `next start` expects), so the harness MUST drive the standalone
    // server to test the real deploy entrypoint. The standalone tree omits static assets by design (the Dockerfile copies
    // `.next/static` in separately), so we copy them in before starting — same as the image build.
    // There is no `public/` dir in this repo (Dockerfile.app copies none either), so it isn't copied.
    // NODE_ENV=production comes from the build; the test seams gate on the opt-in flags + the ABSENCE of
    // `K_SERVICE`, not on NODE_ENV, so they are reachable here yet impossible on a Cloud Run deploy.
    // DATABASE_URL must point at a reachable Postgres (docker compose locally; the `postgres` service in
    // CI) with the schema migrated.
    command:
      'npm run build && cp -r .next/static .next/standalone/.next/static && ' +
      `PORT=${String(PORT)} node .next/standalone/server.js`,
    url: BASE_URL,
    // Reuse a server already listening on the port LOCALLY (fast iteration); never in CI (a fresh cold
    // build+serve every run). CAVEAT when validating the harness itself: reuse can mask a broken cold
    // start by serving a leftover process from a previous run — so a true local green requires the
    // standalone `command` above to actually serve. When re-capturing baselines or proving the cold
    // path, kill any process on PORT first so the build+standalone-serve path is exercised, not reuse.
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      AUTH_PROVIDER: 'fake',
      E2E: '1',
      AUTH_ALLOWLIST: E2E_OWNER_SUB,
      // No PIPELINE_JOB_NAME → the generate route runs the pipeline IN-PROCESS (with the stub deps),
      // never dispatching a real Cloud Run Job. No K_SERVICE → not a Cloud Run runtime, so the seams
      // are reachable (provider.ts / route.ts deny the fake whenever K_SERVICE is present).
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://topic:topic_dev@localhost:5433/topic_synthesis',
    },
  },
});
