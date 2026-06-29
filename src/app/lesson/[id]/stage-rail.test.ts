import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DISPATCH_LABEL,
  DISPATCH_STEP_NAME,
  STAGE_RAIL,
  deriveRail,
  formatDuration,
  isStarting,
  type StepEvent,
} from './stage-rail';

// A minimal step-event builder for the derivation tests.
function ev(name: string, over: Partial<StepEvent> = {}): StepEvent {
  return {
    name,
    stepKey: `${name}:k`,
    startedAt: '2026-06-21T00:00:00.000Z',
    finishedAt: null,
    status: 'running',
    ...over,
  };
}

// ── isStarting — the dispatch-window "Starting…" indicator (issue #162 A4) ──────────────────────────
describe('isStarting — the pre-`plan` dispatch window (issue #162)', () => {
  it('the marker label is user-facing copy, never the raw "dispatch" identifier', () => {
    expect(DISPATCH_LABEL).toBe('Starting…');
    expect(DISPATCH_LABEL).not.toContain(DISPATCH_STEP_NAME);
  });

  it('is true when only the dispatch marker is present (no real step yet)', () => {
    expect(isStarting([ev(DISPATCH_STEP_NAME, { finishedAt: '2026-06-21T00:00:00.000Z', status: 'dispatched' })])).toBe(true);
  });

  it('is false once a REAL pipeline step appears — so it yields to the rail (never two live timers)', () => {
    const steps = [
      ev(DISPATCH_STEP_NAME, { finishedAt: '2026-06-21T00:00:00.000Z', status: 'dispatched' }),
      ev('plan'), // plan running → the rail carries the single live timer
    ];
    expect(isStarting(steps)).toBe(false);
    // And the dispatch marker is NOT a rail position — deriveRail ignores it (no "dispatch" node/timer).
    expect(deriveRail(steps).some((s) => s.name === DISPATCH_STEP_NAME)).toBe(false);
  });

  it('is false on an empty feed and on a feed with no marker', () => {
    expect(isStarting([])).toBe(false);
    expect(isStarting([ev('plan')])).toBe(false);
  });
});

// ── AC1/AC2 — the rail is EXACTLY the six live single-lesson stages, in order, with NO graph ─────────
describe('STAGE_RAIL — the canonical six-stage live single-lesson rail (TS-23 AC1/AC2)', () => {
  it('is exactly six stages in pipeline order: plan, research, brief, spec, code, critic', () => {
    expect(STAGE_RAIL.map((s) => s.name)).toEqual([
      'plan',
      'research',
      'brief',
      'spec',
      'code',
      'critic',
    ]);
  });

  it('has NO graph/gate/hub stage (the graph path is DORMANT — decision 9 / ADR-0003)', () => {
    const names = STAGE_RAIL.map((s) => s.name);
    expect(names).not.toContain('graph');
    expect(names).not.toContain('gate');
    expect(names).not.toContain('hub');
  });

  it('carries a human label for every stage', () => {
    for (const s of STAGE_RAIL) expect(s.label.length).toBeGreaterThan(0);
  });
});

// ── AC3 — deriveRail folds the poll onto the fixed rail with the right per-stage state ───────────────
describe('deriveRail — folds the poll onto the fixed six-stage rail (TS-23 AC3)', () => {
  it('returns all six positions even with NO events (a fresh run shows the whole pipeline up front)', () => {
    const rail = deriveRail([]);
    expect(rail).toHaveLength(6);
    expect(rail.map((r) => r.name)).toEqual(STAGE_RAIL.map((s) => s.name));
    // Every position is pending: no event, no timer, no duration.
    expect(rail.every((r) => r.state === 'pending')).toBe(true);
    expect(rail.every((r) => r.event === null)).toBe(true);
  });

  it('marks a stage with no matching event PENDING and one with an event by its lifecycle', () => {
    const rail = deriveRail([
      ev('plan', { finishedAt: '2026-06-21T00:00:03.200Z', status: 'done' }),
      ev('research', { finishedAt: null, status: 'running' }),
    ]);
    const stateOf = (name: string) => rail.find((r) => r.name === name)?.state;
    expect(stateOf('plan')).toBe('done');
    expect(stateOf('research')).toBe('running');
    // The later stages never landed an event → pending.
    expect(stateOf('brief')).toBe('pending');
    expect(stateOf('spec')).toBe('pending');
    expect(stateOf('code')).toBe('pending');
    expect(stateOf('critic')).toBe('pending');
  });

  it('derives ERROR from a failed event (even if it timed an end before failing)', () => {
    const rail = deriveRail([
      ev('spec', { finishedAt: '2026-06-21T00:00:01.000Z', status: 'error' }),
    ]);
    expect(rail.find((r) => r.name === 'spec')?.state).toBe('error');
  });

  it('keeps canonical rail ORDER regardless of the poll order', () => {
    const rail = deriveRail([ev('critic'), ev('plan'), ev('code')]);
    expect(rail.map((r) => r.name)).toEqual([
      'plan',
      'research',
      'brief',
      'spec',
      'code',
      'critic',
    ]);
  });

  it('attaches the matched event to its position for the ledger timing readout', () => {
    const planEv = ev('plan', { finishedAt: '2026-06-21T00:00:02.000Z', status: 'done' });
    const rail = deriveRail([planEv]);
    expect(rail.find((r) => r.name === 'plan')?.event).toEqual(planEv);
    expect(rail.find((r) => r.name === 'brief')?.event).toBeNull();
  });
});

