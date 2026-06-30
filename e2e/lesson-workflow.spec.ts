import { expect, test } from '@playwright/test';
import { signInAsTestOwner } from './auth';
import { SEED_FOREIGN_RUN_ID, SEED_RUN_ID, clearForeignLesson, seedForeignLesson } from './seed';

// lesson-workflow.spec — the PRESERVED completed-workflow page (run-lifecycle 3/4, issue #232): the
// frozen /lesson/[id]/workflow route that re-renders the generating composition AT REST post-persist
// (GeneratingView in mode="frozen"). RIGOROUS + DETERMINISTIC behavioural assertions (DOM + measured
// geometry, not pixels) at BOTH DESIGN.md viewports (the desktop + mobile projects run every test, except
// the desktop-only geometry block). The global setup (e2e/seed.ts) seeds SEED_RUN_ID — a BUILT lesson
// with a DURABLE six-stage step_event timeline (kept past persist, #175) AND a durable research_event
// feed (kept past persist, #232) — owned by the e2e owner. Pixel grading lives in visual.spec.ts.

// The tokens/cost/model/raw-error text that must NEVER reach this surface (issue #232 AC6 leak gate). NB
// the generating view INTENTIONALLY shows the pipeline stage vocabulary (plan→critic, the progress bar's
// per-stage timing) — that is the owner-facing build view's design, NOT a leak; this gate is specifically
// about token/cost/model magnitudes + raw errors, never a reading-surface concern.
function assertNoSensitive(text: string): void {
  expect(text).not.toMatch(/\btokens?\b/i);
  expect(text).not.toMatch(/\bcost\b/i);
  expect(text).not.toMatch(/\bmodel\b/i);
  expect(text).not.toMatch(/\bttft\b/i);
  expect(text).not.toMatch(/\$/);
  expect(text).not.toMatch(/\bhaiku\b|\bsonnet\b|\bopus\b|\bgpt\b|\bgemini\b|\bclaude\b/i);
  expect(text).not.toMatch(/\d\s*ms\b/i); // milliseconds — durations are whole/decimal seconds only
  expect(text).not.toMatch(/\bError:|\bstack\b|\bexception\b/i); // no raw error / stack text
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test.describe('lesson-workflow — the frozen completed-workflow page (issue #232)', () => {
  test('renders the FROZEN composition at rest for the owner: header, disposition chip, RESEARCH band, progress', async ({
    page,
    context,
    baseURL,
  }) => {
    await signInAsTestOwner(context, baseURL ?? '');
    await page.goto(`/lesson/${SEED_RUN_ID}/workflow`);

    // Past-tense header (NOT the live "Generating …"): "Generated Photosynthesis".
    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toContainText('Generated');
    await expect(h1).toContainText('Photosynthesis');
    await expect(h1).not.toContainText('Generating');

    // The TERMINAL DISPOSITION chip replaces the live phase shimmer (the live-only element is absent).
    await expect(page.getByTestId('gen-live-phase')).toHaveCount(0);
    const chip = page.getByTestId('gen-disposition');
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute('data-disposition', 'built');
    await expect(chip).toContainText('Built');
    await expect(chip).toHaveAttribute('aria-label', /Run outcome: Built/);

    // The band is RESEARCH (not LIVE RESEARCH) with the pulse REMOVED, and replays the retained findings.
    const band = page.getByTestId('gen-research-band');
    await expect(band.locator('.gen-research__title')).toHaveText('RESEARCH');
    await expect(band.locator('.gen-research__title')).not.toHaveText(/LIVE/);
    await expect(band.locator('.gen-research__pulse')).toHaveCount(0);
    await expect(band).toContainText('3 / 3 extracted');
    await expect(band).toContainText('A tree’s mass comes mostly from CO₂ in the air, not the soil.');
    await expect(band).toContainText('Chlorophyll absorbs red & blue light, reflects green.');

    // Every stepper column is DONE (ran) — the completed pipeline. Research carries its 3/3 count.
    for (const phase of ['plan', 'research', 'brief', 'spec', 'code', 'critic']) {
      await expect(page.getByTestId(`gen-step-${phase}`)).toHaveAttribute('data-state', 'ran');
    }

    // The completed-run progress caption (not the live "Working…"/elapsed-timer line).
    const caption = page.getByTestId('gen-progress-caption');
    await expect(caption).toContainText('complete');
    await expect(caption).toContainText('plan → critic ran in');
  });

  test('LEAK GATE: the frozen page DOM carries no token/cost/model/ms/$/raw-error text (AC6)', async ({
    page,
    context,
    baseURL,
  }) => {
    await signInAsTestOwner(context, baseURL ?? '');
    await page.goto(`/lesson/${SEED_RUN_ID}/workflow`);
    const gen = page.locator('.gen');
    await expect(gen).toBeVisible();
    // Wait for the band's real findings (post-hydration) so the assertion runs over the full surface.
    await expect(page.getByTestId('gen-research-band')).toContainText('3 / 3 extracted');
    assertNoSensitive((await gen.innerText()).toString());
  });
});

test.describe('lesson-workflow — owner gate (gates on getLesson, NOT ownsRun)', () => {
  // A REAL lesson owned by a DIFFERENT sub: the e2e owner's request 404s like an absent id (no oracle).
  test.beforeAll(seedForeignLesson);
  test.afterAll(clearForeignLesson);

  test('a NON-OWNER (the e2e owner requesting a foreign-owned lesson) 404s — no existence oracle (AC4)', async ({
    page,
    context,
    baseURL,
  }) => {
    await signInAsTestOwner(context, baseURL ?? '');
    // The foreign lesson REALLY EXISTS (seeded, durable timelines) but is owned by another sub →
    // getLesson(id, e2eOwnerSub) is null → notFound. Indistinguishable from the absent id below.
    const res = await page.goto(`/lesson/${SEED_FOREIGN_RUN_ID}/workflow`);
    expect(res?.status()).toBe(404);
    await expect(page.locator('.gen')).toHaveCount(0);
  });

  test('an ABSENT/unknown id 404s for the owner (AC5)', async ({ page, context, baseURL }) => {
    await signInAsTestOwner(context, baseURL ?? '');
    const res = await page.goto('/lesson/not-an-owned-workflow-id/workflow');
    expect(res?.status()).toBe(404);
    await expect(page.locator('.gen')).toHaveCount(0);
  });

  test('an UNAUTHENTICATED visitor is redirected to sign-in — never the frozen view', async ({ page }) => {
    // No session cookie → getSessionIdentity null → redirect to /sign-in before any render.
    await page.goto(`/lesson/${SEED_RUN_ID}/workflow`);
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.locator('.gen')).toHaveCount(0);
  });
});

