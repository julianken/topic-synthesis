import { pathToFileURL } from 'node:url';
import type { Level } from '../domain/settings';
import type { TopicRequest } from '../domain/stages';
import { GcpEngine } from '../engine/gcp-engine';
import { cheapModels } from '../llm/models';
import { defaultDeps } from '../pipeline/deps';
import { defaultStages } from '../pipeline/ports';
import { runLesson, type PipelineRunResult, type RunOptions } from '../pipeline/run-pipeline';
import { PgStepEventSink } from '../store/pg-step-event-sink';
import { closePool, getPool } from '../store/db';
import { PgResearchSink, persistRun } from '../store/repo';
import { multiSink, type WorkflowEvent } from '../telemetry/events';
import { SpanToEventSink } from '../telemetry/span-event-bridge';
import { StdoutEventSink } from '../telemetry/stdout-sink';
import { persistInput } from './persist-input';

/**
 * The durable, headless sibling of `run-skeleton` — the Cloud Run **Job** entrypoint. A Job
 * execution passes its inputs as ENV overrides (not argv), runs the pipeline over the durable
 * `GcpEngine`, and `persistRun`s the result. The Service dispatches it; a non-zero exit marks the
 * execution failed so Cloud Run retries it with the SAME `RUN_ID`, where the engine reads completed
 * `step_result` rows back and skips the already-paid work.
 *
 * TELEMETRY (issue #166): one shared `StdoutEventSink` per run is the structured-log stream Cloud
 * Logging captures (→ #167's log-based metrics + dashboard). The engine emits step lifecycle to
 * `multiSink([stdout, pgStepEvent])` (Cloud Logging + the live-UI `step_event` table); the
 * `SpanToEventSink` turns the existing per-call trace hook into `llm.call` events; and run-job emits
 * the run-level `run.complete` / `run.failed`. Sharing the one stdout instance keeps `seq` monotonic.
 */

const LEVELS: Level[] = ['intro', 'intermediate', 'advanced'];

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') throw new Error(`${name} env var is required`);
  return value.trim();
}

/** Optional positive-int env; THROWS on present-but-invalid so a typo can't silently cap to 0 after spend. */
function optionalPositiveInt(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a positive integer`);
  return n;
}

/** Parse the Job's env into a runId + request + options. `RUN_ID` is an INPUT — never generated,
 *  so a crash-resume retry reuses it and the engine skips completed steps. */
export function buildJobInput(): { runId: string; request: TopicRequest; options: RunOptions } {
  const runId = required('RUN_ID');
  const topic = required('TOPIC');
  const level = process.env.LEVEL ?? 'intermediate';
  if (!LEVELS.includes(level as Level)) throw new Error(`LEVEL must be one of: ${LEVELS.join(', ')}`);
  const depth = Number(process.env.DEPTH ?? '3');
  const audience = process.env.AUDIENCE ?? 'a self-taught learner';

  const options: RunOptions = {};
  const maxNodes = optionalPositiveInt('MAX_NODES');
  if (maxNodes !== undefined) options.maxNodes = maxNodes;
  const maxQuestions = optionalPositiveInt('MAX_QUESTIONS');
  if (maxQuestions !== undefined) options.maxQuestions = maxQuestions;
  if (process.env.CHEAP === '1' || process.env.CHEAP === 'true') options.models = cheapModels();

  return { runId, request: { topic, settings: { level: level as Level, depth, audience } }, options };
}

/**
 * The run-level completion event. `outcome`/`criticPassed` are derived from the run's HUB page
 * `built`/`status` (always present even on a degrade), NOT from `run.result.pages.length` — that list
 * is `[]` when synthesis degraded to 'soon', which would mislabel a degraded run as complete.
 */
export function runCompleteEvent(
  run: PipelineRunResult,
  totalMs: number,
): Extract<WorkflowEvent, { eventType: 'run.complete' }> {
  const built = run.result.hub.tiers[0]?.categories[0]?.pages[0]?.built ?? false;
  return {
    eventType: 'run.complete',
    costUsd: run.costUsd,
    totalMs,
    pages: run.result.pages.length,
    outcome: built ? 'complete' : 'degraded',
    criticPassed: built,
  };
}

/** The run-level failure event (a thrown run that never reached `run.complete`). */
export function runFailedEvent(err: unknown): Extract<WorkflowEvent, { eventType: 'run.failed' }> {
  return { eventType: 'run.failed', outcome: 'failed', errorKind: err instanceof Error ? err.name : 'unknown' };
}

async function main(): Promise<void> {
  const { runId, request, options } = buildJobInput();
  const pool = getPool();
  // ONE shared stdout sink per run → a monotonic `seq` across engine lifecycle + llm.call + run.*.
  const stdout = new StdoutEventSink(runId);
  const startedAtMs = Date.now();
  try {
    // SINGLE-LESSON path (runLesson): plan → research → brief → spec → code → critic → ONE lesson,
    // persisted as a one-page curriculum (no graph/gate/hub). GcpEngine (durable, Postgres-backed).
    // PgResearchSink (live-research generating Stage 1): fire-and-forget research feed → research_event.
    const researchSink = new PgResearchSink(runId, { pool });
    // The engine emits step lifecycle to BOTH Cloud Logging (stdout) and the live-UI step_event table.
    const engine = new GcpEngine(runId, { pool }, multiSink([stdout, new PgStepEventSink(runId, { pool })]));
    // SpanToEventSink turns the existing per-LLM-call trace hook into `llm.call` events (cost/model/phase),
    // replacing the old `noopSink` arg — zero signature churn in run-pipeline.
    const run = await runLesson(
      request,
      engine,
      defaultDeps,
      options,
      defaultStages,
      new SpanToEventSink(stdout),
      researchSink,
    );
    // The owning user's sub — set by the Service as the RUN_OWNER override at gated dispatch (the Job
    // has no session to re-verify; it trusts the override, which is set only AFTER the spend gate). §5.
    const base = persistInput(runId, request, run, options);
    const ownerSub = process.env.RUN_OWNER?.trim();
    await persistRun(ownerSub ? { ...base, ownerSub } : base);
    stdout.onEvent(runCompleteEvent(run, Date.now() - startedAtMs));
  } catch (err) {
    stdout.onEvent(runFailedEvent(err));
    throw err;
  } finally {
    await closePool();
  }
}

// Run only when invoked directly (the Job's `node dist/job/run-job.js`), never when imported by a test.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exit(1); // non-zero → Cloud Run marks the execution failed → retry resumes on the same RUN_ID
  });
}
