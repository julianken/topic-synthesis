/**
 * Pure, I/O-free helpers for the library home's bulk multi-select delete (issue #203) — mirrors the
 * `library-card.ts` / `library-delete.ts` convention of keeping race-prone or easy-to-get-wrong math in a
 * plain `.ts` module so it unit-tests under vitest's `environment: 'node'` with no DOM, no timers, no
 * network (`library-selection.test.ts`). `LibraryProvider` wires these to real React state; the action bar
 * reads `masterState` for its tri-state glyph; `bulkDelete()` reads `clampSelection` when building the
 * request body and `selectAll()`'s target set, and `reconcileBulk` when reconciling the server's
 * `{ deleted: affectedIds }` reply against what was optimistically collapsed.
 */

/** The owner's per-batch cap — mirrors `src/app/api/lessons/parse-ids.ts`'s `MAX_BULK_IDS` (the route's
 *  OWN enforced ceiling). Duplicated as a literal default rather than imported: `parse-ids.ts` lives under
 *  the server route tree and this module must stay a plain, dependency-free `.ts` any client component can
 *  import; both values are 100 by the same owner-locked decision (#199 / #203). Exported so
 *  `library-provider.tsx` reads ONE symbol for the client-side selection ceiling instead of a second
 *  magic-number 100. */
export const MAX_SELECTION = 100;
const DEFAULT_CAP = MAX_SELECTION;

/**
 * The action bar's master checkbox tri-state (AC11): `'none'` when nothing is selected, `'mixed'` when
 * some-but-not-all of the selectable set is selected, `'all'` when every selectable item UP TO THE CAP is
 * selected. `selectableCount` is the count of ids the caller could select — the provider's registered
 * (persisted, non-in-flight — AC44) id count, which may itself exceed `cap` (e.g. 150 lessons with a
 * 100-id cap). In that case "all" means "selected everything permitted", i.e. `selectedCount` reaching the
 * CAPPED selectable count — never a demand to select more than the cap allows (AC8/AC12).
 */
export function masterState(
  selectedCount: number,
  selectableCount: number,
  cap: number = DEFAULT_CAP,
): 'none' | 'mixed' | 'all' {
  if (selectedCount <= 0) return 'none';
  const effectiveSelectable = Math.min(selectableCount, cap);
  if (effectiveSelectable <= 0) return 'none';
  if (selectedCount >= effectiveSelectable) return 'all';
  return 'mixed';
}

/**
 * Cap an id list at `cap` (default 100 — the owner's per-batch decision, AC7/AC8), preserving order.
 * Used both for a per-card toggle's implicit ceiling (the provider refuses to grow `selection` past the
 * cap) and for `selectAll()`'s target set (select at most `min(total, cap)`).
 */
export function clampSelection(ids: readonly string[], cap: number = DEFAULT_CAP): string[] {
  return ids.slice(0, cap);
}

/** The bulk-delete reconcile result (AC24): `removed` are ids the server actually affected (stay
 *  collapsed/gone), `reexpand` are ids that were optimistically collapsed but the server did NOT confirm
 *  (a race — already deleted elsewhere, foreign, or a partial failure) and must animate back open. */
export interface BulkReconcile {
  removed: string[];
  reexpand: string[];
}

/**
 * Split the ids the client optimistically collapsed (`selectedIds`) against the ids the server's
 * `POST /api/lessons/bulk-delete` reply actually confirmed (`affectedIds`, the route's `{ deleted }`
 * array — #199's `softDelete` `RETURNING id` reconcile seam). Order is preserved from `selectedIds` in
 * both output arrays (the order the user selected/collapsed them), never `affectedIds`'s order. An
 * `affectedIds` entry that was never in `selectedIds` is ignored (defensive — the function only ever
 * classifies ids that were actually part of the optimistic batch, never invents a removal).
 */
export function reconcileBulk(selectedIds: readonly string[], affectedIds: readonly string[]): BulkReconcile {
  const affected = new Set(affectedIds);
  const removed: string[] = [];
  const reexpand: string[] = [];
  for (const id of selectedIds) {
    if (affected.has(id)) removed.push(id);
    else reexpand.push(id);
  }
  return { removed, reexpand };
}
