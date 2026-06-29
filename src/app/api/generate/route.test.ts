import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the auth gate, the dispatcher, and the store writes (recordRunOwner stamps ownership at
// dispatch — mock it so the test needs no DB); isSameOrigin (from ../../auth/session) runs for real,
// and the in-process startRun path (runPipeline/persistRun) is never reached because dispatch is on.
const getSessionIdentity = vi.hoisted(() => vi.fn());
const dispatchJob = vi.hoisted(() => vi.fn());
const recordRunOwner = vi.hoisted(() => vi.fn());
const recordDispatch = vi.hoisted(() => vi.fn());
vi.mock('../../auth/require-session', () => ({ getSessionIdentity }));
vi.mock('./dispatch', () => ({ dispatchJob, isJobDispatchEnabled: () => true }));
vi.mock('../../../store/repo', () => ({ recordRunOwner, recordDispatch, persistRun: vi.fn() }));

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
  dispatchJob.mockResolvedValue(undefined);
  recordRunOwner.mockReset();
  recordRunOwner.mockResolvedValue(undefined);
  recordDispatch.mockReset();
  recordDispatch.mockResolvedValue(undefined);
});

describe('POST /api/generate — the spend gate (ADR 0002 §5)', () => {
  it('401s WITHOUT spending when there is no session — dispatch is never called', async () => {
    getSessionIdentity.mockResolvedValue(null);
    const res = await POST(req({ topic: 'Fourier transforms' }));
    expect(res.status).toBe(401);
    expect(dispatchJob).not.toHaveBeenCalled();
  });

  it('forces a revocation-checked session read on the spend path', async () => {
    getSessionIdentity.mockResolvedValue(null);
    await POST(req({ topic: 'x' }));
    expect(getSessionIdentity).toHaveBeenCalledWith({ checkRevoked: true });
  });

  it('dispatches with the owner sub threaded when the session is valid', async () => {
    getSessionIdentity.mockResolvedValue({ sub: 'owner-1', email: 'o@e.com', emailVerified: true });
    const res = await POST(req({ topic: 'Fourier transforms' }));
    expect(res.status).toBe(202);
    expect(dispatchJob).toHaveBeenCalledTimes(1);
    expect(dispatchJob.mock.calls[0]![2]).toBe('owner-1'); // RUN_OWNER thread
  });

  it('writes a best-effort dispatch marker on the spend path (issue #162 A1)', async () => {
    getSessionIdentity.mockResolvedValue({ sub: 'owner-1', email: 'o@e.com', emailVerified: true });
    const res = await POST(req({ topic: 'Fourier transforms' }));
    expect(res.status).toBe(202);
    expect(recordDispatch).toHaveBeenCalledTimes(1);
    expect(recordDispatch.mock.calls[0]![0]).toBe((await res.json()).id); // marker keyed on the runId
  });

  it('A2: a FAILED marker write does NOT fail the dispatch (best-effort) — still dispatches + 202s', async () => {
    getSessionIdentity.mockResolvedValue({ sub: 'owner-1', email: 'o@e.com', emailVerified: true });
    recordDispatch.mockRejectedValue(new Error('step_event write blew up'));
    const res = await POST(req({ topic: 'Fourier transforms' }));
    // The injected marker failure is swallowed: the run still dispatches and the route still 202s.
    expect(res.status).toBe(202);
    expect(dispatchJob).toHaveBeenCalledTimes(1);
  });

  it('rejects a cross-origin POST even with a valid session (CSRF)', async () => {
    getSessionIdentity.mockResolvedValue({ sub: 'owner-1', email: 'o@e.com', emailVerified: true });
    const bad = new Request('https://app.example/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ topic: 'x' }),
    });
    const res = await POST(bad);
    expect(res.status).toBe(403);
    expect(dispatchJob).not.toHaveBeenCalled();
  });
});
