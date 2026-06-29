import { describe, expect, it } from 'vitest';
import { multiSink, noopEventSink, stageLabel, type EventSink, type WorkflowEvent } from './events';

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
