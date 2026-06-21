import { JobsClient } from '@google-cloud/run';
import type { TopicRequest } from '../../../domain/stages';

// Cheap + capped, matching the in-process fallback — a click stays ~pennies.
const APP_RUN_ENV: ReadonlyArray<{ name: string; value: string }> = [
  { name: 'CHEAP', value: '1' },
  { name: 'MAX_NODES', value: '4' },
  { name: 'MAX_QUESTIONS', value: '4' },
];

/** True when the Service is configured to dispatch the Cloud Run Job (vs run in-process locally). */
export function isJobDispatchEnabled(): boolean {
  return Boolean(process.env.PIPELINE_JOB_NAME);
}

/** The per-run container env overrides for a Job execution (pure + testable). `RUN_ID` is the
 *  curriculum id the app polls; the Job reads these instead of argv. */
export function overrideEnv(
  runId: string,
  request: TopicRequest,
  ownerSub: string,
): { name: string; value: string }[] {
  return [
    { name: 'RUN_ID', value: runId },
    { name: 'TOPIC', value: request.topic },
    { name: 'LEVEL', value: request.settings.level },
    { name: 'DEPTH', value: String(request.settings.depth) },
    { name: 'AUDIENCE', value: request.settings.audience },
    { name: 'RUN_OWNER', value: ownerSub }, // the gated owner's verified sub → run-job persists owner_sub
    ...APP_RUN_ENV,
  ];
}

let client: JobsClient | undefined;
function jobsClient(): JobsClient {
  return (client ??= new JobsClient());
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} env var is required for Cloud Run Job dispatch`);
  return value;
}

/**
 * Dispatch a Cloud Run Job execution for one run, passing its inputs as ENV overrides (the
 * runtime SA needs `run.jobs.runWithOverrides`). Awaits the dispatch's acceptance — NOT the Job's
 * completion (the execution runs async; the app polls the curriculum status). ADC auth = the
 * runtime SA on Cloud Run.
 */
export async function dispatchJob(runId: string, request: TopicRequest, ownerSub: string): Promise<void> {
  const name = `projects/${requireEnv('GCP_PROJECT')}/locations/${requireEnv('PIPELINE_REGION')}/jobs/${requireEnv('PIPELINE_JOB_NAME')}`;
  await jobsClient().runJob({
    name,
    overrides: { containerOverrides: [{ env: overrideEnv(runId, request, ownerSub) }] },
  });
}
