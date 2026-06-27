import { pathToFileURL } from 'node:url';
import type { Level } from '../domain/settings';
import type { TopicRequest } from '../domain/stages';
import { GcpEngine } from '../engine/gcp-engine';
import { cheapModels } from '../llm/models';
import { gradedCritique } from '../pipeline/critic';
import { defaultDeps } from '../pipeline/deps';
import { defaultStages, noopSink, type StageBundle } from '../pipeline/ports';
import { runLesson, type RunOptions } from '../pipeline/run-pipeline';
import { specV11 } from '../pipeline/spec';
import { closePool } from '../store/db';
import { persistRun } from '../store/repo';
import { persistInput } from './run-skeleton';

/**
 * The durable, headless sibling of `run-skeleton` — the Cloud Run **Job** entrypoint. A Job
 * execution passes its inputs as ENV overrides (not argv), runs the pipeline over the durable
 * `GcpEngine`, and `persistRun`s the result. The Service dispatches it; a non-zero exit marks the
 * execution failed so Cloud Run retries it with the SAME `RUN_ID`, where the engine reads completed
 * `step_result` rows back and skips the already-paid work.
 */

const LEVELS: Level[] = ['intro', 'intermediate', 'advanced'];

/**
 * The LIVE-DEFAULT arm the deployed Job runs (TS-15b arm-promotion, issue #107). PROMOTED from the
 * blob-binary arm to the **v11-graded** arm: the SYNTHESIS spec is `specV11` (the sectioned
 * `LessonSpec` emission) and the critic is `gradedCritique` (named learning-efficacy +
 * ledger-conformance sub-scores, `passed` derived against `CRITIC_PASS_THRESHOLD`). The flip is the
 * moment the kill-switch is deliberately disarmed — owner-signed, riding `CRITIC_PASS_THRESHOLD = 0.6`
 * confirmed against REAL v11 emissions (clean 3/3 calibration; the fixture corpus still derives its
 * expected buckets). It is realized through the existing `StageBundle` swap — NOT a new runtime flag —
 * so `defaultStages` (the blob-binary arm) stays REACHABLE: this constant is the ONE-LINE-revertible
 * R10 kill-switch (swap back to `defaultStages` to re-disarm). See docs/plans/lesson-workspace.md
 * (Key decisions §3/§5/§7, R10) + AGENTS.md "Working in the tree".
 */
const LIVE_ARM: StageBundle = { ...defaultStages, spec: specV11, critic: gradedCritique };

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

async function main(): Promise<void> {
  const { runId, request, options } = buildJobInput();
  try {
    // SINGLE-LESSON path (runLesson): plan → research → brief → spec → code → critic → ONE lesson,
    // persisted as a one-page curriculum (no graph/gate/hub). GcpEngine (durable, Postgres-backed) —
    // NOT InlineEngine. persist is unconditional: the curriculum IS the deliverable + the app's
    // status-poll target. noopSink: no trace in the Job. `MAX_NODES` is inert here (the path builds
    // exactly one page) but stays in the env contract (dispatch.ts) so no Terraform change is needed.
    // The live arm is `LIVE_ARM` (the v11-graded arm — TS-15b promotion); swap it back to
    // `defaultStages` to re-arm the blob-binary kill-switch.
    const run = await runLesson(request, new GcpEngine(runId), defaultDeps, options, LIVE_ARM, noopSink);
    // The owning user's sub — set by the Service as the RUN_OWNER override at gated dispatch (the Job
    // has no session to re-verify; it trusts the override, which is set only AFTER the spend gate). §5.
    const base = persistInput(runId, request, run, options);
    const ownerSub = process.env.RUN_OWNER?.trim();
    const { curriculumId } = await persistRun(ownerSub ? { ...base, ownerSub } : base);
    console.log(
      JSON.stringify({ event: 'run-complete', curriculumId, costUsd: run.costUsd, pages: run.result.pages.length }),
    );
  } finally {
    await closePool();
  }
}

// Run only when invoked directly (the Job's `tsx src/eval/run-job.ts`), never when imported by a test.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exit(1); // non-zero → Cloud Run marks the execution failed → retry resumes on the same RUN_ID
  });
}
