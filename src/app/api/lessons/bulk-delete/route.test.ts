import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the auth gate + the store write; `isSameOrigin` (../../../auth/session) and `parseIds`
// (../parse-ids) run for real. Contract under test (#199): CSRF → revocation-checked session →
// bounded `{ ids }` body (1..100 non-empty strings) → `softDelete(ids, sub)` → `{ deleted }` = the
// RETURNING subset (the reconcile, never an echo of the input ids).
const getSessionIdentity = vi.hoisted(() => vi.fn());
const softDelete = vi.hoisted(() => vi.fn());
vi.mock('../../../auth/require-session', () => ({ getSessionIdentity }));
vi.mock('../../../../store/repo', () => ({ softDelete }));

import { POST, dynamic, runtime } from './route';

function post(body: unknown, opts?: { crossOrigin?: boolean; raw?: string }): Promise<Response> {
  const headers: Record<string, string> = opts?.crossOrigin
    ? { 'content-type': 'application/json', origin: 'https://evil.example' }
    : { 'content-type': 'application/json', origin: 'https://app.example', 'sec-fetch-site': 'same-origin' };
  const payload = opts?.raw ?? JSON.stringify(body);
  return POST(new Request('https://app.example/api/lessons/bulk-delete', { method: 'POST', headers, body: payload }));
}

beforeEach(() => {
  getSessionIdentity.mockReset().mockResolvedValue({ sub: 'owner-1' });
  softDelete.mockReset().mockResolvedValue([]);
});

describe('POST /api/lessons/bulk-delete — owner-scoped batch soft-delete (#199)', () => {
  it('exports the Node runtime + force-dynamic — AC4', () => {
    expect(runtime).toBe('nodejs');
    expect(dynamic).toBe('force-dynamic');
  });

  it('403s a cross-origin request and does NOT call softDelete (CSRF) — AC12', async () => {
    const res = await post({ ids: ['a'] }, { crossOrigin: true });
    expect(res.status).toBe(403);
    expect(softDelete).not.toHaveBeenCalled();
  });

  it('401s when there is no session and does NOT call softDelete — AC13', async () => {
    getSessionIdentity.mockResolvedValue(null);
    const res = await post({ ids: ['a'] });
    expect(res.status).toBe(401);
    expect(softDelete).not.toHaveBeenCalled();
  });

  it('forces a revocation-checked session read — AC14', async () => {
    await post({ ids: ['a'] });
    expect(getSessionIdentity).toHaveBeenCalledWith({ checkRevoked: true });
  });

  it('400s a non-JSON-object body / missing or non-array ids, and does NOT call softDelete — AC15', async () => {
    for (const res of [
      await post(undefined, { raw: 'not json' }),
      await post(42),
      await post({}),
      await post({ ids: 'a' }),
    ]) {
      expect(res.status).toBe(400);
    }
    expect(softDelete).not.toHaveBeenCalled();
  });

  it('400s an empty ids array and does NOT call softDelete — AC16', async () => {
    const res = await post({ ids: [] });
    expect(res.status).toBe(400);
    expect(softDelete).not.toHaveBeenCalled();
  });

  it('400s a non-string / empty-string entry and does NOT call softDelete — AC17', async () => {
    expect((await post({ ids: ['ok', 1] })).status).toBe(400);
    expect((await post({ ids: ['ok', ''] })).status).toBe(400);
    expect(softDelete).not.toHaveBeenCalled();
  });

  it('400s an over-100 ids array and does NOT call softDelete — AC18', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `id-${i}`);
    const res = await post({ ids });
    expect(res.status).toBe(400);
    expect(softDelete).not.toHaveBeenCalled();
  });

  it('200s a valid batch: softDelete(ids, sub) scoped to the session, reply { deleted } = resolved — AC19', async () => {
    softDelete.mockResolvedValue(['a', 'b']);
    const res = await post({ ids: ['a', 'b'] });
    expect(res.status).toBe(200);
    expect(softDelete).toHaveBeenCalledWith(['a', 'b'], 'owner-1');
    expect(await res.json()).toEqual({ deleted: ['a', 'b'] });
  });

  it('returns only the RETURNING subset when some ids are not owned/already deleted — AC20', async () => {
    softDelete.mockResolvedValue(['a']); // 'foreign' and 'gone' drop out in the store
    const res = await post({ ids: ['a', 'foreign', 'gone'] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: ['a'] }); // never an echo of the input ids
  });

  it('is idempotent: a re-delete of the same batch yields the empty reconcile set', async () => {
    softDelete.mockResolvedValueOnce(['a', 'b']).mockResolvedValueOnce([]);
    expect(await (await post({ ids: ['a', 'b'] })).json()).toEqual({ deleted: ['a', 'b'] });
    expect(await (await post({ ids: ['a', 'b'] })).json()).toEqual({ deleted: [] });
  });
});
