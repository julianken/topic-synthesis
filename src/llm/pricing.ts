/**
 * Local pricing map (USD per 1M tokens). Cost is NOT derivable from token counts
 * by any external standard, so the producer injects it here. Rates from the
 * claude-api skill (cached 2026-06-04); update when Anthropic pricing changes.
 */
export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-8': { inputPerMTok: 5, outputPerMTok: 25 },
  'claude-sonnet-4-6': { inputPerMTok: 3, outputPerMTok: 15 },
  'claude-haiku-4-5': { inputPerMTok: 1, outputPerMTok: 5 },
};

/**
 * Token usage as returned by the Anthropic Messages API. `inputTokens` is the
 * UNCACHED remainder; cache reads/writes bill at a fraction of the input rate.
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

const PER_MTOK = 1_000_000;
// Cache reads ~0.1x base input price; 5-minute cache writes ~1.25x (claude-api skill).
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

export function estimateCostUsd(model: string, usage: TokenUsage): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) throw new Error(`No pricing configured for model "${model}"`);
  const input = (usage.inputTokens / PER_MTOK) * pricing.inputPerMTok;
  const output = (usage.outputTokens / PER_MTOK) * pricing.outputPerMTok;
  const cacheRead =
    ((usage.cacheReadInputTokens ?? 0) / PER_MTOK) * pricing.inputPerMTok * CACHE_READ_MULTIPLIER;
  const cacheWrite =
    ((usage.cacheCreationInputTokens ?? 0) / PER_MTOK) * pricing.inputPerMTok * CACHE_WRITE_MULTIPLIER;
  return input + output + cacheRead + cacheWrite;
}
