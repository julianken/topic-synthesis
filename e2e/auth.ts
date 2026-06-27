import type { BrowserContext } from '@playwright/test';

// The test-auth helper for the e2e harness. The webServer runs with AUTH_PROVIDER=fake (the in-memory
// FakeAuthProvider, hard-gated to non-prod — see src/app/auth/provider.ts), seeded so a single canned
// __session cookie value verifies to a single allowlisted owner. Seeding that exact cookie value into
// the browser context gives the e2e an allowlisted session WITHOUT real Google OAuth.
//
// These constants MUST equal src/app/auth/provider.ts E2E_SESSION_COOKIE and the cookie name in
// src/app/auth/session.ts SESSION_COOKIE — kept in sync by hand (the e2e can't import the server-only
// modules through the browser harness). A drift would fail the smoke spec's authed-library assertion.

/** Matches SESSION_COOKIE in src/app/auth/session.ts. */
export const SESSION_COOKIE = '__session';
/** Matches E2E_SESSION_COOKIE in src/app/auth/provider.ts (the fake's seeded key). */
export const E2E_SESSION_COOKIE = 'e2e-session';

/** Seed the allowlisted e2e session cookie into the context so subsequent navigations are authed. */
export async function signInAsTestOwner(context: BrowserContext, baseURL: string): Promise<void> {
  const { hostname } = new URL(baseURL);
  await context.addCookies([
    {
      name: SESSION_COOKIE,
      value: E2E_SESSION_COOKIE,
      domain: hostname,
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}
