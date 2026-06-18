import { describe, expect, it } from 'vitest';
import { estimateCostUsd, MODEL_PRICING, pricingAgeDays } from './pricing';

describe('estimateCostUsd', () => {
  it('prices input + output at the provider:model rate', () => {
    // 1M input @ $5 + 1M output @ $25 = $30 on Opus 4.8
    expect(estimateCostUsd('anthropic:claude-opus-4-8', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(30, 6);
    expect(estimateCostUsd('anthropic:claude-sonnet-4-6', { inputTokens: 1_000_000, outputTokens: 0 })).toBeCloseTo(3, 6);
  });

  it('throws on an unpriced model so a $0 cost can never be silent', () => {
    expect(() => estimateCostUsd('openai:gpt-x', { inputTokens: 1, outputTokens: 1 })).toThrow(/No pricing/);
  });

  it('keys pricing by provider:model', () => {
    expect(MODEL_PRICING['anthropic:claude-opus-4-8']).toBeDefined();
    expect(MODEL_PRICING['claude-opus-4-8']).toBeUndefined();
  });
});

describe('pricing staleness alarm', () => {
  it('flags a snapshot older than 90 days (the CI refresh trigger)', () => {
    expect(
      pricingAgeDays(),
      'pricing snapshot is stale (>90d) — refresh MODEL_PRICING + PRICING_CACHED_AT',
    ).toBeLessThan(90);
  });
});
