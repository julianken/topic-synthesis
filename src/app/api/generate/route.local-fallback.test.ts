import { beforeEach, describe, expect, it, vi } from 'vitest';

// The LOCAL-DEV in-process fallback: with dispatch DISABLED (`PIPELINE_JOB_NAME` unset →
// isJobDispatchEnabled() === false), POST runs the pipeline in-process via runLesson and persists it.
// This pins that the fallback uses the SHARED cheap profile (Haiku analysis, Sonnet synthesis) — the
// same tier as the deployed Job — so `npm run dev` builds a full page instead of truncating to 'soon'.
const getSessionIdentity = vi.hoisted(() => vi.fn());
const dispatchJob = vi.hoisted(() => vi.fn());
const recordRunOwner = vi.hoisted(() => vi.fn());
const recordDispatch = vi.hoisted(() => vi.fn());
const persistRun = vi.hoisted(() => vi.fn());
const runLesson = vi.hoisted(() => vi.fn());

vi.mock('../../auth/require-session', () => ({ getSessionIdentity }));
// Dispatch DISABLED — the in-process startRun path runs.
vi.mock('./dispatch', () => ({ dispatchJob, isJobDispatchEnabled: () => false }));
vi.mock('../../../store/repo', () => ({ recordRunOwner, recordDispatch, persistRun }));
vi.mock('../../../pipeline/run-pipeline', () => ({ runLesson }));

import { POST } from './route';

function req(body: unknown): Request {
  return new Request('https://app.example/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://app.example', 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  getSessionIdentity.mockReset();
  dispatchJob.mockReset();
  recordRunOwner.mockReset();
  recordRunOwner.mockResolvedValue(undefined);
  recordDispatch.mockReset();
  recordDispatch.mockResolvedValue(undefined);
  persistRun.mockReset();
  persistRun.mockResolvedValue({ lessonId: 'c1' });
  runLesson.mockReset();
  runLesson.mockResolvedValue({ result: { hub: { tiers: [] }, pages: [] }, records: [], costUsd: 0 });
});

describe('POST /api/generate — local-dev in-process fallback (dispatch disabled)', () => {
  it('runs in-process (never dispatches) and persists the cheap profile with synthesis on Sonnet', async () => {
    getSessionIdentity.mockResolvedValue({ sub: 'owner-1', email: 'o@e.com', emailVerified: true });
    const res = await POST(req({ topic: 'Fourier transforms' }));
    expect(res.status).toBe(202);
    expect(dispatchJob).not.toHaveBeenCalled(); // local path, not the Job

    // The fire-and-forget run resolves on a microtask; flush so persistRun has been called.
    await vi.waitFor(() => expect(persistRun).toHaveBeenCalledTimes(1));

    // runLesson got the cheap profile: ANALYSIS on Haiku, SYNTHESIS on Sonnet.
    const options = runLesson.mock.calls[0]![3] as { models: Record<string, { model: string } | undefined> };
    expect(options.models.planner?.model).toBe('claude-haiku-4-5'); // analysis → Haiku
    expect(options.models.brief?.model).toBe('claude-haiku-4-5');
    expect(options.models.spec?.model).toBe('claude-sonnet-4-6'); // synthesis → Sonnet
    expect(options.models.code?.model).toBe('claude-sonnet-4-6');
    expect(options.models.critic?.model).toBe('claude-sonnet-4-6');

    // The persisted modelSnapshots carry the same synthesis-on-Sonnet tier.
    const snap = persistRun.mock.calls[0]![0] as {
      modelSnapshots: Record<string, { model: string } | undefined>;
      ownerSub: string;
    };
    expect(snap.modelSnapshots.code?.model).toBe('claude-sonnet-4-6');
    expect(snap.modelSnapshots.planner?.model).toBe('claude-haiku-4-5');
    expect(snap.ownerSub).toBe('owner-1');
  });
});
