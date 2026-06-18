import { describe, expect, it } from 'vitest';
import { contentHash, contentIdentityKey } from './identity';

describe('contentHash', () => {
  it('is deterministic for the same parts', () => {
    expect(contentHash('a', 'b')).toBe(contentHash('a', 'b'));
  });

  it('is delimiter-safe: ["ab","c"] differs from ["a","bc"]', () => {
    expect(contentHash('ab', 'c')).not.toBe(contentHash('a', 'bc'));
  });

  it('returns 64 lowercase hex chars (sha256)', () => {
    expect(contentHash('x')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('contentIdentityKey', () => {
  it('composes concept, bucket, and a 16-char hash prefix', () => {
    const key = contentIdentityKey({
      conceptSlug: 'la-matmul',
      settingsBucket: 'intro:d2',
      contentHash: 'deadbeef'.repeat(8),
    });
    expect(key).toBe('la-matmul@intro:d2#deadbeefdeadbeef');
  });
});
