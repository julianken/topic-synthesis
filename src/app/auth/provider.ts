import type { AuthProvider } from '../../domain/auth';
import { FakeAuthProvider } from './fake-auth-provider';
import { defaultProvider } from './gcp-auth-provider';

/**
 * The AuthProvider SELECTOR — the single place that decides whether the real GCP Identity Platform
 * adapter (`GcpAuthProvider`) or the in-memory `FakeAuthProvider` backs a session check. It exists so
 * the e2e harness can drive the auth-gated UI WITHOUT real Google OAuth, while making it IMPOSSIBLE to
 * select the fake on a deployed (Cloud Run) instance.
 *
 * SECURITY MODEL — two independent conditions, both required to ever reach the fake:
 *
 *   1. ENABLE (opt-in): `process.env.AUTH_PROVIDER === 'fake'`. An explicit server env that the e2e
 *      webServer sets and that NO production config sets — neither the Dockerfile nor the Cloud Run
 *      Service env (`infra/cloud-run.tf`) ever defines it. It is read from the SERVER environment only,
 *      NEVER from request input, so no header or cookie a client controls can flip it.
 *
 *   2. HARD GUARD (deployment-deny): `assertFakeNotInProduction()` THROWS if the fake is requested on a
 *      Cloud Run instance — detected by `K_SERVICE`, the Knative runtime variable Cloud Run injects on
 *      EVERY revision (a client cannot set it; it is not in our config, the platform sets it). So even a
 *      misconfigured deploy that somehow carried `AUTH_PROVIDER=fake` would CRASH at provider selection
 *      rather than silently grant an allowlisted fake session — fail LOUD, never fail open.
 *
 * Why `K_SERVICE` and not `NODE_ENV`: the e2e runs against a REAL `next build` production bundle (a dev
 * build mis-prerenders), so the e2e process legitimately has `NODE_ENV=production`. Gating the deny on
 * `NODE_ENV` would either (a) forbid the seam on the production bundle the e2e must test, or (b) force a
 * broken dev build. `K_SERVICE` is the precise "this is a Cloud Run deploy" signal, set on every
 * deployed revision and on nothing else — so the e2e (no `K_SERVICE`) can use the seam while a real
 * deploy (always `K_SERVICE`) can never. NODE_ENV is kept as a SECONDARY deny below for defense in depth.
 *
 * The real path is untouched: with no `AUTH_PROVIDER=fake`, `selectAuthProvider()` returns exactly
 * `defaultProvider()` (the GCP adapter) as before.
 *
 * The fake is seeded so one canned cookie value verifies to one allowlisted owner — see
 * `E2E_SESSION_COOKIE` / `E2E_OWNER_SUB`. The e2e seeds the same `__session` cookie value and adds the
 * same sub to `AUTH_ALLOWLIST`, so `getSessionIdentity` resolves the test owner end to end.
 */

/** The cookie value the e2e seeds into `__session`. Must equal the fake's seeded key. */
export const E2E_SESSION_COOKIE = 'e2e-session';
/** The stable Google-`sub` the fake verifies to. The e2e adds this to `AUTH_ALLOWLIST`. */
export const E2E_OWNER_SUB = 'e2e-owner-sub';
/** The canned owner email the fake reports (email-verified, so it clears the verified gate). */
export const E2E_OWNER_EMAIL = 'e2e@localhost';

/** True when this process is a deployed Cloud Run instance. `K_SERVICE` is the Knative runtime var
 *  Cloud Run injects on EVERY revision — it is not in our config and a client cannot set it, so it is
 *  the precise "this is a deploy" signal. NOTE: `NODE_ENV` is deliberately NOT a deny signal — the e2e
 *  runs a real `next build` bundle (NODE_ENV=production) that the seam must remain reachable on; the
 *  deploy-vs-e2e distinction is exactly `K_SERVICE`, present on the former and absent on the latter. */
function isDeployedRuntime(): boolean {
  return Boolean(process.env.K_SERVICE);
}

/**
 * HARD guard: throw if the fake is requested on a deployed (Cloud Run) runtime. Selecting the fake is a
 * NON-DEPLOY-only capability; a deploy that somehow carries `AUTH_PROVIDER=fake` is misconfigured, and
 * the only safe action is to crash loudly, never to silently grant a fake allowlisted session. Named
 * `…NotInProduction` because "deployed runtime" is what production means here (Cloud Run is the only
 * deploy target — ADR 0001).
 */
export function assertFakeNotInProduction(): void {
  if (process.env.AUTH_PROVIDER === 'fake' && isDeployedRuntime()) {
    throw new Error(
      'AUTH_PROVIDER=fake is forbidden on a deployed runtime (K_SERVICE is set) — the in-memory test ' +
        'auth provider must never back a deployed session. Unset AUTH_PROVIDER on Cloud Run.',
    );
  }
}

/** True only when the test (fake) auth provider is active — opted-in via AUTH_PROVIDER=fake AND not on
 *  a deployed runtime. Throws (via the hard guard) on the forbidden deploy+fake combination. */
export function isTestAuthEnabled(): boolean {
  assertFakeNotInProduction(); // crash a misconfigured deploy before answering
  return process.env.AUTH_PROVIDER === 'fake';
}

let fakeCached: AuthProvider | undefined;

/**
 * Resolve the AuthProvider for this process. Returns the in-memory fake (seeded with the canned
 * allowlisted owner) when the test seam is enabled, otherwise the real GCP adapter. The deploy guard
 * runs first, so this can never return the fake on Cloud Run.
 */
export function selectAuthProvider(): AuthProvider {
  if (isTestAuthEnabled()) {
    return (fakeCached ??= new FakeAuthProvider({
      [E2E_SESSION_COOKIE]: { sub: E2E_OWNER_SUB, email: E2E_OWNER_EMAIL, emailVerified: true },
    }));
  }
  return defaultProvider();
}
