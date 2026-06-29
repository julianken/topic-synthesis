import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { WorkflowEvent } from '../telemetry/events';
import { GcpEngine } from './gcp-engine';

/** In-memory fake pool: SELECT reads the step_result store; INSERT writes it (ON CONFLICT DO NOTHING).
 *  step_event writes (issue #61) are accepted + ignored here — the dedicated timingPool() block below
 *  asserts the timeline; these tests only care about memoization. */
function fakePool() {
  const store = new Map<string, unknown>();
  const query = vi.fn(async (sql: string, params: unknown[]) => {
    if (sql.includes('step_event')) return { rows: [] }; // timing is exercised in timingPool() below
    const k = `${String(params[0])}:${String(params[1])}:${String(params[2])}`;
    if (sql.startsWith('SELECT')) {
      return store.has(k) ? { rows: [{ result_json: store.get(k) }] } : { rows: [] };
    }
    if (!store.has(k)) store.set(k, JSON.parse(params[3] as string)); // INSERT ... DO NOTHING
    return { rows: [] };
  });
  return { pool: { query } as unknown as Pool, store, query };
}

describe('GcpEngine', () => {
  it('runs a step once, persists it, and a resumed process reads it back without re-running', async () => {
    const { pool } = fakePool();
    const fn = vi.fn(async () => ({ v: 42 }));
    const first = new GcpEngine('run1', { pool });
    expect(await first.step('plan', 'k', fn)).toEqual({ v: 42 });
    expect(fn).toHaveBeenCalledTimes(1);

    // A fresh engine on the SAME run (a resumed Job process) serves from the durable store.
    const resumed = new GcpEngine('run1', { pool });
    expect(await resumed.step('plan', 'k', fn)).toEqual({ v: 42 });
    expect(fn).toHaveBeenCalledTimes(1); // not re-run — read back from Postgres
  });

  it('dedups concurrent in-flight callers in one process (the fan-out shares a step)', async () => {
    const { pool } = fakePool();
    let resolve!: (v: unknown) => void;
    const fn = vi.fn(() => new Promise((r) => (resolve = r)));
    const engine = new GcpEngine('run1', { pool });
    const a = engine.step('research', 'k', fn);
    const b = engine.step('research', 'k', fn);
    // fn runs only after the durable SELECT resolves (a microtask) — wait for it before resolving.
    await vi.waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    resolve({ ok: true });
    expect(await a).toEqual({ ok: true });
    expect(await b).toEqual({ ok: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not persist a failed step and re-runs it on retry', async () => {
    const { pool, store } = fakePool();
    const fn = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ v: 1 });
    const engine = new GcpEngine('run1', { pool });
    await expect(engine.step('graph', 'k', fn)).rejects.toThrow('boom');
    expect(store.size).toBe(0); // a rejected step is never persisted
    expect(await engine.step('graph', 'k', fn)).toEqual({ v: 1 }); // retry re-runs + succeeds
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('keys by run + name + key — different runs are independent', async () => {
    const { pool } = fakePool();
    const fn = vi.fn(async (tag: string) => ({ tag }));
    await new GcpEngine('runA', { pool }).step('plan', 'k', () => fn('A'));
    await new GcpEngine('runB', { pool }).step('plan', 'k', () => fn('B')); // same name+key, other run
    expect(fn).toHaveBeenCalledTimes(2);
  });

  // ── per-step TIMING (issue #61): step_event written on a real run, NOT on a cache-hit resume ──
  describe('step_event timing', () => {
    /**
     * A fake pool that models BOTH tables: step_result (the memoization store, by SELECT/INSERT) and
     * step_event (the timeline). It records every step_event write so a test can assert how a step
     * was timed (started → done/error) and that a resume wrote NONE.
     */
    function timingPool() {
      const results = new Map<string, unknown>(); // step_result store
      const events: { op: string; key: string; status?: string }[] = []; // step_event write log
      const query = vi.fn(async (sql: string, params: unknown[]) => {
        const key = `${String(params[0])}:${String(params[1])}:${String(params[2])}`;
        if (sql.includes('FROM step_result')) {
          return results.has(key) ? { rows: [{ result_json: results.get(key) }] } : { rows: [] };
        }
        if (sql.includes('INTO step_result')) {
          if (!results.has(key)) results.set(key, JSON.parse(params[3] as string));
          return { rows: [] };
        }
        if (sql.includes('INTO step_event')) {
          events.push({ op: 'start', key, status: 'running' });
          return { rows: [] };
        }
        if (sql.includes('UPDATE step_event')) {
          events.push({ op: 'finish', key, status: String(params[3]) });
          return { rows: [] };
        }
        return { rows: [] };
      });
      return { pool: { query } as unknown as Pool, results, events };
    }

    it('writes a start then a done event on a real (cache-miss) step', async () => {
      const { pool, events } = timingPool();
      const engine = new GcpEngine('run1', { pool });
      await engine.step('plan', 'k', async () => ({ v: 1 }));
      expect(events).toEqual([
        { op: 'start', key: 'run1:plan:k', status: 'running' },
        { op: 'finish', key: 'run1:plan:k', status: 'done' },
      ]);
    });

    it('a cache-hit resume of a completed step writes NO new step_event (timeline stays complete + non-duplicated)', async () => {
      const { pool, events } = timingPool();
      const fn = vi.fn(async () => ({ v: 42 }));
      // First run: the step really runs → start + done.
      await new GcpEngine('run1', { pool }).step('plan', 'k', fn);
      expect(events).toHaveLength(2);
      // A resumed process replays the completed step from step_result → cache HIT, fn NOT re-run,
      // and crucially NO additional step_event write (the original start/done rows still stand).
      await new GcpEngine('run1', { pool }).step('plan', 'k', fn);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(events).toHaveLength(2); // still just the original start + done — no duplicate
    });

    it('a validate-on-resume cache HIT (valid-shape cached step) ALSO writes NO step_event', async () => {
      const { pool, events } = timingPool();
      const Schema = z.object({ v: z.number() }); // the current contract (cf. LessonBriefSchema)
      const fn = vi.fn(async () => ({ v: 7 }));
      // First run: real step → start + done.
      await new GcpEngine('run1', { pool }).step('brief', 'k', fn, Schema);
      expect(events).toHaveLength(2);
      // Resume WITH the validator: the cached row parses → cache HIT, fn NOT re-run, and — the crux
      // the plan turned on — NO step_event from the *validated*-hit path (not just the un-validated one).
      await new GcpEngine('run1', { pool }).step('brief', 'k', fn, Schema);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(events).toHaveLength(2); // validated cache-hit wrote nothing
    });

    it('an interrupted step re-times via ON CONFLICT on re-run (start again, then done)', async () => {
      const { pool, events } = timingPool();
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('crash mid-step'))
        .mockResolvedValueOnce({ v: 1 });
      const engine = new GcpEngine('run1', { pool });
      await expect(engine.step('code', 'k', fn)).rejects.toThrow('crash mid-step');
      // The failed attempt is timed start → error (the timeline shows which step failed).
      expect(events).toEqual([
        { op: 'start', key: 'run1:code:k', status: 'running' },
        { op: 'finish', key: 'run1:code:k', status: 'error' },
      ]);
      // The retry re-times: a fresh start (ON CONFLICT overwrites the dangling row) then done.
      await engine.step('code', 'k', fn);
      expect(events.slice(2)).toEqual([
        { op: 'start', key: 'run1:code:k', status: 'running' },
        { op: 'finish', key: 'run1:code:k', status: 'done' },
      ]);
    });
  });

  // ── event emission (issue #166): the engine emits step lifecycle to an injected EventSink ──
  describe('event emission', () => {
    const capture = () => {
      const events: WorkflowEvent[] = [];
      return { events, sink: { onEvent: (e: WorkflowEvent) => void events.push(e) } };
    };

    it('emits step.start then step.finish{ms,done} to the injected sink on a real run', async () => {
      const { pool } = fakePool();
      const { events, sink } = capture();
      await new GcpEngine('run1', { pool }, sink).step('code', 'k', async () => ({ v: 1 }));
      expect(events.map((e) => e.eventType)).toEqual(['step.start', 'step.finish']);
      const finish = events[1];
      expect(finish).toMatchObject({ eventType: 'step.finish', stage: 'code', stepKey: 'k', status: 'done' });
      expect(finish?.eventType === 'step.finish' && typeof finish.ms === 'number').toBe(true);
      expect(finish?.eventType === 'step.finish' && finish.ms >= 0).toBe(true);
    });

    it('emits step.finish{error} when the step throws', async () => {
      const { pool } = fakePool();
      const { events, sink } = capture();
      await expect(
        new GcpEngine('run1', { pool }, sink).step('code', 'k', async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect(events.map((e) => e.eventType)).toEqual(['step.start', 'step.finish']);
      expect(events[1]).toMatchObject({ eventType: 'step.finish', status: 'error' });
    });

    it('a cache-hit resume emits NO events (timeline stays non-duplicated)', async () => {
      const { pool } = fakePool();
      const { events, sink } = capture();
      await new GcpEngine('run1', { pool }, sink).step('plan', 'k', async () => ({ v: 1 }));
      events.length = 0;
      await new GcpEngine('run1', { pool }, sink).step('plan', 'k', async () => ({ v: 1 }));
      expect(events).toEqual([]);
    });

    it('a telemetry sink that throws never breaks the paid step', async () => {
      const { pool } = fakePool();
      const sink = {
        onEvent: () => {
          throw new Error('sink boom');
        },
      };
      await expect(new GcpEngine('run1', { pool }, sink).step('plan', 'k', async () => ({ v: 7 }))).resolves.toEqual({
        v: 7,
      });
    });
  });

  // ── validate-on-resume (issue #50): a cached row whose shape no longer parses is a cache MISS ──
  describe('validate-on-resume', () => {
    // The current contract (e.g. the LessonBrief): `goal` is now required.
    const Schema = z.object({ goal: z.string() });

    it('re-runs a stale-shape cached step instead of returning it (cache miss)', async () => {
      const { pool, store } = fakePool();
      // Seed a row from a PRIOR deploy that does NOT match the current Schema (no `goal`).
      store.set('run1:brief:k', { phase: 'analysis' }); // old shape — fails Schema.safeParse
      const fn = vi.fn(async () => ({ goal: 'fresh, current-shape value' }));
      const engine = new GcpEngine('run1', { pool });
      const got = await engine.step('brief', 'k', fn, Schema);
      expect(fn).toHaveBeenCalledTimes(1); // stale row rejected → fn re-run
      expect(got).toEqual({ goal: 'fresh, current-shape value' }); // the fresh result, never the stale row
    });

    it('serves a valid-shape cached step from cache without re-calling fn', async () => {
      const { pool, store } = fakePool();
      store.set('run1:brief:k', { goal: 'a valid cached brief' }); // current shape — parses
      const fn = vi.fn(async () => ({ goal: 'should NOT be called' }));
      const engine = new GcpEngine('run1', { pool });
      const got = await engine.step('brief', 'k', fn, Schema);
      expect(fn).not.toHaveBeenCalled(); // valid cache hit
      expect(got).toEqual({ goal: 'a valid cached brief' });
    });

    it('with NO validator, returns the cached row unchanged (legacy behavior preserved)', async () => {
      const { pool, store } = fakePool();
      store.set('run1:brief:k', { phase: 'analysis' }); // an old shape, but no validator to check it
      const fn = vi.fn(async () => ({ goal: 'unused' }));
      const got = await new GcpEngine('run1', { pool }).step('brief', 'k', fn); // no 4th arg
      expect(fn).not.toHaveBeenCalled(); // returned as-is, never re-run
      expect(got).toEqual({ phase: 'analysis' });
    });
  });
});
