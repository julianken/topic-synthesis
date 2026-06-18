import { describe, expect, it } from 'vitest';
import { estimateCostUsd, MODEL_PRICING } from './pricing';

describe('estimateCostUsd', () => {
  it('prices input + output at the model rate', () => {
    // 1M input @ $5 + 1M output @ $25 = $30 on Opus 4.8
    expect(
      estimateCostUsd('claude-opus-4-8', { inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    ).toBeCloseTo(30, 6);
  });

  it('prices cache reads at 0.1x input and writes at 1.25x', () => {
    const cost = estimateCostUsd('claude-sonnet-4-6', {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 1_000_000, // 0.1 * $3 = $0.30
      cacheCreationInputTokens: 1_000_000, // 1.25 * $3 = $3.75
    });
    expect(cost).toBeCloseTo(0.3 + 3.75, 6);
  });

  it('throws on an unknown model', () => {
    expect(() => estimateCostUsd('gpt-4', { inputTokens: 1, outputTokens: 1 })).toThrow(/No pricing/);
  });

  it('has pricing for every tier model', () => {
    for (const id of ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5']) {
      expect(MODEL_PRICING[id]).toBeDefined();
    }
  });
});
