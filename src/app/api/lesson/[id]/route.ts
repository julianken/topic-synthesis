import { softDelete } from '../../../../store/repo';
import { getSessionIdentity } from '../../../auth/require-session';
import { isSameOrigin } from '../../../auth/session';

// pg is Node-only (not Edge); a mutation is never statically cached.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Soft-delete ONE lesson the caller owns (the card/reader delete affordance, #199). A CSRF-guarded,
 * owner-scoped DELETE: same-origin → revocation-checked session → `softDelete`. The owner is ALWAYS the
 * verified session `sub`; the only request input is the path `id` (no body, so no `400` branch). The
 * owner-scope (`WHERE owner_sub`) + the `RETURNING id` reconcile live in `softDelete` (#198), so a
 * foreign / stale / already-deleted id is an indistinguishable no-op that still `200`s with
 * `{ deleted: [] }` — never a `404`/`403` that would confirm the row exists (AGENTS.md default-deny / no
 * existence oracle). The reply carries the actually-affected ids so the client knows whether to offer Undo.
 */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!isSameOrigin(req)) return Response.json({ error: 'cross-origin request rejected' }, { status: 403 });
  const identity = await getSessionIdentity({ checkRevoked: true });
  if (!identity) return Response.json({ error: 'Sign in to delete.' }, { status: 401 });
  const { id } = await ctx.params;
  const deleted = await softDelete([id], identity.sub);
  return Response.json({ deleted }, { status: 200 });
}
