import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StepEvent } from '../../../../../store/repo';

// Mock the auth gate + the store reads. The route's ready-vs-steps split (issue #61) is the contract
// under test: `ready` ⇐ getCurriculum, `steps` ⇐ ownsRun + getStepEvents — two SEPARATE owner gates.
const getSessionIdentity = vi.hoisted(() => vi.fn());
const getCurriculum = vi.hoisted(() => vi.fn());
const ownsRun = vi.hoisted(() => vi.fn());
const getStepEvents = vi.hoisted(() => vi.fn());
vi.mock('../../../../auth/require-session', () => ({ getSessionIdentity }));
vi.mock('../../../../../store/repo', () => ({ getCurriculum, ownsRun, getStepEvents }));

import { GET } from './route';

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (id: string) => GET(new Request(`https://app.example/api/curriculum/${id}/status`), ctx(id));

const sampleSteps: StepEvent[] = [
  { name: 'plan', stepKey: 'k1', startedAt: '2026-06-21T00:00:00.000Z', finishedAt: '2026-06-21T00:00:03.200Z', status: 'done' },
  { name: 'code', stepKey: 'k2', startedAt: '2026-06-21T00:00:03.200Z', finishedAt: null, status: 'running' },
];

beforeEach(() => {
  getSessionIdentity.mockReset();
  getCurriculum.mockReset().mockResolvedValue(null);
  ownsRun.mockReset().mockResolvedValue(false);
  getStepEvents.mockReset().mockResolvedValue([]);
});

describe('GET /api/curriculum/[id]/status — the live timeline poll (issue #61)', () => {
  it('returns the owner-scoped steps during a run, even while the curriculum is not yet persisted (ready false)', async () => {
    getSessionIdentity.mockResolvedValue({ sub: 'owner-1' });
    // Pre-persist window: getCurriculum is still null (not ready) but the owner can see the timeline.
    getCurriculum.mockResolvedValue(null);
    ownsRun.mockResolvedValue(true);
    getStepEvents.mockResolvedValue(sampleSteps);
    const body = (await (await get('run-1')).json()) as { ready: boolean; steps: StepEvent[] };
    expect(body.ready).toBe(false);
    expect(body.steps).toEqual(sampleSteps);
    expect(getStepEvents).toHaveBeenCalledWith('run-1');
  });

  it('returns [] for a NON-owner (no existence oracle) — ownsRun gates the timeline, getStepEvents never runs', async () => {
    getSessionIdentity.mockResolvedValue({ sub: 'someone-else' });
    ownsRun.mockResolvedValue(false);
    const body = (await (await get('run-1')).json()) as { ready: boolean; steps: StepEvent[] };
    expect(body.ready).toBe(false);
    expect(body.steps).toEqual([]);
    expect(getStepEvents).not.toHaveBeenCalled();
  });

  it('returns [] for an unauthenticated caller (no session → no timeline)', async () => {
    getSessionIdentity.mockResolvedValue(null);
    const body = (await (await get('run-1')).json()) as { ready: boolean; steps: StepEvent[] };
    expect(body.ready).toBe(false);
    expect(body.steps).toEqual([]);
    expect(ownsRun).not.toHaveBeenCalled();
    expect(getStepEvents).not.toHaveBeenCalled();
  });

  it('reports ready (from getCurriculum) AND steps once the run has persisted — the two gates are independent', async () => {
    getSessionIdentity.mockResolvedValue({ sub: 'owner-1' });
    getCurriculum.mockResolvedValue({ id: 'run-1', topic: 't', settings: {}, hub: { tiers: [] } });
    ownsRun.mockResolvedValue(true);
    getStepEvents.mockResolvedValue(sampleSteps);
    const body = (await (await get('run-1')).json()) as { ready: boolean; steps: StepEvent[] };
    expect(body.ready).toBe(true);
    expect(body.steps).toEqual(sampleSteps);
  });
});
