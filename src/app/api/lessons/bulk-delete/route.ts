import { softDelete } from '../../../../store/repo';
import { getSessionIdentity } from '../../../auth/require-session';
import { isSameOrigin } from '../../../auth/session';
import { parseIds } from '../parse-ids';

// pg is Node-only (not Edge); a mutation is never statically cached.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Soft-delete up to 100 lessons in one batch (the multi-select delete, #199). Same CSRF + owner-scope
 * discipline as the single-delete route, plus the bounded `{ ids }` body contract (`parseIds`: a
 * non-object body / missing-or-non-array `ids` / empty array / non-string-or-empty-string entry /
 * over-cap array all → `400`, BEFORE any store call). The owner is the session `sub`, NEVER the body;
 * `softDelete`'s owner-scoped UPDATE + `RETURNING id` make the reply's `deleted` exactly the subset the
 * DB actually affected — a foreign/stale id silently drops out (the reconcile seam the optimistic
 * clients read), never an echo of the input ids and never an existence oracle.
 */
export async function POST(req: Request): Promise<Response> {
  if (!isSameOrigin(req)) return Response.json({ error: 'cross-origin request rejected' }, { status: 403 });
  const identity = await getSessionIdentity({ checkRevoked: true });
  if (!identity) return Response.json({ error: 'Sign in to delete.' }, { status: 401 });
  const ids = parseIds(await req.json().catch(() => null));
  if (!ids) return Response.json({ error: 'Body must be { ids } with 1–100 non-empty string ids.' }, { status: 400 });
  const deleted = await softDelete(ids, identity.sub);
  return Response.json({ deleted }, { status: 200 });
}
