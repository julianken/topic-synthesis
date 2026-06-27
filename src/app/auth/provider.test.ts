import { afterEach, describe, expect, it, vi } from 'vitest';
import { GcpAuthProvider } from './gcp-auth-provider';
import { FakeAuthProvider } from './fake-auth-provider';
import {
  E2E_OWNER_SUB,
  E2E_SESSION_COOKIE,
  assertFakeNotInProduction,
  isTestAuthEnabled,
  selectAuthProvider,
} from './provider';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('selectAuthProvider — the test-auth seam', () => {
  it('returns the REAL GcpAuthProvider when no flag is set (the default)', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('AUTH_PROVIDER', '');
    vi.stubEnv('K_SERVICE', '');
    expect(selectAuthProvider()).toBeInstanceOf(GcpAuthProvider);
    expect(isTestAuthEnabled()).toBe(false);
  });

  it('returns the seeded FakeAuthProvider with AUTH_PROVIDER=fake off a deployed runtime', async () => {
    vi.stubEnv('AUTH_PROVIDER', 'fake');
    vi.stubEnv('K_SERVICE', ''); // not Cloud Run
    vi.stubEnv('NODE_ENV', 'development');
    const provider = selectAuthProvider();
    expect(provider).toBeInstanceOf(FakeAuthProvider);
    expect(isTestAuthEnabled()).toBe(true);
    // The seeded canned cookie verifies to the allowlisted e2e owner (email-verified).
    const identity = await provider.verifySessionCookie(E2E_SESSION_COOKIE);
    expect(identity).toMatchObject({ sub: E2E_OWNER_SUB, emailVerified: true });
    // An unknown cookie does not verify — the fake is not a blanket bypass.
    expect(await provider.verifySessionCookie('not-the-seeded-cookie')).toBeNull();
  });

  it('the e2e seam works on a real production BUILD (NODE_ENV=production) when NOT on Cloud Run', () => {
    // The e2e runs a real `next build` bundle (NODE_ENV=production) with no K_SERVICE — the seam must be
    // reachable there, gated only by the opt-in flag + the absence of the Cloud Run signal.
    vi.stubEnv('AUTH_PROVIDER', 'fake');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('K_SERVICE', '');
    expect(selectAuthProvider()).toBeInstanceOf(FakeAuthProvider);
    expect(isTestAuthEnabled()).toBe(true);
  });

  it('is FAIL-LOUD on Cloud Run (K_SERVICE set) even with AUTH_PROVIDER=fake — selectAuthProvider throws', () => {
    vi.stubEnv('AUTH_PROVIDER', 'fake');
    vi.stubEnv('K_SERVICE', 'topic-synthesis-app'); // the Knative service name a deploy always carries
    vi.stubEnv('NODE_ENV', 'production');
    // The fake must be UNREACHABLE on a deploy: requesting it crashes loudly rather than silently
    // granting an allowlisted session.
    expect(() => selectAuthProvider()).toThrow(/forbidden on a deployed runtime/i);
    expect(() => isTestAuthEnabled()).toThrow(/forbidden on a deployed runtime/i);
    expect(() => assertFakeNotInProduction()).toThrow(/forbidden on a deployed runtime/i);
  });

  it('returns the REAL provider on Cloud Run when no fake flag is set (the deployed path is unaffected)', () => {
    vi.stubEnv('AUTH_PROVIDER', '');
    vi.stubEnv('K_SERVICE', 'topic-synthesis-app');
    vi.stubEnv('NODE_ENV', 'production');
    expect(selectAuthProvider()).toBeInstanceOf(GcpAuthProvider);
    expect(isTestAuthEnabled()).toBe(false);
    expect(() => assertFakeNotInProduction()).not.toThrow();
  });
});
