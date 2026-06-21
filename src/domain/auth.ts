/**
 * The AuthProvider port — identity verification behind an interface (ADR 0002 §3), a sibling of the
 * Engine / TraceSink ports. These pure types keep the core import fence green (no SDK import here);
 * the firebase-admin adapter is confined to `src/app/auth/gcp-auth-provider.ts`.
 */

/**
 * A verified caller. `sub` is the stable Google subject id — the cross-store ownership key, never the
 * mutable email. `emailVerified` gates spend (ADR 0002 §5: `email_verified` alone is not enough, but
 * its absence is disqualifying).
 */
export interface VerifiedIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
}

/**
 * Identity verification + session lifecycle. Two SEPARATE verify methods (no polymorphic entrypoint)
 * close the confused-deputy class: an exfiltrable raw ID token must never be accepted where an
 * httpOnly session cookie is expected. Verifiers return `null` on any invalid/expired/revoked input
 * so callers fail closed; they never throw for an ordinary auth failure.
 */
export interface AuthProvider {
  /** Verify the app's own httpOnly session cookie. */
  verifySessionCookie(cookie: string, opts?: { checkRevoked?: boolean }): Promise<VerifiedIdentity | null>;
  /** Verify a freshly-minted IdP ID token — only at the session-exchange seam, never as a session. */
  verifyIdToken(idToken: string, opts?: { checkRevoked?: boolean }): Promise<VerifiedIdentity | null>;
  /** Mint a session cookie from a verified ID token. */
  createSessionCookie(idToken: string, expiresInMs: number): Promise<string>;
  /** Revoke all sessions for a subject (logout-everywhere / offboarding). */
  revoke(sub: string): Promise<void>;
}

/** Injectable seam, mirroring repo.ts's `deps: StoreDeps = { pool: getPool() }`. */
export interface AuthDeps {
  provider: AuthProvider;
}
