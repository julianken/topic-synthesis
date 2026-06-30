import { restore } from '../../../../store/repo';
import { getSessionIdentity } from '../../../auth/require-session';
import { isSameOrigin } from '../../../auth/session';
import { parseIds } from '../parse-ids';

// pg is Node-only (not Edge); a mutation is never statically cached.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Restore one-or-many soft-deleted lessons — the durable undo, serving BOTH the single-delete snackbar
 * and the Recently-deleted batch restore (#199). Identical scaffold to bulk-delete (CSRF guard →
 * revocation-checked session → the shared `1..100` bounded `{ ids }` body), but calls `restore` and
 * replies `{ restored }`. The owner is the session `sub`, never the body; `restore`'s
 * `deleted_at IS NOT NULL` guard + `RETURNING id` (#198) make a re-restore / foreign / not-currently-
 * deleted id a no-op, so re-restoring already-restored ids yields `{ restored: [] }` (idempotent
 * pass-through) — the reconcile seam, no existence oracle.
 */
export async function POST(req: Request): Promise<Response> {
  if (!isSameOrigin(req)) return Response.json({ error: 'cross-origin request rejected' }, { status: 403 });
  const identity = await getSessionIdentity({ checkRevoked: true });
  if (!identity) return Response.json({ error: 'Sign in to restore.' }, { status: 401 });
  const ids = parseIds(await req.json().catch(() => null));
  if (!ids) return Response.json({ error: 'Body must be { ids } with 1–100 non-empty string ids.' }, { status: 400 });
  const restored = await restore(ids, identity.sub);
  return Response.json({ restored }, { status: 200 });
}
