import { getPage } from '../../../store/repo';
import { artifactResponse } from '../serve';

// Read the page per request; never statically prerender (there is no DB at build time).
export const dynamic = 'force-dynamic';

/** Serve one stored page's HTML, sandboxed via the CSP in `../serve` (for the hub's iframe). */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ pageId: string }> },
): Promise<Response> {
  const { pageId } = await ctx.params;
  return artifactResponse(await getPage(pageId));
}
