import { describe, expect, it } from 'vitest';
import { resolveMissingLessonBranch } from './lesson-route';

// ── issue #202 AC31: the branch page.tsx renders when `getLesson` returns null ──────────────────────────
// The full order (byte-pinned by AC31) is: `getLesson` null → `ownsRun`? generating : (`getOwnedDeletedLesson`?
// friendly-deleted : notFound()). `getLesson` itself, and the pre-existing `hasLesson` branch, are
// UNCHANGED by #202 — this resolver covers only the NEW three-way decision inside the `!view` branch, so
// it is testable with plain mocked booleans/objects (no DB, no Next.js runtime, no async I/O).

describe('resolveMissingLessonBranch', () => {
  it('resolves to "generating" when the caller owns an in-flight run — checked FIRST (AC31)', () => {
    expect(resolveMissingLessonBranch({ ownsRun: true, deletedLesson: null })).toBe('generating');
  });

  it('resolves to "generating" even when a deletedLesson is ALSO present (ownsRun wins — order matters)', () => {
    // Can't really co-occur in practice, but the order is the load-bearing contract (AC31), not the data.
    expect(
      resolveMissingLessonBranch({ ownsRun: true, deletedLesson: { id: 'x', topic: 'Fourier transforms' } }),
    ).toBe('generating');
  });

  it('resolves to "friendly-deleted" when not owning a run AND the caller owns a soft-deleted lesson', () => {
    expect(
      resolveMissingLessonBranch({ ownsRun: false, deletedLesson: { id: 'x', topic: 'Fourier transforms' } }),
    ).toBe('friendly-deleted');
  });

  it('resolves to "not-found" when neither an in-flight run nor a soft-deleted lesson is owned', () => {
    // Covers: a genuinely absent id, a foreign-owned id, and a not-soft-deleted-for-this-owner id alike —
    // `getOwnedDeletedLesson`'s own contract already collapses all three to `null` (no existence oracle),
    // so this resolver just needs to treat `null` uniformly (AC35).
    expect(resolveMissingLessonBranch({ ownsRun: false, deletedLesson: null })).toBe('not-found');
  });
});
