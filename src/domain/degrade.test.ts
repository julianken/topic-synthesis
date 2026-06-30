import { describe, expect, it } from 'vitest';
import { DEGRADE_DETAIL_MAX, truncateDegradeDetail } from './degrade';

describe('truncateDegradeDetail (#214 — the operator-only detail bound)', () => {
  it('DEGRADE_DETAIL_MAX is a named bound (500)', () => {
    expect(DEGRADE_DETAIL_MAX).toBe(500);
  });

  it('leaves a detail at or under the cap untouched', () => {
    expect(truncateDegradeDetail('short')).toBe('short');
    const atCap = 'x'.repeat(DEGRADE_DETAIL_MAX);
    expect(truncateDegradeDetail(atCap)).toBe(atCap);
    expect(truncateDegradeDetail('')).toBe('');
  });

  it('cuts a detail longer than the cap to EXACTLY the cap (never logged unbounded)', () => {
    const long = 'y'.repeat(DEGRADE_DETAIL_MAX + 250);
    const out = truncateDegradeDetail(long);
    expect(out).toHaveLength(DEGRADE_DETAIL_MAX);
    expect(out).toBe('y'.repeat(DEGRADE_DETAIL_MAX));
  });
});
