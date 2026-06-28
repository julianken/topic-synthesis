import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResearchEvent, StepEvent } from '../../../../../store/repo';

// Mock the auth gate + the store reads. The route's ready-vs-steps-vs-research split (issue #61 +
// live-research generating Stage 1) is the contract under test: `ready` ⇐ getCurriculum, `steps` ⇐
// ownsRun + getStepEvents, `research` ⇐ the SAME ownsRun + getResearchEvents — TWO owner gates total
// (`ownsRun` computed once, reused for both steps + research).
const getSessionIdentity = vi.hoisted(() => vi.fn());
const getCurriculum = vi.hoisted(() => vi.fn());
const ownsRun = vi.hoisted(() => vi.fn());
const getStepEvents = vi.hoisted(() => vi.fn());
const getResearchEvents = vi.hoisted(() => vi.fn());
vi.mock('../../../../auth/require-session', () => ({ getSessionIdentity }));
vi.mock('../../../../../store/repo', () => ({ getCurriculum, ownsRun, getStepEvents, getResearchEvents }));

import { GET } from './route';

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (id: string) => GET(new Request(`https://app.example/api/curriculum/${id}/status`), ctx(id));

const sampleSteps: StepEvent[] = [
  { name: 'plan', stepKey: 'k1', startedAt: '2026-06-21T00:00:00.000Z', finishedAt: '2026-06-21T00:00:03.200Z', status: 'done' },
  { name: 'code', stepKey: 'k2', startedAt: '2026-06-21T00:00:03.200Z', finishedAt: null, status: 'running' },
];

const sampleResearch: ResearchEvent[] = [
  {
    question: 'What is photosynthesis?',
    subtopic: 'Overview',
    status: 'done',
    findings: [{ claim: 'Plants convert light to energy', url: 'https://x.example', title: 'X' }],
    sources: [{ url: 'https://x.example', title: 'X' }],
    findingCount: 1,
    startedAt: '2026-06-21T00:00:00.000Z',
    finishedAt: '2026-06-21T00:00:04.000Z',
  },
  {
    question: 'How do chloroplasts work?',
    subtopic: null,
    status: 'pending',
    findings: [],
    sources: [],
    findingCount: null,
    startedAt: '2026-06-21T00:00:00.500Z',
    finishedAt: null,
  },
];

type Body = { ready: boolean; steps: StepEvent[]; research: ResearchEvent[] };

beforeEach(() => {
  getSessionIdentity.mockReset();
  getCurriculum.mockReset().mockResolvedValue(null);
  ownsRun.mockReset().mockResolvedValue(false);
  getStepEvents.mockReset().mockResolvedValue([]);
  getResearchEvents.mockReset().mockResolvedValue([]);
});

describe('GET /api/curriculum/[id]/status — the live timeline + research poll (issue #61 + live-research Stage 1)', () => {
  it('returns the owner-scoped steps AND research during a run, even while the curriculum is not yet persisted (ready false)', async () => {
    getSessionIdentity.mockResolvedValue({ sub: 'owner-1' });
    // Pre-persist window: getCurriculum is still null (not ready) but the owner sees the timeline + research feed.
    getCurriculum.mockResolvedValue(null);
    ownsRun.mockResolvedValue(true);
    getStepEvents.mockResolvedValue(sampleSteps);
    getResearchEvents.mockResolvedValue(sampleResearch);
    const body = (await (await get('run-1')).json()) as Body;
    expect(body.ready).toBe(false);
    expect(body.steps).toEqual(sampleSteps);
    expect(body.research).toEqual(sampleResearch);
    expect(getStepEvents).toHaveBeenCalledWith('run-1');
    expect(getResearchEvents).toHaveBeenCalledWith('run-1');
    // ownsRun computed ONCE and reused for both reads (not called twice).
    expect(ownsRun).toHaveBeenCalledTimes(1);
  });

  it('returns [] for steps AND research for a NON-owner (no existence oracle) — neither reader runs', async () => {
    getSessionIdentity.mockResolvedValue({ sub: 'someone-else' });
    ownsRun.mockResolvedValue(false);
    const body = (await (await get('run-1')).json()) as Body;
    expect(body.ready).toBe(false);
    expect(body.steps).toEqual([]);
    expect(body.research).toEqual([]);
    expect(getStepEvents).not.toHaveBeenCalled();
    expect(getResearchEvents).not.toHaveBeenCalled();
  });

  it('returns [] for steps AND research for an unauthenticated caller (no session → no feed)', async () => {
    getSessionIdentity.mockResolvedValue(null);
    const body = (await (await get('run-1')).json()) as Body;
    expect(body.ready).toBe(false);
    expect(body.steps).toEqual([]);
    expect(body.research).toEqual([]);
    expect(ownsRun).not.toHaveBeenCalled();
    expect(getStepEvents).not.toHaveBeenCalled();
    expect(getResearchEvents).not.toHaveBeenCalled();
  });

  it('reports ready (from getCurriculum) AND steps AND research once the run has persisted — the gates are independent', async () => {
    getSessionIdentity.mockResolvedValue({ sub: 'owner-1' });
    getCurriculum.mockResolvedValue({ id: 'run-1', topic: 't', settings: {}, hub: { tiers: [] } });
    ownsRun.mockResolvedValue(true);
    getStepEvents.mockResolvedValue(sampleSteps);
    getResearchEvents.mockResolvedValue(sampleResearch);
    const body = (await (await get('run-1')).json()) as Body;
    expect(body.ready).toBe(true);
    expect(body.steps).toEqual(sampleSteps);
    expect(body.research).toEqual(sampleResearch);
  });
});
