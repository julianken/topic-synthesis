import type { Pool } from 'pg';
import { getPool } from '../store/db';
import type { Engine } from './engine';

/**
 * Durable Engine: memoizes each (runId, name, key) step in Postgres (`step_result`), so a Cloud
 * Run Job that crashes mid-run RESUMES by reading completed steps back instead of re-running — and
 * re-paying for — them. Within one process it ALSO dedups concurrent in-flight callers (like
 * InlineEngine), so the per-node Promise.all fan-out shares a step; a resolved step stays cached
 * for the process (one DB read per key), a FAILED step is never persisted and is evicted, so a
 * retry re-runs it. One instance per run (constructed with the run's id); the pool is injectable.
 */
export class GcpEngine implements Engine {
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly runId: string,
    private readonly deps: { pool: Pool } = { pool: getPool() },
  ) {}

  step<O>(name: string, key: string, fn: () => Promise<O>): Promise<O> {
    const cacheKey = `${name}:${key}`;
    const existing = this.inflight.get(cacheKey);
    if (existing) return existing as Promise<O>;
    const pending = this.durableStep(name, key, fn);
    this.inflight.set(cacheKey, pending);
    pending.catch(() => this.inflight.delete(cacheKey)); // evict a failure so a retry re-runs
    return pending;
  }

  private async durableStep<O>(name: string, key: string, fn: () => Promise<O>): Promise<O> {
    const found = await this.deps.pool.query<{ result_json: O }>(
      'SELECT result_json FROM step_result WHERE run_id = $1 AND name = $2 AND step_key = $3',
      [this.runId, name, key],
    );
    const row = found.rows[0];
    if (row) return row.result_json; // already done (this run — possibly a prior process); never re-run

    const result = await fn();
    // ON CONFLICT DO NOTHING: if a concurrent process persisted this step first it wins; our
    // (identical, deterministic) result is returned either way. A rejected fn never reaches here.
    await this.deps.pool.query(
      'INSERT INTO step_result (run_id, name, step_key, result_json) VALUES ($1, $2, $3, $4) ON CONFLICT (run_id, name, step_key) DO NOTHING',
      [this.runId, name, key, JSON.stringify(result)],
    );
    return result;
  }
}
