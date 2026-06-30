import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the auth gate + the store write. `isSameOrigin` (from ../../../auth/session) runs for real,
// driven by the request headers. The route's contract under test: CSRF → revocation-checked session →
// `softDelete([id], sub)` → `{ deleted }` = the RETURNING reconcile (#199). softDelete's owner-scope is
// unit-tested in the store layer (#198); here we assert the route never derives the owner from the request.
const getSessionIdentity = vi.hoisted(() => vi.fn());
const softDelete = vi.hoisted(() => vi.fn());
vi.mock('../../../auth/require-session', () => ({ getSessionIdentity }));
vi.mock('../../../../store/repo', () => ({ softDelete }));

import { DELETE, dynamic, runtime } from './route';

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function del(id: string, opts?: { crossOrigin?: boolean }): Promise<Response> {
  const headers: Record<string, string> = opts?.crossOrigin
    ? { origin: 'https://evil.example' } // no sec-fetch-site → falls through to the host-mismatch reject
    : { origin: 'https://app.example', 'sec-fetch-site': 'same-origin' };
  return DELETE(new Request(`https://app.example/api/lesson/${id}`, { method: 'DELETE', headers }), ctx(id));
}

beforeEach(() => {
  getSessionIdentity.mockReset().mockResolvedValue({ sub: 'owner-1' });
  softDelete.mockReset().mockResolvedValue([]);
});

describe('DELETE /api/lesson/[id] — owner-scoped single soft-delete (#199)', () => {
  it('exports the Node runtime + force-dynamic (no static caching of a mutation) — AC4', () => {
    expect(runtime).toBe('nodejs');
    expect(dynamic).toBe('force-dynamic');
  });

  it('403s a cross-origin request and does NOT call softDelete (CSRF) — AC5', async () => {
    const res = await del('lesson-1', { crossOrigin: true });
    expect(res.status).toBe(403);
    expect(softDelete).not.toHaveBeenCalled();
  });

  it('401s when there is no session and does NOT call softDelete — AC6', async () => {
    getSessionIdentity.mockResolvedValue(null);
    const res = await del('lesson-1');
    expect(res.status).toBe(401);
    expect(softDelete).not.toHaveBeenCalled();
  });

  it('forces a revocation-checked session read — AC7', async () => {
    await del('lesson-1');
    expect(getSessionIdentity).toHaveBeenCalledWith({ checkRevoked: true });
  });

  it('soft-deletes scoped to the session sub, never an owner from the request — AC8', async () => {
    softDelete.mockResolvedValue(['lesson-1']);
    const res = await del('lesson-1');
    expect(res.status).toBe(200);
    expect(softDelete).toHaveBeenCalledWith(['lesson-1'], 'owner-1');
  });

  it('200s with { deleted } = the affected ids softDelete resolved, not the input id — AC9', async () => {
    softDelete.mockResolvedValue(['lesson-1']);
    const res = await del('lesson-1');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: ['lesson-1'] });
  });

  it('200s with { deleted: [] } for a not-owned / already-deleted target — no 404 existence oracle — AC10', async () => {
    softDelete.mockResolvedValue([]); // store no-op (foreign or already-deleted)
    const res = await del('foreign-or-stale');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: [] });
  });

  it('is idempotent: the first delete affects the row, a re-delete is the empty reconcile set', async () => {
    softDelete.mockResolvedValueOnce(['lesson-1']).mockResolvedValueOnce([]);
    expect(await (await del('lesson-1')).json()).toEqual({ deleted: ['lesson-1'] });
    expect(await (await del('lesson-1')).json()).toEqual({ deleted: [] });
  });
});
