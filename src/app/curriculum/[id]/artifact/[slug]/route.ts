import { getSessionIdentity } from '../../../../auth/require-session';
import { getOwnedPage } from '../../../../../store/repo';
import { artifactResponse } from '../../../../artifact/serve';

// pg + the session check are Node-only; never statically cached.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Serve a stored page's HTML, authorized THROUGH the owning curriculum (ADR 0002 §5). The httpOnly
 * session cookie rides this same-origin GET — the iframe's `sandbox` opaques only the framed DOM, not
 * this load request — and `getOwnedPage` scopes by (curriculumId owned by `sub`, slug). A uniform 404
 * for absent / not-owned; the `pageId` (a content hash shared across curricula) is never the gate, so
 * there is no per-page bearer token to leak via the URL.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; slug: string }> },
): Promise<Response> {
  const { id, slug } = await ctx.params;
  const identity = await getSessionIdentity({ checkRevoked: true });
  if (!identity) return new Response('Not found', { status: 404 });
  const page = await getOwnedPage(id, slug, identity.sub);
  if (!page) return new Response('Not found', { status: 404 });
  return artifactResponse(page);
}
