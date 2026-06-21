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
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.headers.get('origin');
  if (origin) {
    try {
      return new URL(origin).host === new URL(req.url).host;
    } catch {
      return false;
    }
  }
  // No Origin header (e.g. a top-level navigation) — Sec-Fetch-Site already vouched same-origin/none.
  return true;
}
