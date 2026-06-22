import { getSessionIdentity } from '../../../../auth/require-session';
import { getCurriculum, getStepEvents, ownsRun, type StepEvent } from '../../../../../store/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Has the run's curriculum landed yet, and what's its per-step timeline? Two SEPARATE owner gates,
 * NOT one (issue #61):
 *  - `ready` ⇐ getCurriculum(id, sub): true only once the caller owns a PERSISTED curriculum (a
 *    foreign/absent id is uniformly not-ready — no existence oracle). Unchanged.
 *  - `steps` ⇐ ownsRun(id, sub) + getStepEvents(id): owner-scoped via the pre-persist `run_owner`
 *    stamp, so the timeline is visible DURING the run — precisely the window where getCurriculum
 *    still returns null (the curriculum persists atomically only at the end). A non-owner/absent id
 *    returns `[]`, indistinguishable from a just-started owned run → still no existence oracle.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const identity = await getSessionIdentity();
  const view = identity ? await getCurriculum(id, identity.sub) : null;
  const steps: StepEvent[] =
    identity && (await ownsRun(id, identity.sub)) ? await getStepEvents(id) : [];
  return Response.json({ id, ready: view !== null, steps });
}
