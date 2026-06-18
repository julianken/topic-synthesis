import { getCurriculum } from '../../../../../store/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Has the run's curriculum landed yet? The hub's GeneratingPoller polls this until ready. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const view = await getCurriculum(id);
  return Response.json({ id, ready: view !== null });
}
