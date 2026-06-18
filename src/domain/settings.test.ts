import { describe, expect, it } from 'vitest';
import { bucketize } from './settings';

describe('bucketize', () => {
  it('buckets on level + depth band, ignoring audience', () => {
    const a = bucketize({ level: 'intro', depth: 2, audience: 'devs' });
    const b = bucketize({ level: 'intro', depth: 2, audience: 'students' });
    expect(a).toBe(b);
    expect(a).toBe('intro:d2');
  });

  it('clamps depth into 1..5 and rounds', () => {
    expect(bucketize({ level: 'advanced', depth: 9, audience: '' })).toBe('advanced:d5');
    expect(bucketize({ level: 'advanced', depth: 0, audience: '' })).toBe('advanced:d1');
    expect(bucketize({ level: 'advanced', depth: 2.6, audience: '' })).toBe('advanced:d3');
  });

  it('defaults non-finite depth to 3', () => {
    expect(bucketize({ level: 'intro', depth: NaN, audience: '' })).toBe('intro:d3');
  });
});
