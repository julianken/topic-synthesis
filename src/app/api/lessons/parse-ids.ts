// The bounded-body contract shared by the two collection-level POST routes (bulk-delete + restore,
// #199). Defined ONCE here so both routes enforce the SAME shape rather than re-deriving it, and so the
// `1..100` cap (the owner's per-batch decision) lives in a single unit-tested place.

/** The owner's per-batch cap: bulk delete/restore accept at most this many ids in one request. */
export const MAX_BULK_IDS = 100;

/**
 * Validate a request body as `{ ids }` where `ids` is an array of non-empty strings with
 * `1 <= length <= MAX_BULK_IDS`. Returns the validated id array, or `null` for ANY violation (a
 * non-object body, a missing/non-array `ids`, an empty array, a non-string or empty-string entry, or an
 * over-cap array). The POST routes map `null` → `400`. This is a pure shape check only — it never
 * authorizes anything; owner-scoping is the store's `WHERE owner_sub` (#198), never the client id list.
 */
export function parseIds(body: unknown): string[] | null {
  if (typeof body !== 'object' || body === null) return null;
  const ids = (body as { ids?: unknown }).ids;
  if (!Array.isArray(ids)) return null;
  if (ids.length < 1 || ids.length > MAX_BULK_IDS) return null;
  for (const id of ids) {
    if (typeof id !== 'string' || id.length === 0) return null;
  }
  return ids as string[];
}
