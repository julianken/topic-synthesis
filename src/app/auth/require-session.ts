import { cookies } from 'next/headers';
import type { VerifiedIdentity } from '../../domain/auth';
import { isAllowed } from './allowlist';
import { devBypassIdentity } from './dev-bypass';
import { defaultProvider } from './gcp-auth-provider';
import { SESSION_COOKIE } from './session';

/**
 * The single authoritative session check for protected server code (the default-deny choke point).
 * Returns the verified, email-verified, allowlisted identity, or `null` — callers MUST fail closed
 * (401/uniform-404). Pass `{ checkRevoked: true }` to force the IdP round-trip (revocation): use it
 * on the spend gate and on private reads (ADR 0002 §5), accepting the cold-path cost there.
 */
export async function getSessionIdentity(opts?: { checkRevoked?: boolean }): Promise<VerifiedIdentity | null> {
  const bypass = devBypassIdentity();
  if (bypass) return bypass; // non-prod only; see dev-bypass.ts

  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!cookie) return null;

  const identity = await defaultProvider().verifySessionCookie(cookie, opts);
  if (!identity || !identity.emailVerified || !isAllowed(identity.sub)) return null;
  return identity;
}
