import { describe, expect, it } from 'vitest';
import { EVENT_SCHEMA_VERSION, multiSink, noopEventSink, stageLabel, type EventSink, type WorkflowEvent } from './events';

describe('stageLabel', () => {
  it('normalizes the analysis Stage names to the canonical engine vocabulary', () => {
    expect(stageLabel('planner')).toBe('plan');
    expect(stageLabel('researcher')).toBe('research');
  });

  it('leaves already-canonical stages (and unknowns) unchanged', () => {
    for (const s of ['graph', 'brief', 'spec', 'code', 'critic', 'judge']) {
      expect(stageLabel(s)).toBe(s);
    }
  });
});

describe('multiSink', () => {
  it('fans one event out to every child sink, in order', () => {
    const a: WorkflowEvent[] = [];
    const b: WorkflowEvent[] = [];
    const sink = multiSink([{ onEvent: (e) => void a.push(e) }, { onEvent: (e) => void b.push(e) }]);
    const ev: WorkflowEvent = { eventType: 'step.start', stage: 'plan', stepKey: 'k' };
    sink.onEvent(ev);
    expect(a).toEqual([ev]);
    expect(b).toEqual([ev]);
  });

  it('awaits async child sinks', async () => {
    const seen: string[] = [];
    const slow: EventSink = {
      onEvent: async () => {
        await Promise.resolve();
        seen.push('slow');
      },
    };
    await multiSink([slow]).onEvent({ eventType: 'step.start', stage: 'plan', stepKey: 'k' });
    expect(seen).toEqual(['slow']);
  });
});

describe('noopEventSink', () => {
  it('accepts any event without throwing', () => {
    expect(() => noopEventSink.onEvent({ eventType: 'run.failed', outcome: 'failed' })).not.toThrow();
  });
});

describe('EVENT_SCHEMA_VERSION', () => {
  it('is at v4 — the additive degradeCode/degradeDetail bump (#214)', () => {
    expect(EVENT_SCHEMA_VERSION).toBe(4);
  });
});

describe('run.complete degrade fields (#214)', () => {
  // A run.complete may carry the two new optional fields — this would FAIL typecheck if the variant
  // lacked them, so it asserts the schema shape AND that the fields thread through a sink unchanged.
  it('carries the optional degradeCode + degradeDetail through a sink', () => {
    const seen: WorkflowEvent[] = [];
    const sink: EventSink = { onEvent: (e) => void seen.push(e) };
    const ev: WorkflowEvent = {
      eventType: 'run.complete',
      costUsd: 0.1,
      totalMs: 100,
      pages: 0,
      outcome: 'degraded',
      criticPassed: false,
      degradeCode: 'critic_rejected',
      degradeDetail: 'rubric: weak interaction',
    };
    sink.onEvent(ev);
    expect(seen[0]).toMatchObject({ degradeCode: 'critic_rejected', degradeDetail: 'rubric: weak interaction' });
  });

  it('a built run.complete omits both degrade fields (they are optional, absent not null)', () => {
    const ev: WorkflowEvent = {
      eventType: 'run.complete',
      costUsd: 0.1,
      totalMs: 100,
      pages: 1,
      outcome: 'complete',
      criticPassed: true,
    };
    expect(ev).not.toHaveProperty('degradeCode');
    expect(ev).not.toHaveProperty('degradeDetail');
  });
});
