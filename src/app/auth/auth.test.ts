import { describe, expect, it } from 'vitest';
import type { VerifiedIdentity } from '../../domain/auth';
import { FakeAuthProvider } from './fake-auth-provider';

const owner: VerifiedIdentity = { sub: 'sub-123', email: 'owner@example.com', emailVerified: true };

describe('AuthProvider contract (over the fake)', () => {
  it('verifies a seeded ID token to its identity', async () => {
    const auth = new FakeAuthProvider({ 'id-tok': owner });
    expect(await auth.verifyIdToken('id-tok')).toEqual(owner);
    expect(await auth.verifyIdToken('nope')).toBeNull();
  });

  it('mint → verify round-trips: a session cookie verifies to the source token identity', async () => {
    const auth = new FakeAuthProvider({ 'id-tok': owner });
    const cookie = await auth.createSessionCookie('id-tok', 60_000);
    expect(await auth.verifySessionCookie(cookie)).toEqual(owner);
  });

  it('revoke + checkRevoked fails the session closed; without checkRevoked it still passes (cache window)', async () => {
    const auth = new FakeAuthProvider({ 'id-tok': owner });
    const cookie = await auth.createSessionCookie('id-tok', 60_000);
    await auth.revoke(owner.sub);
    expect(await auth.verifySessionCookie(cookie, { checkRevoked: true })).toBeNull();
    expect(await auth.verifySessionCookie(cookie)).toEqual(owner); // no checkRevoked → cache window
  });

  it('exposes verifySessionCookie and verifyIdToken as separate methods (no polymorphic verify)', () => {
    const auth = new FakeAuthProvider();
    // The confused-deputy split is structural: two distinct methods, so a caller can never pass a raw
    // ID token where a session cookie is expected. (The real adapter routes each to a different
    // firebase-admin verifier; the fake can't distinguish strings, so this asserts only the shape.)
    expect(typeof auth.verifySessionCookie).toBe('function');
    expect(typeof auth.verifyIdToken).toBe('function');
    expect(auth.verifySessionCookie).not.toBe(auth.verifyIdToken);
  });
});
