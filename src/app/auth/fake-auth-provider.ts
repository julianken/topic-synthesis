import type { AuthProvider, VerifiedIdentity } from '../../domain/auth';

/**
 * In-memory AuthProvider for tests + the local dev bypass — the real-default-plus-fake shape of
 * Engine (Inline/Gcp) and TraceSink (noop/eleatic). It maps a cookie/token STRING to a canned
 * identity, so a test drives the auth-dependent code paths with no live IdP. `createSessionCookie`
 * wires the minted cookie to the source token's identity so a round-trip (mint → verify) is coherent.
 */
export class FakeAuthProvider implements AuthProvider {
  private readonly identities: Map<string, VerifiedIdentity>;
  private readonly revoked = new Set<string>();

  /** @param seed token/cookie string → the identity it verifies to. */
  constructor(seed: Record<string, VerifiedIdentity> = {}) {
    this.identities = new Map(Object.entries(seed));
  }

  private lookup(token: string, checkRevoked: boolean): VerifiedIdentity | null {
    const id = this.identities.get(token);
    if (!id) return null;
    if (checkRevoked && this.revoked.has(id.sub)) return null;
    return id;
  }

  async verifySessionCookie(cookie: string, opts?: { checkRevoked?: boolean }): Promise<VerifiedIdentity | null> {
    return this.lookup(cookie, opts?.checkRevoked ?? false);
  }

  async verifyIdToken(idToken: string, opts?: { checkRevoked?: boolean }): Promise<VerifiedIdentity | null> {
    return this.lookup(idToken, opts?.checkRevoked ?? false);
  }

  async createSessionCookie(idToken: string, _expiresInMs: number): Promise<string> {
    const cookie = `session:${idToken}`;
    const id = this.identities.get(idToken);
    if (id) this.identities.set(cookie, id); // the session verifies to the same identity
    return cookie;
  }

  async revoke(sub: string): Promise<void> {
    this.revoked.add(sub);
  }
}
