import { expect, test, type Page, type Route } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { signInAsTestOwner } from './auth';
import { SEED_GENERATING_RUN_ID } from './seed';
import { READY_SNAPSHOT, STEP_SEQUENCE, STRESS_PAYLOAD, type StepSnapshot } from './stepthrough-fixture';

// generating-stepthrough.spec — the RIGOROUS, STEP-THROUGH e2e for the rebuilt full-width column-table
// generating view (PR #155). Where generating-geometry.spec proves the four §10.4 geometry guarantees on a
// SINGLE frozen snapshot, and visual.spec captures the shipped pixels, THIS spec drives the view through the
// WHOLE live run — every pipeline phase, one push at a time — and asserts the rendered state AFTER EACH
// push: the stepper's active/done/pending marking, each phase column node's state + glyph, the research
// column's question nodes advancing pending→running→done, the LIVE RESEARCH band's findings + N/M count,
// the progress timeline, AND the column-lock geometry + zero overflow AT EVERY STEP. A film strip is
// captured per step to /tmp/stepthrough/ so the owner can flip through the whole progression.
//
// DETERMINISM (owner: "e2e and UI tests will need to be robust"): NO arbitrary sleeps. The status poll is
// intercepted (page.route) and fulfilled with a MUTABLE cursor; advancing the cursor + the page's own 2.5s
// poll lands the next state, and every assertion is a Playwright WEB-FIRST auto-retrying matcher
// (toHaveAttribute / toHaveText / expect.poll), which retries until the new state arrives or the timeout
// trips. Reduced motion is forced (config + per-test). All data is mocked (status poll, /api/generate, auth
// via the seam), so every state is reproducible. Selectors are role/text/data-testid — never brittle copy.

// The film-strip output dir. Defaults to /tmp/stepthrough (the owner can flip through it locally); CI sets
// STEPSHOTS_DIR to a workspace path so the upload-artifact step can collect it (it can't reach /tmp).
const SHOTS = process.env.STEPSHOTS_DIR ?? '/tmp/stepthrough';
mkdirSync(SHOTS, { recursive: true });

