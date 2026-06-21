import { getSessionIdentity } from '../../../../auth/require-session';
import { getCurriculum } from '../../../../../store/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Has the run's curriculum landed yet? Owner-scoped: ready ONLY when the caller owns a persisted
 *  curriculum at this id — a foreign/absent id is uniformly not-ready (no existence oracle). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const identity = await getSessionIdentity();
  const view = identity ? await getCurriculum(id, identity.sub) : null;
  return Response.json({ id, ready: view !== null });
}