// ── research fan-out — N concurrent 'research' events collapse to ONE correct rail entry ──────────────
// The ANALYSIS prelude fans the researchers out via `Promise.all(... engine.step('research', …))`
// (src/pipeline/run-pipeline.ts), so a single poll carries N `research` rows, all `name: 'research'`
// with distinct step_keys. deriveRail must aggregate them into one phase rather than last-wins collapse.
describe('deriveRail — aggregates the research FAN-OUT into one rail entry', () => {
  it('collapses N research rows to ONE rail position', () => {
    const rail = deriveRail([
      ev('research', { stepKey: 'research:a' }),
      ev('research', { stepKey: 'research:b' }),
      ev('research', { stepKey: 'research:c' }),
    ]);
    expect(rail.filter((r) => r.name === 'research')).toHaveLength(1);
    expect(rail).toHaveLength(6);
  });

  it('stays RUNNING while ANY researcher is still in-flight (not "done" off one early finisher)', () => {
    // One researcher already finished, two still running — a last-wins collapse keyed on started_at
    // ORDER could show this phase "done"; aggregation must keep it running with NO finishedAt.
    const rail = deriveRail([
      ev('research', {
        stepKey: 'research:a',
        startedAt: '2026-06-21T00:00:01.000Z',
        finishedAt: '2026-06-21T00:00:03.000Z',
        status: 'done',
      }),
      ev('research', {
        stepKey: 'research:b',
        startedAt: '2026-06-21T00:00:01.500Z',
        finishedAt: null,
        status: 'running',
      }),
      ev('research', {
        stepKey: 'research:c',
        startedAt: '2026-06-21T00:00:02.000Z',
        finishedAt: null,
        status: 'running',
      }),
    ]);
    const research = rail.find((r) => r.name === 'research')!;
    expect(research.state).toBe('running');
    expect(research.event?.finishedAt).toBeNull();
    // The phase timer starts at the EARLIEST researcher, not the last by started_at.
    expect(research.event?.startedAt).toBe('2026-06-21T00:00:01.000Z');
  });

  it('is DONE only when ALL researchers finished, spanning earliest start → latest finish', () => {
    const rail = deriveRail([
      ev('research', {
        stepKey: 'research:a',
        startedAt: '2026-06-21T00:00:01.000Z',
        finishedAt: '2026-06-21T00:00:04.000Z',
        status: 'done',
      }),
      ev('research', {
        stepKey: 'research:b',
        startedAt: '2026-06-21T00:00:02.000Z',
        finishedAt: '2026-06-21T00:00:06.000Z',
        status: 'done',
      }),
    ]);
    const research = rail.find((r) => r.name === 'research')!;
    expect(research.state).toBe('done');
    expect(research.event?.startedAt).toBe('2026-06-21T00:00:01.000Z');
    expect(research.event?.finishedAt).toBe('2026-06-21T00:00:06.000Z');
  });

  it('is ERROR if ANY researcher errored, even when others finished cleanly', () => {
    const rail = deriveRail([
      ev('research', {
        stepKey: 'research:a',
        finishedAt: '2026-06-21T00:00:03.000Z',
        status: 'done',
      }),
      ev('research', {
        stepKey: 'research:b',
        finishedAt: '2026-06-21T00:00:02.000Z',
        status: 'error',
      }),
    ]);
    expect(rail.find((r) => r.name === 'research')?.state).toBe('error');
  });
});

// ── formatDuration — the ledger's compact duration readout ──────────────────────────────────────────
describe('formatDuration — compact ledger durations', () => {
  it('formats milliseconds as fixed-1 seconds', () => {
    expect(formatDuration(820)).toBe('0.8s');
    expect(formatDuration(3210)).toBe('3.2s');
  });
  it('clamps a negative span to 0.0s (a clock skew can never show a negative timer)', () => {
    expect(formatDuration(-50)).toBe('0.0s');
  });
});

