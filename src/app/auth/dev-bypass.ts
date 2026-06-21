import type { VerifiedIdentity } from '../../domain/auth';

/**
 * Local-dev escape hatch: with `AUTH_DEV_BYPASS=1` every request is a canned allowlisted owner, so
 * `npm run dev` works without wiring Google OAuth + the allowlist locally.
 *
 * HARD-GATED to non-production and satisfiable ONLY from server env, never from request input:
 * the `NODE_ENV === 'production'` check is first and unconditional, so a deployed build (Cloud Run +
 * Next both set NODE_ENV=production) can never grant a bypass session regardless of any header.
 */
export function devBypassIdentity(): VerifiedIdentity | null {
  if (process.env.NODE_ENV === 'production') return null; // fail-closed in prod, no matter what
  if (process.env.AUTH_DEV_BYPASS !== '1') return null;
  return { sub: 'dev-bypass', email: 'dev@localhost', emailVerified: true };
}
