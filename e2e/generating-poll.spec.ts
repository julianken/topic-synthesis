import { expect, test, type Route } from '@playwright/test';
import { signInAsTestOwner } from './auth';
import { SEED_GENERATING_RUN_ID } from './seed';
import { DISPATCH_STEP_NAME } from '../src/app/curriculum/[id]/stage-rail';

// generating-poll.spec — the RIGOROUS e2e for issue #162's perceived-latency fixes on the live-research
// generating view: (B) the generating poller fires its FIRST status poll IMMEDIATELY on mount (not after
// a full POLL_MS) and never double-polls / overlaps in-flight requests, and (A) the dispatch marker
// surfaces as a single leading "Starting…" indicator that resolves the moment a real pipeline step lands
// — never the raw `dispatch` identifier, never a second concurrent live timer.
//
// DETERMINISM (memory: rigorous + robust e2e, no flaky sleeps): the status poll is intercepted
// (page.route) and the assertions are web-first auto-retrying matchers / expect.poll over recorded
// request timings + DOM state. The overlap proof drives a CONTROLLED slow response (delay > POLL_MS) so a
// broken guard WOULD overlap — the assertion is on the measured max-in-flight, not a wall-clock sleep.
// Selectors are data-testid / role / class hooks, never brittle copy. Reduced motion is forced.

// Must match generating.tsx POLL_MS.
const POLL_MS = 2500;
const STATUS_GLOB = `**/api/curriculum/${SEED_GENERATING_RUN_ID}/status`;

/** The dispatch marker exactly as recordDispatch writes it + getStepEvents returns it: a NON-running,
 *  already-finished step_event — so it is never a LiveTimer. */
const DISPATCH_MARKER = {
  name: DISPATCH_STEP_NAME,
  stepKey: DISPATCH_STEP_NAME,
  startedAt: '2026-06-21T00:00:00.000Z',
  finishedAt: '2026-06-21T00:00:00.050Z',
  status: 'dispatched',
};

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════
// B) IMMEDIATE FIRST POLL — the first poll fires on mount (~100ms), not after POLL_MS; cadence preserved.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════
test('B1/B2 — first status poll fires immediately on mount, then on the POLL_MS cadence (no skipped first interval)', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAsTestOwner(context, baseURL ?? '');

  const reqTimes: number[] = [];
  await page.route(STATUS_GLOB, async (route: Route) => {
    reqTimes.push(Date.now());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: SEED_GENERATING_RUN_ID, ready: false, steps: [DISPATCH_MARKER], research: [] }),
    });
  });

  const navStart = Date.now();
  await page.goto(`/curriculum/${SEED_GENERATING_RUN_ID}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/generating/i);

  // B1: the FIRST poll has fired, and it fired WELL before a full POLL_MS elapsed from navigation — i.e.
  // on mount, not after the old bare-setInterval's first 2.5s tick. (Old behavior: first request ≥ POLL_MS.)
  await expect.poll(() => reqTimes.length, { message: 'first poll fired', intervals: [50, 100, 200] }).toBeGreaterThanOrEqual(1);
  expect(
    reqTimes[0]! - navStart,
    `first poll fires on mount, not after POLL_MS (was ${String(reqTimes[0]! - navStart)}ms after navigation)`,
  ).toBeLessThan(POLL_MS);

  // B2 (cadence): the SECOND poll lands ~POLL_MS after the first — the interval is preserved (not doubled,
  // not collapsed into a burst). A gap far below POLL_MS would mean a double-poll; far above means dropped.
  await expect.poll(() => reqTimes.length, { message: 'second poll fired', timeout: 8000 }).toBeGreaterThanOrEqual(2);
  const gap = reqTimes[1]! - reqTimes[0]!;
  expect(gap, `inter-poll gap ≈ POLL_MS (was ${String(gap)}ms)`).toBeGreaterThan(POLL_MS * 0.6);
  expect(gap, `inter-poll gap ≈ POLL_MS (was ${String(gap)}ms)`).toBeLessThan(POLL_MS * 2);
});

test('B2 — a slow response NEVER overlaps with the next interval tick (one request in flight at a time)', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(30_000);
  await signInAsTestOwner(context, baseURL ?? '');

  // Each response is delayed LONGER than POLL_MS, so an unguarded interval tick WOULD fire a second
  // request while the first is still pending. The in-flight guard must skip that tick instead.
  const RESPONSE_DELAY = POLL_MS + 1200;
  let inFlight = 0;
  let maxInFlight = 0;
  let requests = 0;
  await page.route(STATUS_GLOB, async (route: Route) => {
    requests += 1;
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, RESPONSE_DELAY));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: SEED_GENERATING_RUN_ID, ready: false, steps: [DISPATCH_MARKER], research: [] }),
    });
    inFlight -= 1;
  });

  await page.goto(`/curriculum/${SEED_GENERATING_RUN_ID}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/generating/i);

  // Wait until polling has continued PAST the first slow response (≥2 real requests) — proving the guard
  // doesn't deadlock — while asserting it never let two requests overlap.
  await expect.poll(() => requests, { message: 'polling continues after a slow response', timeout: 20_000, intervals: [250] }).toBeGreaterThanOrEqual(2);
  expect(maxInFlight, 'never two concurrent status requests in flight (the in-flight guard holds)').toBe(1);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════
