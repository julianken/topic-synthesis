import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { STAGE_RAIL, deriveRail, formatDuration, type StepEvent } from './stage-rail';

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
// vocabulary present in the view and the absence of any graph/gate/hub stage entry.
describe('generating.tsx — renders the stage rail, never a graph stage (TS-23 AC2)', () => {
  const VIEW = readFileSync(fileURLToPath(new URL('./generating.tsx', import.meta.url)), 'utf8');
  const RAIL = readFileSync(fileURLToPath(new URL('./stage-rail.ts', import.meta.url)), 'utf8');

  it('renders the rail from the canonical STAGE_RAIL via deriveRail', () => {
    expect(VIEW).toContain('deriveRail');
    expect(VIEW).toContain('STAGE_RAIL');
    expect(VIEW).toContain('className="rail"');
  });

  it('introduces NO graph/gate/hub stage entry in the view or the rail module', () => {
    // The retired graph path must not appear as a stage `name`/`label` on either surface. (A
    // `concept-drift-ok` note in stage-rail.ts explains the deliberate omission to a future reader.)
    expect(VIEW).not.toMatch(/name:\s*'graph'/);
    expect(RAIL).not.toMatch(/name:\s*'(graph|gate|hub)'/);
  });

  it('conveys state by icon + text, not color alone (a per-state affordance map + the · failed tag)', () => {
    expect(VIEW).toContain('RAIL_AFFORDANCE');
    expect(VIEW).toContain('· failed');
    expect(VIEW).toContain('rail__state-sr'); // the visually-hidden accessible state word
  });
});

// ── AC5/AC6/AC7 — TS-23 touches NO data path: status route, getStepEvents, step_event storage, infra ─
// A guard that the generating-view reshape did not reach into the data layer. These read the actual
// source files and assert the load-bearing data-path lines are still present and untouched in shape, so
// a future change that quietly edits the route/store/schema alongside the view trips here.
describe('TS-23 — the view is a pure presentation reshape over the EXISTING stream (AC5/AC6/AC7)', () => {
  const ROUTE = readFileSync(
    fileURLToPath(new URL('../../api/curriculum/[id]/status/route.ts', import.meta.url)),
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