// ── AC2 (markup) — the generating view renders no graph rail position, by label or name ──────────────
// The `.tsx` view can't mount in vitest's `environment: 'node'` (no DOM — the constraint
// `lesson-message.test.ts` / `page.test.ts` note), so this is a SOURCE byte-pin: it asserts the rail
// vocabulary present in the SHARED view (`generating-view.tsx`, the B live-research view — both the
// reader-route poller and the create-form shell render it, so there is ONE rail surface) and the
// absence of any graph/gate/hub PIPELINE-STAGE entry. (The B view's research NODE-GRAPH is a research
// DAG over the real `research` feed — NOT a pipeline `graph` stage; the pin below targets the stage
// vocabulary, `name: 'graph'`, which never appears.)
describe('generating-view.tsx — renders the compact progress pill, never a graph stage (TS-23 AC2)', () => {
  const VIEW = readFileSync(fileURLToPath(new URL('./generating-view.tsx', import.meta.url)), 'utf8');
  const RAIL = readFileSync(fileURLToPath(new URL('./stage-rail.ts', import.meta.url)), 'utf8');

  it('renders the compact progress bar + the top stepper from the canonical stage list via deriveRail', () => {
    expect(VIEW).toContain('deriveRail');
    // The full-width column-table view (superseding the #154 side-rail) renders the SIX phases as the
    // top STEPPER (the column headers) AND the compact bottom PROGRESS bar — both folding over the SAME
    // `deriveRail` six-stage list.
    expect(VIEW).toContain('className="gen-stepper"');
    expect(VIEW).toContain('className="gen-progress__steps"');
  });

  it('introduces NO graph/gate/hub stage entry in the view or the rail module', () => {
    // The retired graph path must not appear as a pipeline-stage `name`/`label` on either surface. (A
    // `concept-drift-ok` note in stage-rail.ts explains the deliberate omission to a future reader.)
    // The table's PHASES list is the six live stages — `graph` is omitted.
    expect(VIEW).not.toMatch(/'plan',\s*'research',\s*'brief',\s*'spec',\s*'code',\s*'critic',\s*'graph'/);
    expect(VIEW).not.toMatch(/name:\s*'graph'/);
    expect(RAIL).not.toMatch(/name:\s*'(graph|gate|hub)'/);
  });

  it('conveys state by icon + text, not color alone (a per-state affordance map + the accessible word)', () => {
    expect(VIEW).toContain('CELL_AFFORDANCE'); // the node/stepper per-state glyph + screen-reader word map
    expect(VIEW).toContain('SEG_AFFORDANCE'); // the progress segment per-state glyph + accessible word map
    expect(VIEW).toContain('gen-sr'); // the visually-hidden accessible state word
  });
});

// ── AC5/AC6/AC7 — TS-23 touches NO data path: status route, getStepEvents, step_event storage, infra ─
// A guard that the generating-view reshape did not reach into the data layer. These read the actual
// source files and assert the load-bearing data-path lines are still present and untouched in shape, so
// a future change that quietly edits the route/store/schema alongside the view trips here.
describe('TS-23 — the view is a pure presentation reshape over the EXISTING stream (AC5/AC6/AC7)', () => {
  const ROUTE = readFileSync(
    fileURLToPath(new URL('../../api/lesson/[id]/status/route.ts', import.meta.url)),
    'utf8',
  );
  const REPO = readFileSync(fileURLToPath(new URL('../../../store/repo.ts', import.meta.url)), 'utf8');
  const SCHEMA = readFileSync(fileURLToPath(new URL('../../../store/schema.sql', import.meta.url)), 'utf8');

  it('AC5 — the status route still returns owner-scoped { ready, steps } from getStepEvents', () => {
    expect(ROUTE).toContain('getStepEvents');
    expect(ROUTE).toContain('ownsRun');
    expect(ROUTE).toContain('ready: view !== null');
  });

  it('AC6 — getStepEvents reads the per-run step_event timeline unchanged (no durable graduation)', () => {
    expect(REPO).toContain('FROM step_event WHERE run_id = $1 ORDER BY started_at');
    // step_event stays per-run transient: persistRun still PRUNES it.
    expect(REPO).toContain('DELETE FROM step_event WHERE run_id = $1');
  });

  it('AC6 — step_event is still defined as a per-run table (no new timeline table/column)', () => {
    expect(SCHEMA).toMatch(/create\s+table\s+(if\s+not\s+exists\s+)?step_event/i);
  });
});
