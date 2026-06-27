import { describe, expect, it, vi } from 'vitest';

// The stub-guard test only exercises the pure `resolveRunDeps(env)` helper, but importing `./route`
// loads the route module — so mock the same heavy / DB-touching imports route.test.ts mocks, keeping
// this test free of a live DB / dispatcher. None of these mocks is CALLED here; they just keep the
// module import side-effect-free.
vi.mock('../../auth/require-session', () => ({ getSessionIdentity: vi.fn() }));
vi.mock('./dispatch', () => ({ dispatchJob: vi.fn(), isJobDispatchEnabled: () => false }));
vi.mock('../../../store/repo', () => ({ recordRunOwner: vi.fn(), persistRun: vi.fn() }));

import { resolveRunDeps } from './route';
import { defaultDeps } from '../../../pipeline/deps';
import { e2eStubDeps } from '../../../pipeline/e2e-stub-deps';

// The no-spend-in-prod invariant the e2e harness leans on: the zero-cost stub deps run ONLY off a
// deployed runtime. This guard fails silently-safe (no throw, just real deps), so without this test a
// regression that dropped the `!K_SERVICE` clause — letting the stub run on a Cloud Run deploy that
// somehow carried E2E=1 — would be caught by nothing. (The auth twin fails LOUD and is covered by
// provider.test.ts; this is its silent-safe counterpart.)
describe('resolveRunDeps — the e2e pipeline-stub deploy guard (no spend in prod)', () => {
  it('returns the NETWORK-FREE stub deps with E2E=1 and NO K_SERVICE (the e2e harness)', () => {
    expect(resolveRunDeps({ E2E: '1' })).toBe(e2eStubDeps);
  });

  it('returns the REAL deps with E2E=1 but K_SERVICE set — the stub is UNREACHABLE on a deploy', () => {
    // The regression-closing case: a deploy that somehow carried E2E=1 must still get the real client.
    expect(resolveRunDeps({ E2E: '1', K_SERVICE: 'topic-synthesis-app' })).toBe(defaultDeps);
  });

  it('returns the REAL deps when E2E is unset (the default deploy + local-dev path)', () => {
    expect(resolveRunDeps({})).toBe(defaultDeps);
    expect(resolveRunDeps({ K_SERVICE: 'topic-synthesis-app' })).toBe(defaultDeps);
  });

  it('treats any E2E value other than the literal "1" as off (not a blanket bypass)', () => {
    expect(resolveRunDeps({ E2E: 'true' })).toBe(defaultDeps);
    expect(resolveRunDeps({ E2E: '0' })).toBe(defaultDeps);
  });
});
