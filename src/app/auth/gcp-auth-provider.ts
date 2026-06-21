import { getApps, initializeApp } from 'firebase-admin/app';
import { type DecodedIdToken, getAuth } from 'firebase-admin/auth';
import type { AuthProvider, VerifiedIdentity } from '../../domain/auth';

// Lazy init: the Admin SDK reads GCP credentials (ADC) at initializeApp(), so we defer it to the
// first call — importing this module (in a build, or a unit test of a route that imports it) must
// NOT require live GCP creds, mirroring how repo.ts defers getPool() to call time.
function ensureApp(): void {
  if (getApps().length === 0) initializeApp(); // ADC = the ts-runtime SA on Cloud Run
}

function toIdentity(decoded: DecodedIdToken): VerifiedIdentity | null {
  // No email on the token → not a usable identity for an allowlist/ownership system.
  if (typeof decoded.email !== 'string') return null;
  return { sub: decoded.uid, email: decoded.email, emailVerified: decoded.email_verified === true };
}

/**
 * The default AuthProvider — GCP Identity Platform via the firebase-admin Admin SDK. This is the SOLE
 * firebase-admin import site (enforced by the `firebase-admin-only-in-auth-adapter` fence rule in
 * config/dependency-cruiser.mjs).
 */
export class GcpAuthProvider implements AuthProvider {
  async verifySessionCookie(
    cookie: string,
    opts?: { checkRevoked?: boolean },
  ): Promise<VerifiedIdentity | null> {
    ensureApp();
    try {
      return toIdentity(await getAuth().verifySessionCookie(cookie, opts?.checkRevoked ?? false));
    } catch {
      return null; // invalid / expired / revoked → fail closed
    }
  }

  async verifyIdToken(idToken: string, opts?: { checkRevoked?: boolean }): Promise<VerifiedIdentity | null> {
    ensureApp();
    try {
      return toIdentity(await getAuth().verifyIdToken(idToken, opts?.checkRevoked ?? false));
    } catch {
      return null;
    }
  }

  async createSessionCookie(idToken: string, expiresInMs: number): Promise<string> {
    ensureApp();
    return getAuth().createSessionCookie(idToken, { expiresIn: expiresInMs });
  }

  async revoke(sub: string): Promise<void> {
    ensureApp();
    await getAuth().revokeRefreshTokens(sub);
  }
}

let cached: AuthProvider | undefined;

/** Lazily-constructed singleton default (no Admin SDK init until a method runs). */
export function defaultProvider(): AuthProvider {
  return (cached ??= new GcpAuthProvider());
}
