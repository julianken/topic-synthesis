export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The Service's commit self-report (#184). Returns the `GIT_SHA` baked into the image at build time
 * (Dockerfile `ENV GIT_SHA`), so the deploy verify-gate can assert `running_sha == deployed_sha` before
 * promoting traffic — closing the gap that let a stale image ship under a fresh SHA tag. No auth: it
 * exposes only the commit hash (already public on a public repo), no run data or internals. 'dev' off a
 * built image (local `next dev`), mirroring the Dockerfile's `ARG GIT_SHA=dev` default.
 */
export function GET(): Response {
  return Response.json({ gitSha: process.env.GIT_SHA?.trim() || 'dev' });
}
