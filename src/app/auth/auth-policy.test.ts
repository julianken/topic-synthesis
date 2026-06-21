import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAllowed } from './allowlist';
import { devBypassIdentity } from './dev-bypass';
import { isSameOrigin } from './session';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('allowlist (isAllowed) — load-bearing on the spend gate', () => {
  it('an empty/unset allowlist allows NO ONE (fail-closed)', () => {
    vi.stubEnv('AUTH_ALLOWLIST', '');
    expect(isAllowed('sub-1')).toBe(false);
  });
  it('allows only the listed subs, trimming whitespace', () => {
    vi.stubEnv('AUTH_ALLOWLIST', 'sub-1, sub-2 ,sub-3');
    expect(isAllowed('sub-2')).toBe(true);
    expect(isAllowed('sub-9')).toBe(false);
  });
});

describe('dev-bypass (devBypassIdentity)', () => {
  it('is inert in non-prod unless AUTH_DEV_BYPASS=1', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('AUTH_DEV_BYPASS', '');
    expect(devBypassIdentity()).toBeNull();
  });
  it('grants a canned identity in non-prod with AUTH_DEV_BYPASS=1', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('AUTH_DEV_BYPASS', '1');
    expect(devBypassIdentity()).toMatchObject({ emailVerified: true });
  });
  it('is FAIL-CLOSED in production even with AUTH_DEV_BYPASS=1', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AUTH_DEV_BYPASS', '1');
    expect(devBypassIdentity()).toBeNull();
  });
});

describe('CSRF same-origin (isSameOrigin)', () => {
  const make = (headers: Record<string, string>) =>
    new Request('https://app.example/api/x', { method: 'POST', headers });
  it('rejects a cross-site Sec-Fetch-Site', () => {
    expect(isSameOrigin(make({ 'sec-fetch-site': 'cross-site' }))).toBe(false);
  });
  it('rejects a foreign Origin host', () => {
    expect(isSameOrigin(make({ origin: 'https://evil.example' }))).toBe(false);
  });
  it('accepts a same-origin request', () => {
    expect(isSameOrigin(make({ origin: 'https://app.example', 'sec-fetch-site': 'same-origin' }))).toBe(true);
  });
  it('rejects a request with NO CSRF signal (no Origin, no Sec-Fetch-Site) — fail-closed', () => {
    expect(isSameOrigin(make({}))).toBe(false);
  });
  it('trusts a same-origin Sec-Fetch-Site even without an Origin header', () => {
    expect(isSameOrigin(make({ 'sec-fetch-site': 'same-origin' }))).toBe(true);
  });
  it('treats Sec-Fetch-Site: none (a user-initiated navigation) as same-origin', () => {
    expect(isSameOrigin(make({ 'sec-fetch-site': 'none' }))).toBe(true);
  });
});
