import { beforeEach, describe, expect, it, vi } from 'vitest';

// hoisted so the (hoisted) vi.mock factory can close over it; a class so `new JobsClient()` works.
const runJob = vi.hoisted(() => vi.fn());
vi.mock('@google-cloud/run', () => ({
  JobsClient: class {
    runJob = runJob;
  },
}));

import { dispatchJob, isJobDispatchEnabled, overrideEnv } from './dispatch';

const request = {
  topic: 'Fourier transforms',
  settings: { level: 'advanced' as const, depth: 4, audience: 'devs' },
};

beforeEach(() => {
  for (const k of ['PIPELINE_JOB_NAME', 'GCP_PROJECT', 'PIPELINE_REGION']) delete process.env[k];
  runJob.mockReset();
  runJob.mockResolvedValue([{}]);
});

describe('overrideEnv', () => {
  it('maps the run inputs to container env (RUN_ID + topic + settings + cheap caps)', () => {
    const byName = Object.fromEntries(overrideEnv('r1', request).map((e) => [e.name, e.value]));
    expect(byName).toMatchObject({
      RUN_ID: 'r1',
      TOPIC: 'Fourier transforms',
      LEVEL: 'advanced',
      DEPTH: '4',
      AUDIENCE: 'devs',
      CHEAP: '1',
      MAX_NODES: '4',
      MAX_QUESTIONS: '4',
    });
  });
});

describe('isJobDispatchEnabled', () => {
  it('is gated on PIPELINE_JOB_NAME (off for local dev → in-process fallback)', () => {
    expect(isJobDispatchEnabled()).toBe(false);
    process.env.PIPELINE_JOB_NAME = 'topic-synthesis-pipeline';
    expect(isJobDispatchEnabled()).toBe(true);
  });
});

describe('dispatchJob', () => {
  it('runs the Job by full resource name with the inputs as container-override env', async () => {
    Object.assign(process.env, { GCP_PROJECT: 'p', PIPELINE_REGION: 'us-central1', PIPELINE_JOB_NAME: 'j' });
    await dispatchJob('r1', request);
    expect(runJob).toHaveBeenCalledTimes(1);
    const arg = runJob.mock.calls[0]![0] as {
      name: string;
      overrides: { containerOverrides: { env: { name: string; value: string }[] }[] };
    };
    expect(arg.name).toBe('projects/p/locations/us-central1/jobs/j');
    expect(arg.overrides.containerOverrides[0]!.env.find((e) => e.name === 'RUN_ID')?.value).toBe('r1');
  });

  it('throws when the dispatch env (GCP_PROJECT / PIPELINE_REGION / PIPELINE_JOB_NAME) is missing', async () => {
    await expect(dispatchJob('r1', request)).rejects.toThrow(/required/);
  });
});
