import type { Pool } from 'pg';
import type { ZodType } from 'zod';
import { getPool } from '../store/db';
import { PgStepEventSink } from '../store/pg-step-event-sink';
import type { EventSink, WorkflowEvent } from '../telemetry/events';
import type { Engine } from './engine';

/**
 * Durable Engine: memoizes each (runId, name, key) step in Postgres (`step_result`), so a Cloud
 * Run Job that crashes mid-run RESUMES by reading completed steps back instead of re-running — and
 * re-paying for — them. Within one process it ALSO dedups concurrent in-flight callers (like
 * InlineEngine), so the per-node Promise.all fan-out shares a step; a resolved step stays cached
 * for the process (one DB read per key), a FAILED step is never persisted and is evicted, so a
 * retry re-runs it. One instance per run (constructed with the run's id); the pool is injectable.
 *
 * TIMING + TELEMETRY (issues #61, #166): on a REAL (cache-miss) step the engine emits `step.start`
 * then `step.finish{ms,status}` to an injected `EventSink`. The DEFAULT sink is a `PgStepEventSink`
 * over this run's pool — preserving the #61 behavior exactly (project the lifecycle to `step_event`
 * for the live generating UI). The Job injects `multiSink([stdout, pgStepEvent])` so the same
 * lifecycle ALSO reaches Cloud Logging (issue #166). A cache HIT emits nothing, so a resumed
 * timeline stays complete + non-duplicated. Emission is best-effort: a misbehaving sink can never
 * break a paid step.
 */
export class GcpEngine implements Engine {
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly startedAt = new Map<string, number>();
  private readonly events: EventSink;

  constructor(
    private readonly runId: string,
    private readonly deps: { pool: Pool } = { pool: getPool() },
    eventSink?: EventSink,
  ) {
    this.events = eventSink ?? new PgStepEventSink(runId, { pool: this.deps.pool });
  }

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
      // A cache HIT emits NO lifecycle event — the start/finish emitted when the step first ran (in
      // this run, before the crash) already stand, so the resumed timeline is complete + non-duplicated.
      if (validate === undefined) return row.result_json; // already done; never re-run
      const parsed = validate.safeParse(row.result_json);
      if (parsed.success) return parsed.data;
      // else: stale shape → drop through to re-run (cache miss), do NOT return the stale row.
    }

    // Cache MISS → this step REALLY runs. Time it + emit start (issues #61/#166).
    const cacheKey = `${name}:${key}`;
    this.startedAt.set(cacheKey, Date.now());
    await this.emit({ eventType: 'step.start', stage: name, stepKey: key });
    let result: O;
    try {
      result = await fn();
    } catch (err) {
      // The step threw — emit finish 'error' so the timeline shows WHICH step failed (e.g. a
      // truncating `code` stage), then re-throw so the engine's existing failure handling stands.
      await this.emitFinish(name, key, cacheKey, 'error');
      throw err;
    }
    await this.emitFinish(name, key, cacheKey, 'done');
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

  private async emitFinish(
    name: string,
    key: string,
    cacheKey: string,
    status: 'done' | 'error',
  ): Promise<void> {
    const startedAt = this.startedAt.get(cacheKey);
    const ms = startedAt === undefined ? 0 : Math.max(0, Date.now() - startedAt);
    await this.emit({ eventType: 'step.finish', stage: name, stepKey: key, ms, status });
  }

  /** Best-effort emit: `step_event` is KEPT observability data, not load-bearing — a sink fault
   *  (table not yet migrated, transient DB error, a buggy custom sink) is logged and swallowed so it
   *  can NEVER abort the paid pipeline step or mask its real error. */
  private async emit(event: WorkflowEvent): Promise<void> {
    try {
      await this.events.onEvent(event);
    } catch (err) {
      console.warn('[telemetry] event emit failed (ignored)', this.runId, event.eventType, err);
    }
  }
}
