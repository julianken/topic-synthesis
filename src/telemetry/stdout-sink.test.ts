import { describe, expect, it } from 'vitest';
import { StdoutEventSink } from './stdout-sink';

describe('StdoutEventSink', () => {
  const sink = (lines: string[]) => new StdoutEventSink('run1', (l: string) => void lines.push(l));

  it('writes exactly one JSON line per event carrying the envelope + the event fields', () => {
    const lines: string[] = [];
    sink(lines).onEvent({ eventType: 'step.finish', stage: 'code', stepKey: 'k', ms: 1234, status: 'done' });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)).toMatchObject({
      runId: 'run1',
      seq: 0,
      schemaVersion: 2,
      severity: 'INFO',
      eventType: 'step.finish',
      stage: 'code',
      stepKey: 'k',
      ms: 1234,
      status: 'done',
    });
  });

  it('assigns a monotonic seq across events from the same instance', () => {
    const lines: string[] = [];
    const s = sink(lines);
    s.onEvent({ eventType: 'step.start', stage: 'plan', stepKey: 'k' });
    s.onEvent({ eventType: 'step.start', stage: 'spec', stepKey: 'k' });
    expect(JSON.parse(lines[0] as string).seq).toBe(0);
    expect(JSON.parse(lines[1] as string).seq).toBe(1);
  });

  it('marks failures ERROR (run.failed and a failed step), INFO otherwise', () => {
    const lines: string[] = [];
    const s = sink(lines);
    s.onEvent({ eventType: 'run.failed', outcome: 'failed', errorKind: 'Boom' });
    s.onEvent({ eventType: 'step.finish', stage: 'code', stepKey: 'k', ms: 1, status: 'error' });
    s.onEvent({ eventType: 'llm.call', stage: 'plan', model: 'm', inputTokens: 1, outputTokens: 1, costUsd: 0 });
    expect(JSON.parse(lines[0] as string).severity).toBe('ERROR');
    expect(JSON.parse(lines[1] as string).severity).toBe('ERROR');
    expect(JSON.parse(lines[2] as string).severity).toBe('INFO');
  });

  it('emits a single line (no embedded newline) so Cloud Logging parses one entry', () => {
    const lines: string[] = [];
    sink(lines).onEvent({
      eventType: 'run.complete',
      costUsd: 0.48,
      totalMs: 420000,
      pages: 1,
      outcome: 'complete',
      criticPassed: true,
    });
    expect(lines[0] as string).not.toContain('\n');
  });
});