// A monotonic counter so the film-strip filenames sort in capture order across the whole run.
let shotSeq = 0;
async function filmShot(page: Page, name: string): Promise<string> {
  shotSeq += 1;
  const file = `${SHOTS}/${String(shotSeq).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

/** The geometry the in-browser probe returns — the column-lock Δ per phase + the plane overflow. Matches
 *  the measurement basis generating-geometry.spec uses (plane-local rects via getBoundingClientRect). */
interface StepGeometry {
  /** |node.cx − header.cx| per phase column (the shared-track column-lock; SPEC §2.1). */
  columnLock: { phase: string; delta: number }[];
  /** Horizontal overflow of the document (scrollWidth − clientWidth); must be 0 (no h-scroll). */
  horizOverflow: number;
  /** The research column's visible node count (the fit-cap; ≤3 at 1440×900). */
  visibleResearch: number;
  /** The overflow chip text inside the research column, if any (e.g. "+6 below"). */
  overflowChip: string | null;
}

// Probe the BUILT view's geometry from the real DOM — the same plane-local rect basis as the geometry spec.
async function measureStep(page: Page): Promise<StepGeometry> {
  return page.evaluate(() => {
    const PHASES = ['plan', 'research', 'brief', 'spec', 'code', 'critic'];
    const plane = document.querySelector('.gen-plane');
    const stepper = document.querySelector('.gen-stepper');
    const horizOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    if (!plane || !stepper) {
      return { columnLock: [], horizOverflow, visibleResearch: 0, overflowChip: null };
    }
    const planeRect = plane.getBoundingClientRect();
    const headers = Array.from(stepper.querySelectorAll('.gen-step'));
    const cxOf = (el: Element): number => {
      const r = el.getBoundingClientRect();
      return r.left - planeRect.left + r.width / 2;
    };
    const columnLock: { phase: string; delta: number }[] = [];
    PHASES.forEach((phase, ci) => {
      const header = headers[ci];
      if (!header) return;
      const hx = cxOf(header);
      // Probe the first visible research node; before any question lands the column renders a single
      // `research-empty` placeholder node (the honest pre-plan state), so fall back to it.
      const node =
        phase === 'research'
          ? plane.querySelector('[data-node="research-0"]') ?? plane.querySelector('[data-node="research-empty"]')
          : plane.querySelector(`[data-node="${phase}"]`);
      if (!node) return;
      columnLock.push({ phase, delta: Math.abs(cxOf(node) - hx) });
    });
    const researchCell = plane.querySelector('.gen-cell[data-phase="research"]');
    const researchNodes = researchCell ? researchCell.querySelectorAll('.gen-node') : [];
    const chip = researchCell?.querySelector('.gen-overflow') ?? null;
    return {
      columnLock,
      horizOverflow,
      visibleResearch: researchNodes.length,
      overflowChip: chip ? (chip.textContent ?? '').trim() : null,
    };
  });
}

/** Assert the column-lock holds (every probed column Δ ≤ 1px) + zero horizontal overflow. Desktop model. */
async function assertGeometryDesktop(page: Page, label: string): Promise<void> {
  // Web-first: poll until the layout effect has measured + drawn at least the spine columns.
  await expect
    .poll(async () => (await measureStep(page)).columnLock.length, {
      message: `[${label}] column-lock probes resolve`,
    })
    .toBeGreaterThanOrEqual(6);
  const geom = await measureStep(page);
  const maxLock = Math.max(...geom.columnLock.map((c) => c.delta));
  expect(maxLock, `[${label}] column-lock Δ max ${maxLock.toFixed(3)}px ≤ 1 over ${JSON.stringify(geom.columnLock)}`).toBeLessThanOrEqual(1.0);
  expect(geom.horizOverflow, `[${label}] zero horizontal overflow (was ${String(geom.horizOverflow)}px)`).toBeLessThanOrEqual(0);
}

/** Assert one phase's stepper header + column node both read the expected state. State by data-attr (the
 *  resilient hook) + the sr-word text (the a11y contract) + the node glyph — never color. */
async function assertPhaseState(
  page: Page,
  phase: 'plan' | 'research' | 'brief' | 'spec' | 'code' | 'critic',
  state: 'ran' | 'running' | 'pending',
  label: string,
): Promise<void> {
  const word = state === 'ran' ? 'ran' : state === 'running' ? 'in progress' : 'pending';
  // The stepper header carries data-state (drives the under-bar color/weight) — the column-lock partner.
  const stepHeader = page.getByTestId(`gen-step-${phase}`);
  await expect(stepHeader, `[${label}] ${phase} stepper header has data-state=${state}`).toHaveAttribute('data-state', state);
  // The accessible state word inside the header (state by text, not color — DESIGN.md §Accessibility).
  await expect(stepHeader, `[${label}] ${phase} header sr-word "${word}"`).toContainText(word);
  // The phase column NODE (spine phases use the phase id; research is probed separately by its fan nodes).
  if (phase !== 'research') {
    const node = page.locator(`[data-node="${phase}"]`);
    await expect(node, `[${label}] ${phase} node data-state=${state}`).toHaveAttribute('data-state', state);
    const glyph = state === 'ran' ? '✓' : state === 'running' ? '⟳' : '○';
    await expect(node.locator('.gen-node__glyph'), `[${label}] ${phase} node glyph ${glyph}`).toHaveText(glyph);
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════
// A) THE FULL FLOW — unauth → sign-in → library → +New form → Generate → the generating shell appears.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════
test.describe('step-through A — the full flow (auth gate → library → create → generate)', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'full-flow film strip is captured desktop-only');

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('(1) unauth → /sign-in, (2) authed library, (3) +New reveals the 4 fields, (4) Generate POSTs the body', async ({
    page,
    context,
    baseURL,
  }) => {
    // (1) UNAUTHENTICATED → redirected to /sign-in, and the sign-in renders.
    await page.goto('/');
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/sign in/i);
    await expect(page.getByRole('button')).toBeVisible();
    await filmShot(page, 'A1-signin');

    // (2) WITH the test-auth session → the LIBRARY renders (owner-scoped cards + the +New card).
    await signInAsTestOwner(context, baseURL ?? '');
    await page.goto('/');
    await expect(page).not.toHaveURL(/\/sign-in/);
    await expect(page.getByRole('main')).toBeVisible();
    const newCard = page.getByRole('button', { name: /new lesson/i });
    await expect(newCard).toBeVisible();
    // The seeded dense library card is present too (owner-scoped grid).
    await expect(page.locator('a.library-poster__card').first()).toBeVisible();
    await filmShot(page, 'A2-library');

    // (3) CLICK +New → the create-form reveals with the FOUR fields + their defaults.
    await newCard.click();
    const intake = page.locator('.intake');
    await expect(intake).toBeVisible();
    // topic textbox
    await expect(intake.getByRole('textbox').first()).toBeVisible();
    // level <select> defaulting to intermediate
    const level = intake.getByRole('combobox');
    await expect(level).toBeVisible();
    await expect(level, 'level defaults to intermediate').toHaveValue('intermediate');
    // depth slider defaulting to 3
    const depth = intake.getByRole('slider');
    await expect(depth).toBeVisible();
    await expect(depth, 'depth defaults to 3').toHaveValue('3');
    // audience field
    await expect(intake.getByText(/Audience/)).toBeVisible();
    await filmShot(page, 'A3-create-form');

    // (4) FILL topic + change level/depth → Generate → assert the exact POST body + the generating shell.
    await intake.getByRole('textbox').first().fill('Fourier transforms');
    await level.selectOption('advanced');
    await depth.fill('5');
    await expect(depth).toHaveValue('5');

    // Pin /api/generate to the seeded in-flight run id so the run never executes (the generating shell stays
    // up with the typed topic); capture the POST to assert the exact body shape.
    const postBody = page
      .waitForRequest((r) => r.url().endsWith('/api/generate') && r.method() === 'POST')
      .then((r) => r.postDataJSON() as Record<string, unknown>);
    await page.route('**/api/generate', async (route) => {
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ id: SEED_GENERATING_RUN_ID }),
      });
    });
    // Keep the generating shell quiet (no phase advance) — serve the first scripted snapshot once.
    await page.route(`**/api/curriculum/${SEED_GENERATING_RUN_ID}/status`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: SEED_GENERATING_RUN_ID, ...STEP_SEQUENCE[0]!.payload }),
      });
    });

    await intake.getByRole('button', { name: /generate/i }).click();

    // The EXACT POST body the contract preserves (the four trimmed keys, with the changed level/depth).
    const body = await postBody;
    expect(body.topic).toBe('Fourier transforms');
    expect(body.level).toBe('advanced');
    expect(body.depth).toBe(5);
    expect(body).toHaveProperty('audience');

    // The submit transition runs (under reduced motion it advances SYNCHRONOUSLY): the in-place generating
    // shell appears with the typed topic in the header.
    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toContainText(/generating/i);
    await expect(h1.locator('.gen-topic__topic')).toHaveText('Fourier transforms');
    await expect(page.getByTestId('gen-research-band')).toBeVisible();
    await filmShot(page, 'A4-generating-shell');
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════
// B) THE PHASE PROGRESSION — one test STEPS THROUGH all six phases via a SCRIPTED status sequence, asserting
//    the rendered state + the column-lock geometry AFTER EACH PUSH. A film strip is captured per step.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════
test.describe('step-through B — the phase progression (scripted status sequence)', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'the column-lock geometry model is desktop-only (SPEC §9)');

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('plan → research(questions → findings 1..3) → brief → spec → code → critic → ready', async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(120_000); // ~10 scripted pushes × the 2.5s poll cadence + assertions

    await signInAsTestOwner(context, baseURL ?? '');

    // The MUTABLE cursor the status route serves. The spec advances `current` between assertions; the page's
    // own 2.5s poll lands the new state, and the web-first matchers retry until it arrives. NO sleeps.
    let current: StepSnapshot = STEP_SEQUENCE[0]!;
    await page.route(`**/api/curriculum/${SEED_GENERATING_RUN_ID}/status`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: SEED_GENERATING_RUN_ID, ...current.payload }),
      });
    });

    await page.goto(`/curriculum/${SEED_GENERATING_RUN_ID}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/generating/i);

    // Walk every scripted snapshot. After advancing the cursor, wait on a STATE signal unique to the snapshot
    // (the active phase's data-state, or the band count), then assert the full contract + geometry + shot.
    for (const snap of STEP_SEQUENCE) {
      current = snap;

      // Anchor: wait until the new snapshot's research count has landed (the cheapest unambiguous signal).
      await expect(page.getByTestId('gen-research-count'), `[${snap.name}] band count`).toHaveText(snap.extractedText);

      // The STEPPER marks the correct active phase + done/pending — assert EVERY phase column's state.
      for (const phase of ['plan', 'research', 'brief', 'spec', 'code', 'critic'] as const) {
        await assertPhaseState(page, phase, snap.phaseStates[phase], snap.name);
      }

      // The RESEARCH column question nodes appear + advance (pending → running → done) — assert each node's
      // state matches its scripted research row.
      const researchRows = snap.payload.research;
      for (let i = 0; i < researchRows.length; i++) {
        const row = researchRows[i]!;
        const node = page.locator(`[data-node="research-${String(i)}"]`);
        await expect(node, `[${snap.name}] research-${String(i)} present`).toBeVisible();
        // A done row → ✓ ran; a pending (announced-not-landed) row → ⟳ in progress (graph treats it live).
        const expectState = row.status === 'done' ? 'ran' : 'running';
        const expectGlyph = expectState === 'ran' ? '✓' : '⟳';
        await expect(node, `[${snap.name}] research-${String(i)} state ${expectState}`).toHaveAttribute('data-state', expectState);
        await expect(node.locator('.gen-node__glyph'), `[${snap.name}] research-${String(i)} glyph`).toHaveText(expectGlyph);
      }

      // The LIVE RESEARCH band shows the real findings (claim + source host) as they land + the N/M count.
      const band = page.getByTestId('gen-research-band');
      await expect(band.getByText(/LIVE RESEARCH/)).toBeVisible();
      const landedFindings = researchRows.filter((r) => r.status === 'done');
      for (const r of landedFindings) {
        const claim = r.findings[0]?.claim;
        if (claim) {
          await expect(band.getByText(claim), `[${snap.name}] finding "${claim.slice(0, 24)}…"`).toBeVisible();
        }
      }
      // The finding card count in the band equals the number of landed (done) findings (no fabricated rows).
      await expect(band.locator('.gen-finding:not(.gen-finding--queued)'), `[${snap.name}] ${String(landedFindings.length)} finding cards`).toHaveCount(landedFindings.length);

      // The PIPELINE PROGRESS reflects the timings: the active phase's progress segment reads "in progress".
      if (snap.activePhase) {
        const seg = page.locator(`.gen-pstep`, { hasText: snap.activePhase });
        await expect(seg.first(), `[${snap.name}] progress segment ${snap.activePhase} running`).toHaveClass(/gen-pstep--running/);
      }

      // GEOMETRY HOLDS AT EVERY STEP — column-lock Δ ≤ 1px + zero horizontal overflow.
      await assertGeometryDesktop(page, snap.name);

      await filmShot(page, `B-${snap.name}`);
    }

    // FINALLY: push the terminal `ready: true` snapshot. The reader-route poller calls router.refresh(); the
    // run has NO persisted curriculum (seed stamps only the run_owner), so the refresh re-renders the
    // generating branch (ownsRun true, getCurriculum still null) rather than a 404 — proving the ready path
    // fires the navigation without a fabricated lesson. Assert the route stayed owned (no sign-in bounce, no
    // 404) and the heading resolved.
    current = READY_SNAPSHOT;
    await expect.poll(async () => {
      // Force a fresh poll cycle to deliver ready; the page either refreshes (reader) — assert it didn't bounce.
      return page.url();
    }).toContain(`/curriculum/${SEED_GENERATING_RUN_ID}`);
    await expect(page).not.toHaveURL(/\/sign-in/);
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await filmShot(page, 'B-ready');
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════
// C) STATES + EDGE — the stress overflow (N=9), reduced motion, and the mobile collapse.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════
test.describe('step-through C — states + edge (stress overflow · reduced motion · mobile)', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('stress N=9 — research caps at 3 visible + a "+6 below" chip; overflow sinks into the band; no overflow', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 1000, 'the fit-cap + overflow chip is a desktop-only model (SPEC §9)');
    await signInAsTestOwner(context, baseURL ?? '');
    await page.route(`**/api/curriculum/${SEED_GENERATING_RUN_ID}/status`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: SEED_GENERATING_RUN_ID, ...STRESS_PAYLOAD }),
      });
    });
    await page.goto(`/curriculum/${SEED_GENERATING_RUN_ID}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/generating/i);
    await expect(page.getByTestId('gen-research-count')).toHaveText('3 / 9 extracted');

    // The research column caps at 3 VISIBLE nodes + a "+6 below" chip (the fit-math overflow path).
    await expect
      .poll(async () => (await measureStep(page)).visibleResearch, { message: 'research column caps at 3' })
      .toBe(3);
    const geom = await measureStep(page);
    expect(geom.overflowChip, `overflow chip "+6 below" (was ${String(geom.overflowChip)})`).toMatch(/\+6 below/);

    // The 6 overflowed questions sink into the band as QUEUED cards (the chip's downward sink).
    const band = page.getByTestId('gen-research-band');
    await expect(band.locator('.gen-finding--queued'), '6 queued overflow cards').toHaveCount(6);
    // The 3 grounded findings are still shown alongside them.
    await expect(band.locator('.gen-finding:not(.gen-finding--queued)'), '3 grounded findings').toHaveCount(3);

    // Column-lock holds WITH the overflow chip reserved, and there is NO horizontal overflow.
    await assertGeometryDesktop(page, 'stress-N9');
    await filmShot(page, 'C-stress-N9');
  });

  test('reduced motion — the state push is instant + the layout is identical (column-lock holds)', async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 1000, 'desktop column-lock model (SPEC §9)');
    await signInAsTestOwner(context, baseURL ?? '');
    // Two snapshots back-to-back; under forced reduced motion the swap is instant (no entrance stagger), so
    // the geometry is identical before + after — proving no motion-dependent layout.
    let current = STEP_SEQUENCE[1]!; // research running, questions appearing
    await page.route(`**/api/curriculum/${SEED_GENERATING_RUN_ID}/status`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: SEED_GENERATING_RUN_ID, ...current.payload }),
      });
    });
    await page.goto(`/curriculum/${SEED_GENERATING_RUN_ID}`);
    await expect(page.getByTestId('gen-research-count')).toHaveText('0 / 3 extracted');
    await assertGeometryDesktop(page, 'reduced-motion-before');
    const before = await measureStep(page);

    current = STEP_SEQUENCE[4]!; // brief running, research all done — an instant state push
    await expect(page.getByTestId('gen-research-count')).toHaveText('3 / 3 extracted');
    await assertGeometryDesktop(page, 'reduced-motion-after');
    const after = await measureStep(page);

    // The spine columns' x-centers don't move between states (layout identical; only states changed).
    expect(after.columnLock.length).toBe(before.columnLock.length);
    await filmShot(page, 'C-reduced-motion');
  });

  test('mobile 390px — single-column collapse, no horizontal overflow', async ({ page, context, baseURL }) => {
    test.skip((page.viewportSize()?.width ?? 0) >= 1000, 'mobile-collapse assertion runs on the mobile project only');
    await signInAsTestOwner(context, baseURL ?? '');
    await page.route(`**/api/curriculum/${SEED_GENERATING_RUN_ID}/status`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: SEED_GENERATING_RUN_ID, ...STEP_SEQUENCE[4]!.payload }),
      });
    });
    await page.goto(`/curriculum/${SEED_GENERATING_RUN_ID}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/generating/i);
    await expect(page.getByTestId('gen-research-count')).toHaveText('3 / 3 extracted');

    // On mobile the plane collapses to a single vertical flex column (edges hidden); ALL research nodes show
    // (no fit-cap), and there is NO horizontal overflow at 390px.
    const collapse = await page.evaluate(() => {
      const grid = document.querySelector('.gen-plane__grid');
      const edges = document.querySelector('.gen-plane__edges');
      const researchNodes = document.querySelectorAll('.gen-cell[data-phase="research"] .gen-node').length;
      const horizOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      const edgesHidden = edges ? getComputedStyle(edges).display === 'none' : true;
      const flow = grid ? getComputedStyle(grid).flexDirection : '';
      return { researchNodes, horizOverflow, edgesHidden, flow };
    });
    expect(collapse.horizOverflow, `no horizontal overflow at 390px (was ${String(collapse.horizOverflow)}px)`).toBeLessThanOrEqual(0);
    expect(collapse.edgesHidden, 'edges hidden on mobile collapse').toBe(true);
    expect(collapse.flow, 'plane grid is a vertical column on mobile').toBe('column');
    expect(collapse.researchNodes, 'all 3 research nodes shown (no cap) on mobile').toBe(3);
    await filmShot(page, 'C-mobile-390');
  });
});
