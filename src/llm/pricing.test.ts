import { describe, expect, it } from 'vitest';
import { BATCH_DISCOUNT, estimateBatchCostUsd, estimateCostUsd, MODEL_PRICING, pricingAgeDays } from './pricing';

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

describe('estimateBatchCostUsd (issue #188 — the Batch API 50% discount)', () => {
  it('records exactly half the synchronous rate for a no-cache call', () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 200_000 };
    const sync = estimateCostUsd('anthropic:claude-opus-4-8', usage);
    const batch = estimateBatchCostUsd('anthropic:claude-opus-4-8', usage);
    expect(batch).toBeCloseTo(sync * BATCH_DISCOUNT, 9);
    expect(batch).toBeCloseTo(sync / 2, 9); // the discount the trace ledger must reflect, not 2× the bill
  });

  it('prices a 1-hour cache WRITE at 2× base input and a cache READ at 0.1× — both under the batch discount', () => {
    // Opus base input $5/MTok. 1M cache-write @ 2× = $10; 1M cache-read @ 0.1× = $0.50; then ×0.5 batch.
    const writeOnly = estimateBatchCostUsd('anthropic:claude-opus-4-8', {
      inputTokens: 0,
      outputTokens: 0,
      cacheWriteTokens: 1_000_000,
    });
    expect(writeOnly).toBeCloseTo((5 * 2) * 0.5, 9); // $5.00
    const readOnly = estimateBatchCostUsd('anthropic:claude-opus-4-8', {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 1_000_000,
    });
    expect(readOnly).toBeCloseTo((5 * 0.1) * 0.5, 9); // $0.25 — NOT the 1.25× 5-minute write rate
  });

  it('throws on an unpriced model so a batched $0 cost can never be silent', () => {
    expect(() => estimateBatchCostUsd('openai:gpt-x', { inputTokens: 1, outputTokens: 1 })).toThrow(/No pricing/);
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
