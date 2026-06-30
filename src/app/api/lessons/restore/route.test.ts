import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the auth gate + the store write; `isSameOrigin` (../../../auth/session) and `parseIds`
// (../parse-ids) run for real. Contract under test (#199): CSRF → revocation-checked session →
// the SAME bounded `{ ids }` body as bulk-delete → `restore(ids, sub)` → `{ restored }` = the
// RETURNING reconcile (re-restore yields []). restore's owner-scope is unit-tested in the store (#198).
const getSessionIdentity = vi.hoisted(() => vi.fn());
const restore = vi.hoisted(() => vi.fn());
vi.mock('../../../auth/require-session', () => ({ getSessionIdentity }));
vi.mock('../../../../store/repo', () => ({ restore }));

import { POST, dynamic, runtime } from './route';

function post(body: unknown, opts?: { crossOrigin?: boolean; raw?: string }): Promise<Response> {
  const headers: Record<string, string> = opts?.crossOrigin
    ? { 'content-type': 'application/json', origin: 'https://evil.example' }
    : { 'content-type': 'application/json', origin: 'https://app.example', 'sec-fetch-site': 'same-origin' };
  const payload = opts?.raw ?? JSON.stringify(body);
  return POST(new Request('https://app.example/api/lessons/restore', { method: 'POST', headers, body: payload }));
}

beforeEach(() => {
  getSessionIdentity.mockReset().mockResolvedValue({ sub: 'owner-1' });
  restore.mockReset().mockResolvedValue([]);
});

describe('POST /api/lessons/restore — owner-scoped single + batch restore (#199)', () => {
  it('exports the Node runtime + force-dynamic — AC4', () => {
    expect(runtime).toBe('nodejs');
    expect(dynamic).toBe('force-dynamic');
  });

  it('403s a cross-origin request and does NOT call restore (CSRF) — AC21', async () => {
    const res = await post({ ids: ['a'] }, { crossOrigin: true });
    expect(res.status).toBe(403);
    expect(restore).not.toHaveBeenCalled();
  });

  it('401s when there is no session and does NOT call restore — AC22', async () => {
    getSessionIdentity.mockResolvedValue(null);
    const res = await post({ ids: ['a'] });
    expect(res.status).toBe(401);
    expect(restore).not.toHaveBeenCalled();
  });

  it('forces a revocation-checked session read — AC23', async () => {
    await post({ ids: ['a'] });
    expect(getSessionIdentity).toHaveBeenCalledWith({ checkRevoked: true });
  });

  it('enforces the identical bounded-body contract as bulk-delete (non-object / bad ids / empty / over-cap → 400) — AC24', async () => {
    for (const res of [
      await post(undefined, { raw: 'not json' }),
      await post(42),
      await post({}),
      await post({ ids: 'a' }),
      await post({ ids: [] }),
      await post({ ids: ['ok', 1] }),
      await post({ ids: ['ok', ''] }),
      await post({ ids: Array.from({ length: 101 }, (_, i) => `id-${i}`) }),
    ]) {
      expect(res.status).toBe(400);
    }
    expect(restore).not.toHaveBeenCalled();
  });

  it('200s a valid body: restore(ids, sub) scoped to the session, reply { restored } = resolved — AC25', async () => {
    restore.mockResolvedValue(['a', 'b']);
    const res = await post({ ids: ['a', 'b'] });
    expect(res.status).toBe(200);
    expect(restore).toHaveBeenCalledWith(['a', 'b'], 'owner-1');
    expect(await res.json()).toEqual({ restored: ['a', 'b'] });
  });

  it('is idempotent: re-restoring already-restored ids yields { restored: [] } — AC25', async () => {
    restore.mockResolvedValueOnce(['a']).mockResolvedValueOnce([]);
    expect(await (await post({ ids: ['a'] })).json()).toEqual({ restored: ['a'] });
    expect(await (await post({ ids: ['a'] })).json()).toEqual({ restored: [] });
  });

  it('returns only the RETURNING subset for a mixed batch (foreign/not-deleted ids drop out)', async () => {
    restore.mockResolvedValue(['a']);
    const res = await post({ ids: ['a', 'foreign', 'not-deleted'] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ restored: ['a'] });
  });
});
