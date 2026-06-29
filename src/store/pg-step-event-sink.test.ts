import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { PgStepEventSink } from './pg-step-event-sink';

function fakePool() {
  const calls: { sql: string; params: unknown[] }[] = [];
  const query = vi.fn(async (sql: string, params: unknown[]) => {
    calls.push({ sql, params });
    return { rows: [] };
  });
  return { pool: { query } as unknown as Pool, calls };
}

describe('PgStepEventSink', () => {
  it('writes a step_event start row on step.start (keyed run_id,name,step_key)', async () => {
    const { pool, calls } = fakePool();
    await new PgStepEventSink('run1', { pool }).onEvent({ eventType: 'step.start', stage: 'plan', stepKey: 'k' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain('INTO step_event');
    expect(calls[0]?.params).toEqual(['run1', 'plan', 'k']);
  });

  it('updates the step_event row on step.finish with the run status', async () => {
    const { pool, calls } = fakePool();
    await new PgStepEventSink('run1', { pool }).onEvent({
      eventType: 'step.finish',
      stage: 'code',
      stepKey: 'k',
      ms: 5,
      status: 'error',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain('UPDATE step_event');
    expect(calls[0]?.params).toEqual(['run1', 'code', 'k', 'error']);
  });

  it('ignores events it does not project (llm.call, run.*)', async () => {
    const { pool, calls } = fakePool();
    const sink = new PgStepEventSink('run1', { pool });
    await sink.onEvent({ eventType: 'llm.call', stage: 'plan', model: 'm', inputTokens: 1, outputTokens: 1, costUsd: 0 });
    await sink.onEvent({ eventType: 'run.failed', outcome: 'failed' });
    expect(calls).toHaveLength(0);
  });

  it('is best-effort — a DB write failure resolves (never throws into the paid run)', async () => {
    const pool = {
      query: vi.fn(async () => {
        throw new Error('db down');
      }),
    } as unknown as Pool;
    await expect(
      new PgStepEventSink('run1', { pool }).onEvent({ eventType: 'step.start', stage: 'plan', stepKey: 'k' }),
    ).resolves.toBeUndefined();
  });
});
