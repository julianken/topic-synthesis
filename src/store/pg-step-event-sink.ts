/**
 * The `EventSink` adapter that projects step lifecycle events to the `step_event` table — the live
 * generating-UI timeline (issue #61). This is the SQL that used to live inline in `GcpEngine`
 * (`markStepStarted`/`markStepFinished`); moving it behind the event seam (issue #166) unifies the
 * engine's two emission paths so the live UI and Cloud Logging are fed from one stream. It projects
 * only `step.*` events and ignores the rest (`llm.call`, `run.*` have no `step_event` projection).
 *
 * Best-effort, exactly as before: `step_event` is KEPT observability data, not load-bearing, so a
 * write fault (the table not yet migrated during a deploy, or a transient DB error) is logged and
 * swallowed — it must never abort the paid pipeline step or mask its real error.
 */
import type { Pool } from 'pg';
import type { EventSink, WorkflowEvent } from '../telemetry/events';

export class PgStepEventSink implements EventSink {
  constructor(
    private readonly runId: string,
    private readonly deps: { pool: Pool },
  ) {}

  async onEvent(event: WorkflowEvent): Promise<void> {
    if (event.eventType === 'step.start') {
      await this.start(event.stage, event.stepKey);
    } else if (event.eventType === 'step.finish') {
      await this.finish(event.stage, event.stepKey, event.status);
    }
    // other event types have no step_event projection — intentionally ignored.
  }

  /**
   * Stamp a step's START. ON CONFLICT resets started_at + clears finished_at so a crash-mid-step's
   * dangling 'running' row (or a stale-shape re-run) is re-timed from now, not left showing the
   * abandoned attempt's clock.
   */
  private async start(name: string, key: string): Promise<void> {
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

  /** Stamp a step's END: 'done' on success, 'error' on a thrown stage — the timeline shows which failed. */
  private async finish(name: string, key: string, status: 'done' | 'error'): Promise<void> {
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
