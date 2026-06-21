// Session-cookie constants + the CSRF same-origin guard. Server-only glue (lives in src/app).

/** Cloud Run / Firebase pass through a cookie named `__session` by convention; use it so a CDN edge
 *  never strips the session. */
export const SESSION_COOKIE = '__session';

/** 5 days. Kept well below Identity Platform's 14-day session-cookie max so a revoked principal's
 *  window is bounded even on cache-hit reads (ADR 0002 §5). */
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 5;

/** httpOnly + Secure (prod) + SameSite=Lax, host-scoped. SameSite=Lax already blocks cross-site POSTs;
 *  the Origin/Sec-Fetch-Site check below is the belt to that suspenders. */
export function sessionCookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}

/**
 * CSRF defense for state-changing POSTs (Next route handlers add none by default). Rejects any
 * request whose `Sec-Fetch-Site` is cross-site, or whose `Origin` host differs from the request host.
 * Fail-closed on a malformed Origin.
 */
export function isSameOrigin(req: Request): boolean {
  // Sec-Fetch-* are browser-set forbidden headers (JS can't spoof them), so trust the signal directly.
  const site = req.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin' || site === 'none';
  const origin = req.headers.get('origin');
  if (origin) {
    try {
      return new URL(origin).host === new URL(req.url).host;
    } catch {
      return false;
    }
  }
  // Neither Sec-Fetch-Site nor Origin on a state-changing request → no CSRF signal → reject. The app's
  // own POSTs are fetch() calls that always carry Origin, so this is fail-closed without leaning on
  // SameSite=Lax — the check still holds if the cookie's SameSite is ever relaxed.
  return false;
}
