/**
 * The `page.tsx` "missing lesson" branch resolution (issue #202, AC31) — the pure decision `page.tsx`'s
 * `!view` branch makes once `getLesson` has already returned `null`. Extracted so the branch ORDER —
 * `ownsRun`? generating : (`getOwnedDeletedLesson`? friendly-deleted : notFound()) — unit-tests without a
 * live DB or the Next.js server-component runtime (mirrors the `library-delete.ts` / `reader-morph-guard.ts`
 * precedent: pure logic in a `.ts` module, the `.tsx`/route file stays a thin caller).
 *
 * Scope: this covers ONLY the branch inside `!view` (three-way: generating / friendly-deleted / not-found).
 * The pre-existing `view` (lesson-found) branch is unchanged by #202 and isn't part of this decision.
 */

export type MissingLessonBranch = 'generating' | 'friendly-deleted' | 'not-found';

/**
 * Resolve which of the three `!view` branches `page.tsx` should render, given the two owner-scoped reads
 * it already performs (`ownsRun`, `getOwnedDeletedLesson`). `ownsRun` is checked FIRST — an in-flight run
 * always wins even in the (practically impossible) case both are truthy, matching AC31's literal order.
 * `deletedLesson` is `null` for a genuinely absent id, a foreign-owned id, and a not-currently-deleted id
 * alike (per `getOwnedDeletedLesson`'s own no-existence-oracle contract) — this resolver treats `null`
 * uniformly, so all three degrade to the same `not-found` (AC35).
 */
export function resolveMissingLessonBranch(input: {
  ownsRun: boolean;
  deletedLesson: unknown;
}): MissingLessonBranch {
  if (input.ownsRun) return 'generating';
  if (input.deletedLesson) return 'friendly-deleted';
  return 'not-found';
}
