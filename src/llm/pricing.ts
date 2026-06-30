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

/**
 * The Anthropic Message Batches discount: 50% off BOTH input and output tokens vs the synchronous
 * `MODEL_PRICING` rate (verified — the batch rate is exactly half the snapshot above). Exported so a
 * test can assert a batched call records ~half `estimateCostUsd` for the same tokens (issue #188).
 */
export const BATCH_DISCOUNT = 0.5;

/**
 * Prompt-caching multipliers (relative to the BASE input rate). The 1-hour TTL cache WRITE is 2× base
 * input — NOT 1.25×, which is the 5-minute TTL — and a cache READ (hit) is 0.1× base input. The batch
 * sweep stacks 1-hour caching on the shared judge prefix, so these are the rates the ledger must use.
 */
const CACHE_WRITE_1H_MULTIPLIER = 2;
const CACHE_READ_MULTIPLIER = 0.1;

/** Batch usage carries the cache-creation/read token splits the synchronous path never sees. The plain
 *  `inputTokens` is the UNCACHED remainder (Anthropic reports cache tokens separately), so the three
 *  input buckets don't overlap. */
export interface BatchTokenUsage extends TokenUsage {
  /** 1-hour-TTL cache-creation (write) tokens — priced at 2× base input before the batch discount. */
  cacheWriteTokens?: number;
  /** cache-hit (read) tokens — priced at 0.1× base input before the batch discount. */
  cacheReadTokens?: number;
}

/**
 * Cost of one BATCHED call: the synchronous per-token rate scaled by the 50% batch discount, with the
 * cache buckets priced at their own 1-hour multipliers (write 2×, read 0.1× of base input) — also under
 * the discount. A call with no cache tokens lands at exactly `BATCH_DISCOUNT × estimateCostUsd(...)`, so
 * the saving the feature exists to demonstrate actually appears in the trace ledger (issue #188). Throws
 * on an unpriced model, mirroring `estimateCostUsd`, so a batched call can never silently cost $0.
 */
export function estimateBatchCostUsd(providerModel: string, usage: BatchTokenUsage): number {
  const pricing = MODEL_PRICING[providerModel];
  if (!pricing) {
    throw new Error(`No pricing configured for "${providerModel}" — add a verified rate to MODEL_PRICING.`);
  }
  const uncachedInput = (usage.inputTokens / PER_MTOK) * pricing.inputPerMTok;
  const cacheWrite = ((usage.cacheWriteTokens ?? 0) / PER_MTOK) * pricing.inputPerMTok * CACHE_WRITE_1H_MULTIPLIER;
  const cacheRead = ((usage.cacheReadTokens ?? 0) / PER_MTOK) * pricing.inputPerMTok * CACHE_READ_MULTIPLIER;
  const output = (usage.outputTokens / PER_MTOK) * pricing.outputPerMTok;
  return (uncachedInput + cacheWrite + cacheRead + output) * BATCH_DISCOUNT;
}

/** Age (in days) of the pricing snapshot — the CI staleness alarm asserts this stays under 90. */
export function pricingAgeDays(now: number = Date.now()): number {
  return (now - Date.parse(PRICING_CACHED_AT)) / 86_400_000;
}
