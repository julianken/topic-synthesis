import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DegradeReason } from '../domain/degrade';
import type { PipelineRunResult } from '../pipeline/run-pipeline';
import type { SitemapHub } from '../domain/sitemap';
import { buildJobInput, runCompleteEvent, runFailedEvent } from './run-job';

const SAVED = { ...process.env };
const JOB_KEYS = ['RUN_ID', 'TOPIC', 'LEVEL', 'DEPTH', 'AUDIENCE', 'CHEAP', 'MAX_NODES', 'MAX_QUESTIONS'];

beforeEach(() => {
  for (const k of JOB_KEYS) delete process.env[k];
});
afterEach(() => {
  process.env = { ...SAVED };
});

describe('buildJobInput', () => {
  it('reads RUN_ID + TOPIC + knobs from env (RUN_ID is the input id, never generated)', () => {
    Object.assign(process.env, {
      RUN_ID: 'r1',
      TOPIC: 'Fourier transforms',
      LEVEL: 'advanced',
      DEPTH: '4',
      CHEAP: '1',
      MAX_NODES: '4',
      MAX_QUESTIONS: '3',
    });
    const { runId, request, options } = buildJobInput();
    expect(runId).toBe('r1');
    expect(request).toEqual({
      topic: 'Fourier transforms',
      settings: { level: 'advanced', depth: 4, audience: 'a self-taught learner' },
    });
    expect(options.maxNodes).toBe(4);
    expect(options.maxQuestions).toBe(3);
    expect(options.models).toBeDefined(); // CHEAP → cheapModels()
  });

  it('defaults level/depth/audience when unset', () => {
    Object.assign(process.env, { RUN_ID: 'r', TOPIC: 't' });
    const { request, options } = buildJobInput();
    expect(request.settings).toEqual({ level: 'intermediate', depth: 3, audience: 'a self-taught learner' });
    expect(options.models).toBeUndefined();
  });

  it('throws on a missing RUN_ID (never generated — a resume must reuse the same id)', () => {
    process.env.TOPIC = 't';
    expect(() => buildJobInput()).toThrow(/RUN_ID/);
  });

  it('throws on a missing TOPIC', () => {
    process.env.RUN_ID = 'r';
    expect(() => buildJobInput()).toThrow(/TOPIC/);
  });

  it('throws on an invalid MAX_NODES (a typo cannot silently cap to 0 after spend)', () => {
    Object.assign(process.env, { RUN_ID: 'r', TOPIC: 't', MAX_NODES: 'oops' });
    expect(() => buildJobInput()).toThrow(/MAX_NODES/);
  });
});

const hubWith = (built: boolean): SitemapHub => ({
  tiers: [
    {
      tier: 'Tier 1',
      categories: [{ name: 'Lesson', pages: [{ slug: 's', title: 't', built, status: built ? 'built' : 'soon', href: '' }] }],
    },
  ],
});

const runResult = (built: boolean, pageCount: number, degrade?: DegradeReason): PipelineRunResult => ({
  result: {
    hub: hubWith(built),
    pages: Array.from({ length: pageCount }, () => ({})) as PipelineRunResult['result']['pages'],
  },
  records: [],
  costUsd: 0.42,
  ...(degrade ? { degrade } : {}),
});

describe('runCompleteEvent', () => {
  it('reports outcome=complete + criticPassed when the hub page is built', () => {
    expect(runCompleteEvent(runResult(true, 1), 2000)).toEqual({
      eventType: 'run.complete',
      costUsd: 0.42,
      totalMs: 2000,
      pages: 1,
      outcome: 'complete',
      criticPassed: true,
    });
  });

  it('reports outcome=degraded even when pages is EMPTY — derived from the hub, not pages.length', () => {
    expect(runCompleteEvent(runResult(false, 0), 1000)).toEqual({
      eventType: 'run.complete',
      costUsd: 0.42,
      totalMs: 1000,
      pages: 0,
      outcome: 'degraded',
      criticPassed: false,
    });
  });

  it('treats an empty hub (no page) as degraded', () => {
    const r = runResult(false, 0);
    r.result.hub.tiers = [];
    expect(runCompleteEvent(r, 5).outcome).toBe('degraded');
  });

  // #184: prod telemetry records the exact commit each run executed, so a future stale-deploy is
  // visible in the dashboard. The field is OPTIONAL — absent when no GIT_SHA is threaded (above).
  it('stamps codeRev when a GIT_SHA is threaded', () => {
    expect(runCompleteEvent(runResult(true, 1), 2000, 'abc1234')).toMatchObject({ codeRev: 'abc1234' });
  });

  it('omits codeRev when none is threaded (the field is optional)', () => {
    expect(runCompleteEvent(runResult(true, 1), 2000)).not.toHaveProperty('codeRev');
  });

  // #214: the operator-only gate-reason channel. A degraded run carries run.degrade; runCompleteEvent
  // emits its low-cardinality code (the metric label) + the bounded operator-only detail.
  it('emits degradeCode + degradeDetail for a critic-rejection run (the graceful fail)', () => {
    const degrade: DegradeReason = { gate: 'critic', code: 'critic_rejected', detail: 'rubric: weak interaction' };
    const ev = runCompleteEvent(runResult(false, 1, degrade), 1000);
    expect(ev).toMatchObject({
      outcome: 'degraded',
      criticPassed: false,
      degradeCode: 'critic_rejected',
      degradeDetail: 'rubric: weak interaction',
    });
  });

  it('emits synthesis_error — distinguishable from a critic reject (both read criticPassed:false today)', () => {
    const degrade: DegradeReason = { gate: 'synthesis', code: 'synthesis_error', detail: 't: code stage hit the output cap' };
    const ev = runCompleteEvent(runResult(false, 0, degrade), 1000);
    expect(ev.degradeCode).toBe('synthesis_error');
    expect(ev.degradeDetail).toContain('output cap');
    expect(ev.criticPassed).toBe(false); // the bit alone can't tell the two causes apart — the code can
  });

  it('omits BOTH degradeCode and degradeDetail on a built run (fields absent, not null)', () => {
    const ev = runCompleteEvent(runResult(true, 1), 2000);
    expect(ev).not.toHaveProperty('degradeCode');
    expect(ev).not.toHaveProperty('degradeDetail');
  });

  it('omits the degrade fields on a degraded run with no reason threaded (curriculum path / legacy caller)', () => {
    const ev = runCompleteEvent(runResult(false, 0), 1000);
    expect(ev.outcome).toBe('degraded');
    expect(ev).not.toHaveProperty('degradeCode');
    expect(ev).not.toHaveProperty('degradeDetail');
  });
});

describe('runFailedEvent', () => {
  it('reports outcome=failed with the error name as errorKind', () => {
    expect(runFailedEvent(new TypeError('boom'))).toEqual({
      eventType: 'run.failed',
      outcome: 'failed',
      errorKind: 'TypeError',
    });
  });

  it('falls back to "unknown" for a non-Error throw', () => {
    expect(runFailedEvent('nope')).toEqual({ eventType: 'run.failed', outcome: 'failed', errorKind: 'unknown' });
  });

  // #184: the crash case is the most diagnostically valuable "which commit was running?" — stamp it too.
  it('stamps codeRev when a GIT_SHA is threaded', () => {
    expect(runFailedEvent(new Error('boom'), 'abc1234')).toMatchObject({ codeRev: 'abc1234' });
  });

  it('omits codeRev when none is threaded (the field is optional)', () => {
    expect(runFailedEvent('nope')).not.toHaveProperty('codeRev');
  });
});
