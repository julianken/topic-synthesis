import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { GcpEngine } from './gcp-engine';

/** In-memory fake pool: SELECT reads the store; INSERT writes it (ON CONFLICT DO NOTHING). */
function fakePool() {
  const store = new Map<string, unknown>();
  const query = vi.fn(async (sql: string, params: unknown[]) => {
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
});
