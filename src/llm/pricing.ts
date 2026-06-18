export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
}

/**
 * The cost-of-record: USD per 1M tokens, keyed by "<provider>:<model>". Cost is
 * not standardized across providers, so we compute it here from token usage.
 *
 * OWNER: unassigned (set in `.github/CODEOWNERS` as a follow-up). Refresh when any
 * provider's rates change; `pricingAgeDays()` + the staleness test fail the build
 * if this snapshot drifts past 90 days. Anthropic rates from the `claude-api`
 * skill. OpenAI / Google / local entries are added with VERIFIED rates the first
 * time an arm uses them — `estimateCostUsd` throws on a missing key so an unpriced
 * model can never silently cost $0 in an eval ledger.
 */
export const PRICING_CACHED_AT = '2026-06-18';

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'anthropic:claude-opus-4-8': { inputPerMTok: 5, outputPerMTok: 25 },
  'anthropic:claude-sonnet-4-6': { inputPerMTok: 3, outputPerMTok: 15 },
  'anthropic:claude-haiku-4-5': { inputPerMTok: 1, outputPerMTok: 5 },
};

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

const PER_MTOK = 1_000_000;

export function estimateCostUsd(providerModel: string, usage: TokenUsage): number {
  const pricing = MODEL_PRICING[providerModel];
  if (!pricing) {
    throw new Error(`No pricing configured for "${providerModel}" — add a verified rate to MODEL_PRICING.`);
  }
  return (usage.inputTokens / PER_MTOK) * pricing.inputPerMTok + (usage.outputTokens / PER_MTOK) * pricing.outputPerMTok;
}

/** Age (in days) of the pricing snapshot — the CI staleness alarm asserts this stays under 90. */
export function pricingAgeDays(now: number = Date.now()): number {
  return (now - Date.parse(PRICING_CACHED_AT)) / 86_400_000;
}
