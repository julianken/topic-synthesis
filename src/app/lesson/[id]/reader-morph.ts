/**
 * The reader panel's `view-transition-name` ENDPOINT — the card→reader FLIP DESTINATION name (TS-20).
 *
 * This MUST be byte-identical to the FLIP-ORIGIN name TS-17 stamps on each library card
 * (`src/app/library-card.ts` → `morphName(id)`): a cross-document View-Transition pairs an old/new
 * snapshot ONLY when the two `view-transition-name`s are the SAME custom-ident, so an id-scoped origin
 * (`lesson-card-<id>`) can never pair with a single global destination name. TS-21 wires the actual
 * cross-document container-transform over both endpoints; this side just declares the destination.
 *
 * Why a co-located copy rather than an import: TS-17 (`library-card.ts`) and TS-20 ship in two separate
 * open PRs, either of which may merge first — importing across the unmerged branch would break this
 * branch's build. So the algorithm is duplicated and both sides LOCK it to identical literal outputs in
 * their unit tests (`reader-morph.test.ts` here mirrors `library-card.test.ts`'s `morphName` cases:
 * `'abc123' → 'lesson-card-abc123'`, `'a:b/c.d' → 'lesson-card-a-b-c-d'`), so the two can't silently
 * drift — a change to one side that doesn't match the shared literal contract fails a test. Once both
 * land, a follow-up may collapse this to a single shared module (a `drift:docs`-style cleanup, not a
 * blocker).
 *
 * The id is sanitized to a valid CSS `<custom-ident>` — `[A-Za-z0-9_-]` only — and prefixed with a
 * constant so the ident can never start with a digit (an ident must not).
 */
export function morphName(id: string): string {
  return `lesson-card-${id.replace(/[^A-Za-z0-9_-]/g, '-')}`;
}
