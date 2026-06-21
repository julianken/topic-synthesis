import { cookies } from 'next/headers';
import { isAllowed } from '../../../auth/allowlist';
import { defaultProvider } from '../../../auth/gcp-auth-provider';
import { SESSION_COOKIE, SESSION_TTL_MS, isSameOrigin, sessionCookieOptions } from '../../../auth/session';

// pg + the Admin SDK are Node-only (not Edge); never statically cached.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Exchange a freshly-minted Google ID token for an httpOnly session cookie. `verifyIdToken` (with
 * revocation) runs BEFORE `createSessionCookie` mints a long-lived credential from a short-lived
 * token; same-origin only (CSRF); `email_verified` + the allowlist are enforced here too.
 */
export async function POST(req: Request): Promise<Response> {
  if (!isSameOrigin(req)) return Response.json({ error: 'cross-origin request rejected' }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { idToken?: unknown } | null;
  const idToken = typeof body?.idToken === 'string' ? body.idToken : '';
  if (!idToken) return Response.json({ error: 'idToken required' }, { status: 400 });

  const provider = defaultProvider();
  const identity = await provider.verifyIdToken(idToken, { checkRevoked: true });
  if (!identity || !identity.emailVerified) {
    return Response.json({ error: 'Sign-in requires a verified Google account.' }, { status: 401 });
  }
  if (!isAllowed(identity.sub)) {
    return Response.json({ error: 'This account is not on the allowlist.' }, { status: 403 });
  }

  const cookie = await provider.createSessionCookie(idToken, SESSION_TTL_MS);
  (await cookies()).set(SESSION_COOKIE, cookie, sessionCookieOptions());
  return Response.json({ ok: true }, { status: 200 });
}

/** Sign out: revoke the IdP refresh tokens (logout-everywhere) + clear the cookie. Same-origin only. */
export async function DELETE(req: Request): Promise<Response> {
  if (!isSameOrigin(req)) return Response.json({ error: 'cross-origin request rejected' }, { status: 403 });
  const jar = await cookies();
  const cookie = jar.get(SESSION_COOKIE)?.value;
  if (cookie) {
    const identity = await defaultProvider().verifySessionCookie(cookie);
    if (identity) await defaultProvider().revoke(identity.sub);
  }
  jar.delete(SESSION_COOKIE);
  return Response.json({ ok: true }, { status: 200 });
}
