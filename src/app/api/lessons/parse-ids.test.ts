import { describe, expect, it } from 'vitest';
import { MAX_BULK_IDS, parseIds } from './parse-ids';

// The bounded-body contract both POST routes (bulk-delete + restore, #199) share. Tested directly here
// so the route tests can lean on it being correct (they assert the route's 400 branch wires to it).
describe('parseIds — the shared 1..100 non-empty-string body contract (#199)', () => {
  it('rejects a non-object body (null, primitive, array)', () => {
    expect(parseIds(null)).toBeNull();
    expect(parseIds(undefined)).toBeNull();
    expect(parseIds(42)).toBeNull();
    expect(parseIds('ids')).toBeNull();
    // A bare array is not the `{ ids }` envelope.
    expect(parseIds(['a', 'b'])).toBeNull();
  });

  it('rejects a missing or non-array ids field', () => {
    expect(parseIds({})).toBeNull();
    expect(parseIds({ ids: 'a' })).toBeNull();
    expect(parseIds({ ids: 7 })).toBeNull();
    expect(parseIds({ ids: { 0: 'a' } })).toBeNull();
  });

  it('rejects an empty ids array', () => {
    expect(parseIds({ ids: [] })).toBeNull();
  });

  it('rejects a non-string or empty-string entry', () => {
    expect(parseIds({ ids: ['ok', 1] })).toBeNull();
    expect(parseIds({ ids: ['ok', null] })).toBeNull();
    expect(parseIds({ ids: ['ok', ''] })).toBeNull();
  });

  it('rejects an over-cap array (length > MAX_BULK_IDS) but accepts exactly the cap', () => {
    const overCap = Array.from({ length: MAX_BULK_IDS + 1 }, (_, i) => `id-${i}`);
    expect(parseIds({ ids: overCap })).toBeNull();
    const atCap = Array.from({ length: MAX_BULK_IDS }, (_, i) => `id-${i}`);
    expect(parseIds({ ids: atCap })).toEqual(atCap);
  });

  it('returns the validated array for a well-formed body (ignoring extra fields)', () => {
    expect(parseIds({ ids: ['a'] })).toEqual(['a']);
    expect(parseIds({ ids: ['a', 'b', 'c'], extra: 'ignored' })).toEqual(['a', 'b', 'c']);
  });
});
