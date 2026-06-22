import type { Pool } from 'pg';
import type { ZodType } from 'zod';
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

  step<O>(name: string, key: string, fn: () => Promise<O>, validate?: ZodType<O>): Promise<O> {
    const cacheKey = `${name}:${key}`;
    const existing = this.inflight.get(cacheKey);
    if (existing) return existing as Promise<O>;
    const pending = this.durableStep(name, key, fn, validate);
    this.inflight.set(cacheKey, pending);
    pending.catch(() => this.inflight.delete(cacheKey)); // evict a failure so a retry re-runs
    return pending;
  }

  private async durableStep<O>(
    name: string,
    key: string,
    fn: () => Promise<O>,
    validate?: ZodType<O>,
  ): Promise<O> {
    const found = await this.deps.pool.query<{ result_json: O }>(
      'SELECT result_json FROM step_result WHERE run_id = $1 AND name = $2 AND step_key = $3',
      [this.runId, name, key],
    );
    const row = found.rows[0];
    if (row) {
      // Validate-on-resume: when a per-step schema is supplied, a cached row is served only if it
      // still PARSES against the CURRENT shape. A parse failure (e.g. an old-shape LessonBrief after
      // a mid-run deploy changed the contract) is treated as a cache MISS — fall through to re-run +
      // re-persist below — so a stale shape can never feed a later stage. With no validator, the row
      // is returned as-is (legacy behavior). A successful parse returns the parsed (current-shape) value.
      //
      // TIMING (issue #61): a cache HIT writes NO step_event — the row written when the step first
      // ran (in this run, before the crash) already stands, so the resumed timeline is complete AND
      // non-duplicated. Only a real run (the miss below) touches step_event.
      if (validate === undefined) return row.result_json; // already done; never re-run
      const parsed = validate.safeParse(row.result_json);
      if (parsed.success) return parsed.data;
      // else: stale shape → drop through to re-run (cache miss), do NOT return the stale row.
    }

    // Cache MISS → this step REALLY runs. Stamp its start (issue #61). ON CONFLICT overwrites a
    // dangling row left by a crash mid-step that is now re-running (and re-times a stale-shape re-run).
    await this.markStepStarted(name, key);
    let result: O;
    try {
      result = await fn();
    } catch (err) {
      // The step threw — record it as failed so the timeline shows WHICH step failed (e.g. a
      // truncating `code` stage), then re-throw so the engine's existing failure handling stands.
      await this.markStepFinished(name, key, 'error');
      throw err;
    }
    await this.markStepFinished(name, key, 'done');
    // ON CONFLICT DO NOTHING: if a concurrent process persisted this step first it wins; our
    // (identical, deterministic) result is returned either way. A rejected fn never reaches here.
    // On a validate-on-resume miss the OLD stale row remains (DO NOTHING won't overwrite it), so a
    // later resume re-runs again — correct, never stale: we always return the freshly-computed,
    // current-shape `result` here, never the stale row. (A schema change mid-run is rare; healing the
    // stored row would change the documented concurrent-write semantics, so it's intentionally left.)
    await this.deps.pool.query(
      'INSERT INTO step_result (run_id, name, step_key, result_json) VALUES ($1, $2, $3, $4) ON CONFLICT (run_id, name, step_key) DO NOTHING',
      [this.runId, name, key, JSON.stringify(result)],
    );
    return result;
  }

  /**
   * Stamp a real step's START (issue #61). ON CONFLICT resets started_at + clears finished_at so a
   * crash-mid-step's dangling 'running' row (or a stale-shape re-run) is re-timed from now, not
   * left showing the abandoned attempt's clock.
   */
  private async markStepStarted(name: string, key: string): Promise<void> {
    // Best-effort: step_event is KEPT observability data, not load-bearing. A timing-write failure
    // (the table not yet migrated during a deploy window, or a transient DB error) must NEVER abort
    // the paid pipeline step or mask its real error — log and continue.
    try {
      await this.deps.pool.query(
        `INSERT INTO step_event (run_id, name, step_key, started_at, status)
         VALUES ($1, $2, $3, now(), 'running')
         ON CONFLICT (run_id, name, step_key)
         DO UPDATE SET started_at = now(), finished_at = NULL, status = 'running'`,
        [this.runId, name, key],
      );
    } catch (err) {
      console.warn('[timing] step_event start write failed (ignored)', this.runId, name, err);
    }
  }

  /** Stamp a step's END (issue #61): 'done' on success, 'error' on a thrown fn — the timeline shows it.
   *  Best-effort, like markStepStarted: a timing-write failure never breaks the run. */
  private async markStepFinished(name: string, key: string, status: 'done' | 'error'): Promise<void> {
    try {
      await this.deps.pool.query(
        `UPDATE step_event SET finished_at = now(), status = $4
         WHERE run_id = $1 AND name = $2 AND step_key = $3`,
        [this.runId, name, key, status],
      );
    } catch (err) {
      console.warn('[timing] step_event finish write failed (ignored)', this.runId, name, err);
    }
  }
}