test.describe('lesson-workflow — frozen-edge geometry (desktop, AC8)', () => {
  // Desktop only — the ≤60rem collapse intentionally drops the SVG edges + the fixed-height plane (the
  // SAME design as the live generating geometry spec), so the edge-anchor model doesn't apply on mobile.
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'edge geometry is a desktop-only model');

  test('the SVG edges draw once and anchor on the RESTING node rects (no entrance-displacement)', async ({
    page,
    context,
    baseURL,
  }) => {
    await signInAsTestOwner(context, baseURL ?? '');
    await page.goto(`/lesson/${SEED_RUN_ID}/workflow`);
    await expect(page.getByTestId('gen-research-band')).toContainText('3 / 3 extracted');

    // Wait for the layout effect to measure + the edges to draw (frozen suppresses the entrance, so the
    // nodes are already at rest — the edges anchor on resting centers immediately, no settle to wait out).
    await expect.poll(async () => probeEdges(page).then((e) => e.length)).toBeGreaterThan(0);

    const edges = await probeEdges(page);
    // The completed plan→rᵢ→brief→…→critic graph draws a healthy set of edges (3 research × 2 + 3 spine).
    expect(edges.length, 'frozen graph draws its edges').toBeGreaterThanOrEqual(6);
    let maxDelta = 0;
    for (const e of edges) {
      expect(e.id, 'edge carries a data-edge from->to id').toContain('->');
      expect(e.srcCy, `edge ${e.id} resolves its source node`).not.toBeNull();
      expect(e.dstCy, `edge ${e.id} resolves its target node`).not.toBeNull();
      if (e.srcCy !== null) maxDelta = Math.max(maxDelta, Math.abs(e.sy - e.srcCy));
      if (e.dstCy !== null) maxDelta = Math.max(maxDelta, Math.abs(e.ey - e.dstCy));
    }
    // No entrance-displacement: every endpoint sits on its node's vertical center (< 1px, same bar as the
    // live geometry spec). A draw taken during a rail-reveal entrance would anchor ~4px off — this fails it.
    expect(maxDelta, `frozen edge-anchor Δ (max ${maxDelta.toFixed(3)}px)`).toBeLessThan(1.0);
  });
});

/** Probe the frozen plane's SVG edges + the measured centers of the nodes each edge connects (plane-local
 *  px) — the SAME `M sx sy C …, …, ex ey` parse + node-rect measurement the live geometry spec uses. */
async function probeEdges(
  page: import('@playwright/test').Page,
): Promise<{ id: string; sy: number; ey: number; srcCy: number | null; dstCy: number | null }[]> {
  return page.evaluate(() => {
    const plane = document.querySelector('.gen-plane');
    if (!plane) return [];
    const planeRect = plane.getBoundingClientRect();
    const nodeCy = (id: string): number | null => {
      const el = plane.querySelector(`[data-node="${id}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.top - planeRect.top + r.height / 2;
    };
    return Array.from(plane.querySelectorAll('.gen-plane__edges path')).map((p) => {
      const d = p.getAttribute('d') ?? '';
      const m = /M\s*([-\d.]+)\s+([-\d.]+)\s+C[^,]*,[^,]*,\s*([-\d.]+)\s+([-\d.]+)/.exec(d);
      const sy = m ? parseFloat(m[2]!) : NaN;
      const ey = m ? parseFloat(m[4]!) : NaN;
      const id = p.getAttribute('data-edge') ?? '';
      const [from, to] = id.split('->');
      return { id, sy, ey, srcCy: nodeCy(from ?? ''), dstCy: nodeCy(to ?? '') };
    });
  });
}
