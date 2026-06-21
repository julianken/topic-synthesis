import { describe, expect, it } from 'vitest';
import { contentHash, contentIdentityKey, slugify } from './identity';

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

describe('slugify (the single-lesson path keys synthesis on this)', () => {
  it('is deterministic and URL-safe (lowercase, hyphen-joined)', () => {
    expect(slugify('The Fourier Transform')).toBe('the-fourier-transform');
    expect(slugify('The Fourier Transform')).toBe(slugify('The Fourier Transform'));
  });

  it('collapses punctuation/whitespace runs and trims edge hyphens', () => {
    expect(slugify('  C++  &  Rust!! ')).toBe('c-rust');
    expect(slugify('a---b')).toBe('a-b');
  });

  it('strips diacritics so the slug stays ASCII', () => {
    expect(slugify('Café Crème')).toBe('cafe-creme');
  });

  it('falls back to "lesson" when the input slugs to empty (never a blank key)', () => {
    expect(slugify('!!!')).toBe('lesson');
    expect(slugify('')).toBe('lesson');
  });
});
