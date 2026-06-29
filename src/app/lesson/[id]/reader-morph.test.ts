import { describe, expect, it } from 'vitest';
import { morphName } from './reader-morph';

// ── The card→reader FLIP-endpoint contract (TS-20 ↔ TS-17) ──────────────────────────────────────────
// The reader panel's `view-transition-name` (DESTINATION) must equal the name TS-17 stamps on each
// library card (ORIGIN) for the SAME lesson id — a cross-document View-Transition only pairs old/new
// snapshots when the names are IDENTICAL. TS-17 and TS-20 ship in separate PRs, so each side duplicates
// the algorithm and LOCKS it to the same literal outputs here: these expected strings are byte-for-byte
// the ones `src/app/library-card.test.ts` asserts for its `morphName`, so the two endpoints can't drift.
describe('reader-morph — the card→reader view-transition-name DESTINATION endpoint (TS-20 → TS-21)', () => {
  it('derives the SAME id-scoped name TS-17 stamps on the card, so origin and destination pair', () => {
    // Identical to library-card.test.ts's `morphName('abc123')` → 'lesson-card-abc123'.
    expect(morphName('abc123')).toBe('lesson-card-abc123');
  });

  it('sanitizes ids to a valid CSS <custom-ident> identically to the card side (no chars outside [A-Za-z0-9_-])', () => {
    // Identical to library-card.test.ts: a uuid-with-colon or slashy id maps to the same ident.
    expect(morphName('a:b/c.d')).toBe('lesson-card-a-b-c-d');
    // the constant prefix means the ident never starts with a digit
    expect(morphName('9z')).toMatch(/^lesson-card-/);
    expect(morphName('any')).not.toMatch(/[^A-Za-z0-9_-]/);
  });

  it('is distinct per lesson id (each reader box is its own morph endpoint)', () => {
    expect(morphName('one')).not.toBe(morphName('two'));
  });
});