// A) THE DISPATCH MARKER — a single "Starting…" indicator that resolves once `plan` lands; no internals.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════
test('A2/A4 — the dispatch marker renders as a single "Starting…" indicator, no internals, never a 2nd live timer', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAsTestOwner(context, baseURL ?? '');

  // A MUTABLE status payload: first the cold-start window (ONLY the dispatch marker), then `plan` running.
  let payload: { ready: boolean; steps: unknown[]; research: unknown[] } = {
    ready: false,
    steps: [DISPATCH_MARKER],
    research: [],
  };
  await page.route(STATUS_GLOB, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: SEED_GENERATING_RUN_ID, ...payload }),
    });
  });

  await page.goto(`/curriculum/${SEED_GENERATING_RUN_ID}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/generating/i);

  // (1) The cold-start window: the single leading "Starting…" indicator (top chrome live phase + caption).
  await expect(page.getByTestId('gen-live-phase'), 'live phase reads Starting…').toHaveText('Starting…');
  await expect(page.getByTestId('gen-progress-caption'), 'caption reads Starting…').toHaveText('Starting…');
  // A4 — the raw internal identifier is NEVER rendered.
  await expect(page.getByText(DISPATCH_STEP_NAME, { exact: false }), 'no raw "dispatch" identifier leaks').toHaveCount(0);
  // A4 — the marker is NOT a live ticking timer: no running progress segment exists yet.
  await expect(page.locator('.gen-pstep--running'), 'no live timer in the dispatch window').toHaveCount(0);

  // (2) The first REAL step lands (`plan` running). The "Starting…" indicator must RESOLVE — the live phase
  // becomes the running stage and there is EXACTLY ONE live timer (plan), never two.
  payload = {
    ready: false,
    steps: [
      DISPATCH_MARKER,
      {
        name: 'plan',
        stepKey: 'plan:k',
        startedAt: new Date(Date.now() - 1000).toISOString(),
        finishedAt: null,
        status: 'running',
      },
    ],
    research: [],
  };

  await expect(page.getByTestId('gen-live-phase'), 'live phase yields to the running stage').toHaveText('Planning');
  await expect(page.getByTestId('gen-progress-caption'), 'caption no longer Starting…').not.toHaveText('Starting…');
  await expect(page.locator('.gen-pstep--running'), 'exactly ONE live timer once plan runs (never two)').toHaveCount(1);
  await expect(page.getByText(DISPATCH_STEP_NAME, { exact: false }), 'still no raw "dispatch" identifier').toHaveCount(0);
});
