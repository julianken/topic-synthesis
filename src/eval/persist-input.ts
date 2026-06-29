import { STAGE_MODELS, type Stage, type StageModel } from '../llm/models';
import type { TopicRequest } from '../domain/stages';
import type { PipelineRunResult, RunOptions } from '../pipeline/run-pipeline';
import type { PersistRunInput } from '../store/repo';

/**
 * Build the `persistRun` input from a finished run (issue #162). PURE — no I/O — and, deliberately, with
 * NO trace deps: it lives in its OWN module (not `run-skeleton`, which top-level-imports the
 * `@eleatic/eval` trace adapter) so the headless Cloud Run **Job** entry (`run-job.ts`) can reach it
 * WITHOUT pulling `@eleatic/eval` (its `better-sqlite3`/`express` deps) into the compiled job bundle —
 * keeping the job-image boot lean and the import fence honest. `run-skeleton` re-exports this so its
 * own callers + tests are unchanged.
 *
 * The workflow_version snapshot is `STAGE_MODELS` with the run's per-stage overrides merged in; the
 * library-card `category`/`summary` are threaded conditionally so an absent one is OMITTED, not
 * `undefined` (`exactOptionalPropertyTypes`).
 */
export function persistInput(
  runId: string,
  request: TopicRequest,
  run: PipelineRunResult,
  options: RunOptions,
): PersistRunInput {
  const modelSnapshots: Record<Stage, StageModel> = { ...STAGE_MODELS, ...(options.models ?? {}) };
  return {
    runId,
    request,
    result: run.result,
    costUsd: run.costUsd,
    modelSnapshots,
    ...(run.category !== undefined ? { category: run.category } : {}),
    ...(run.summary !== undefined ? { summary: run.summary } : {}),
  };
}
