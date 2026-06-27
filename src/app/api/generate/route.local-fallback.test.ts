import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The LOCAL-DEV in-process fallback: with dispatch DISABLED (`PIPELINE_JOB_NAME` unset →
// isJobDispatchEnabled() === false), POST runs the pipeline in-process via runLesson and persists it.
// This pins that the fallback uses the SHARED cheap profile (Haiku analysis, Sonnet synthesis) — the
// same tier as the deployed Job — so `npm run dev` builds a full page instead of truncating to 'soon'.
const getSessionIdentity = vi.hoisted(() => vi.fn());
const dispatchJob = vi.hoisted(() => vi.fn());
const recordRunOwner = vi.hoisted(() => vi.fn());
const persistRun = vi.hoisted(() => vi.fn());
const runLesson = vi.hoisted(() => vi.fn());

vi.mock('../../auth/require-session', () => ({ getSessionIdentity }));
// Dispatch DISABLED — the in-process startRun path runs.
vi.mock('./dispatch', () => ({ dispatchJob, isJobDispatchEnabled: () => false }));
vi.mock('../../../store/repo', () => ({ recordRunOwner, persistRun }));
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
  persistRun.mockReset();
  persistRun.mockResolvedValue({ curriculumId: 'c1' });
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

// ── TS-15b: the local-dev fallback runs the SAME promoted arm the deployed Job runs ───────────────
// The deployed Job's flip is source-pinned in run-job.test.ts:227; this is the mirror pin for the
// local-dev twin so the two live-default sites can't drift. The runtime test above mocks runLesson,
// so the arm value never reaches the mock — pinning it on the SOURCE catches a future un-flip back to
// the blob kill-switch (`defaultStages`) on the local path (TS-15b/#107).
describe('TS-15b — the local-dev fallback flips to LIVE_ARM (mirrors run-job.test.ts:227)', () => {
  const SOURCE = readFileSync(fileURLToPath(new URL('./route.ts', import.meta.url)), 'utf8');

  it('constructs LIVE_ARM = { ...defaultStages, spec: specV11, critic: gradedCritique }', () => {
    // Same v11-graded composition as the Job: sectioned specV11 synthesis + the gradedCritique
    // named-sub-score critic, swapped over the RETAINED `defaultStages` blob kill-switch.
    expect(SOURCE).toMatch(
      /LIVE_ARM\s*:\s*StageBundle\s*=\s*\{\s*\.\.\.defaultStages\s*,\s*spec\s*:\s*specV11\s*,\s*critic\s*:\s*gradedCritique\s*\}/,
    );
  });

  it('passes LIVE_ARM (not defaultStages) into the runLesson(...) call — guards the flip', () => {
    // The trailing StageBundle arg of runLesson(...) is LIVE_ARM. An un-flip to defaultStages would
    // silently re-arm the kill-switch on the local path; the regex makes that a failing test.
    expect(SOURCE).toMatch(/runLesson\(.*?,\s*LIVE_ARM\s*\)/s);
  });
});
