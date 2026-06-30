import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET } from './route';

// #184: the /version route lets the deploy verify-gate assert `running_sha == deployed_sha` before
// promoting traffic — the Service self-reports the commit baked into its image (Dockerfile ENV GIT_SHA).
const SAVED = process.env.GIT_SHA;

beforeEach(() => {
  delete process.env.GIT_SHA;
});
afterEach(() => {
  if (SAVED === undefined) delete process.env.GIT_SHA;
  else process.env.GIT_SHA = SAVED;
});

describe('/version route', () => {
  it('returns the running GIT_SHA baked into the image', async () => {
    process.env.GIT_SHA = 'abc1234';
    const body = (await GET().json()) as { gitSha: string };
    expect(body.gitSha).toBe('abc1234');
  });

  it("falls back to 'dev' when GIT_SHA is unset (local / non-built run)", async () => {
    const body = (await GET().json()) as { gitSha: string };
    expect(body.gitSha).toBe('dev');
  });
});
