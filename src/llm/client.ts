import { anthropic } from '@ai-sdk/anthropic';
import { generateText, Output, streamText, type LanguageModel } from 'ai';
import type { ZodType } from 'zod';
import type { StageModel } from './models';
import { registryId } from './models';
import { estimateCostUsd } from './pricing';
import { resolveModel } from './registry';

/** One LLM call's trace row (the unit eleatic's `llm_call` table will store). */
export interface LlmCallRecord {
  providerModel: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** Raw provider usage retained verbatim so cost can be recomputed at corrected rates. */
  rawUsage: unknown;
  finishReason: string;
  /**
   * Per-call WALL-CLOCK + size, present ONLY for a STREAMED call (`streamComplete`, the `code` stage,
   * PR-1) — the blocking `complete`/`completeObject`/`searchWeb` leave them `undefined`. `ttftMs` is
   * time-to-first-token (prefill/think); `genMs` is generation (total − ttft); `maxTokens` is the
   * request cap (cap-proximity); `outputBytes` is the emitted text length. eleatic ignores these by
   * default (the trace seam omits wall-clock); the #167 dashboard (PR-2) + eleatic (PR-3) opt in.
   */
  ttftMs?: number;
  genMs?: number;
  maxTokens?: number;
  outputBytes?: number;
}

export interface CompleteOptions {
  model: StageModel;
  prompt: string;
  system?: string;
  maxTokens?: number;
  /**
   * Total-elapsed deadline (ms) for a STREAMED call (`streamComplete` only — the blocking paths
   * ignore it). Defaults to `DEFAULT_CODE_DEADLINE_MS`. On a stall the call aborts (un-retried) and
   * the run degrades to 'soon' rather than re-billing a slow generation (issue #186).
   */
  deadlineMs?: number;
}

export interface TextResult {
  text: string;
  record: LlmCallRecord;
}

export interface ObjectResult<T> {
  object: T;
  record: LlmCallRecord;
}

function recordFrom(
  providerModel: string,
  usage: { inputTokens: number | undefined; outputTokens: number | undefined },
  finishReason: string,
): LlmCallRecord {
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  return {
    providerModel,
    inputTokens,
    outputTokens,
    costUsd: estimateCostUsd(providerModel, { inputTokens, outputTokens }),
    rawUsage: usage,
    finishReason,
  };
}

// Every downstream stage trusts this wrapper, so partial or unreliable output would
// surface as an unexplained parse failure. Fail loud on anything but a clean finish.
function guard(finishReason: string, providerModel: string, maxTokens: number): void {
  if (finishReason === 'length') {
    throw new Error(`"${providerModel}" hit the output cap (${maxTokens}); output is truncated. Raise maxTokens.`);
  }
  if (finishReason === 'content-filter') {
    throw new Error(`"${providerModel}" response was content-filtered; discard any partial output.`);
  }
  // Allowlist the clean completions: 'stop' (normal) and 'tool-calls' (Output.object can
  // finish structured output via a forced tool call). Everything else — 'error', 'other',
  // 'unknown' — means partial/unreliable output, so fail loud rather than pass it downstream.
  if (finishReason !== 'stop' && finishReason !== 'tool-calls') {
    throw new Error(`"${providerModel}" ended with an unexpected finish reason "${finishReason}"; discard output.`);
  }
}

/** A free-text completion. Pass `modelOverride` (a mock) in tests to avoid a live call. */
export async function complete(opts: CompleteOptions, modelOverride?: LanguageModel): Promise<TextResult> {
  const providerModel = registryId(opts.model);
  const maxTokens = opts.maxTokens ?? 8000;
  const result = await generateText({
    model: modelOverride ?? resolveModel(opts.model),
    prompt: opts.prompt,
    maxOutputTokens: maxTokens,
    ...(opts.system !== undefined ? { system: opts.system } : {}),
  });
  guard(result.finishReason, providerModel, maxTokens);
  return { text: result.text, record: recordFrom(providerModel, result.usage, result.finishReason) };
}

/**
 * Total-elapsed deadline (ms) for the streamed `code` call. A stall is the single most expensive
 * failure on the pipeline: with no cap the AI SDK would re-run the full ~15K-token generation up to
 * 3× (default `maxRetries: 2`) and the Cloud Run Job would retry once more, re-billing the run's
 * priciest call (~$0.228) several times before degrading (the BPD incident burned 908 s ≈ 3×300 s
 * this way). Retrying a *slow* (vs *failing*) non-idempotent generation can never succeed; it only
 * re-bills. So we abort fast and cheap into the existing degrade-to-'soon' net (issue #186).
 *
 * Value (480_000 = 8 min) is anchored on the OBSERVED healthy code-phase band — ~210–270 s max,
 * i.e. ≈83% of a ~326 s run's wall-clock — plus a generous tail margin (~1.8× the observed max), so a
 * legitimately-slow-but-healthy generation is NEVER aborted. It sits comfortably under the 3600 s
 * Cloud Run Job task timeout (`infra/cloud-run.tf:95`) — 480 s is ~13% of it, leaving >3000 s of
 * headroom — so this deadline, not the outer Job timeout, is what bounds a stalled `code` call.
 */
export const DEFAULT_CODE_DEADLINE_MS = 480_000;

/**
 * A STREAMING free-text completion — the `code` stage's path. Streaming is what lets us capture
 * per-call WALL-CLOCK: `ttftMs` (time to the first text delta = prefill/think) and `genMs`
 * (generation = total − ttft), plus `maxTokens` (cap-proximity) and `outputBytes` (size). It also
 * exposes a periodic `onProgress` hook — the live code-phase progress feed (PR-1 only EMITS it; PR-4
 * consumes it). The `guard(finishReason)` truncation/abort check is preserved exactly as on the
 * blocking path. Pass `modelOverride` (a mock streaming model) in tests, mirroring `complete`.
 *
 * Two failure-cost guards on the `streamText` call (issue #186): `maxRetries: 0` so a stalled or
 * failing establishment is NEVER blindly re-billed (the AI SDK `maxRetries` is a flat count over all
 * retryable errors — there is no "retry only transient 429/529"; the jittered transient-retry policy
 * is #187's job, layered ABOVE this single-attempt inner call), and `abortSignal:
 * AbortSignal.timeout(deadlineMs)` as the single binding TOTAL-elapsed cap (with streaming, undici's
 * `headersTimeout` is satisfied at prefill and `bodyTimeout` guards only inter-chunk gaps, so neither
 * bounds total elapsed — the AbortSignal is the real ceiling). On abort the stream ends and the
 * subsequent `await result.finishReason` rejects with the `TimeoutError`, propagating UN-retried
 * through `code` → `synthesizeLesson`'s catch → degrade-to-'soon' (no crash, no re-bill).
 */
export async function streamComplete(
  opts: CompleteOptions,
  // PR-4 (#180): `maxTokens` (the resolved request cap) rides the per-delta payload so a consumer can
  // compute a bounded fraction WITHOUT re-hardcoding the cap — the live code-phase progress sink divides
  // `outputTokens / maxTokens` server-side. The cap stays the caller's single source (code.ts sets 32000).
  onProgress?: (p: { outputTokens: number; elapsedMs: number; phase: 'prefill' | 'generating'; maxTokens: number }) => void,
  modelOverride?: LanguageModel,
): Promise<TextResult> {
  const providerModel = registryId(opts.model);
  const maxTokens = opts.maxTokens ?? 8000;
  const startMs = Date.now();
  const result = streamText({
    model: modelOverride ?? resolveModel(opts.model),
    prompt: opts.prompt,
    maxOutputTokens: maxTokens,
    // Fail fast + cheap on a stall: never blindly re-bill (retries are #187's job, one layer up), and
    // bound TOTAL elapsed with an explicit deadline. A timeout aborts un-retried → degrade-to-'soon'.
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(opts.deadlineMs ?? DEFAULT_CODE_DEADLINE_MS),
    ...(opts.system !== undefined ? { system: opts.system } : {}),
  });
  let ttftMs: number | undefined;
  let text = '';
  for await (const delta of result.textStream) {
    if (ttftMs === undefined) ttftMs = Date.now() - startMs; // first delta = end of prefill
    text += delta;
    // ~4 chars/token estimate for the live budget-burn bar; the EXACT outputTokens lands at finish.
    onProgress?.({ outputTokens: Math.round(text.length / 4), elapsedMs: Date.now() - startMs, phase: 'generating', maxTokens });
  }
  const totalMs = Date.now() - startMs;
  const finishReason = await result.finishReason;
  guard(finishReason, providerModel, maxTokens);
  const ttft = ttftMs ?? totalMs; // no delta (empty output) → the whole call was prefill
  const record = recordFrom(providerModel, await result.usage, finishReason);
  record.ttftMs = ttft;
  record.genMs = Math.max(0, totalMs - ttft);
  record.maxTokens = maxTokens;
  record.outputBytes = text.length;
  return { text, record };
}

/** A schema-validated structured completion (typed JSON per stage). */
export async function completeObject<T>(
  opts: CompleteOptions & { schema: ZodType<T> },
  modelOverride?: LanguageModel,
): Promise<ObjectResult<T>> {
  const providerModel = registryId(opts.model);
  const maxTokens = opts.maxTokens ?? 8000;
  const result = await generateText({
    model: modelOverride ?? resolveModel(opts.model),
    prompt: opts.prompt,
    maxOutputTokens: maxTokens,
    output: Output.object({ schema: opts.schema }),
    ...(opts.system !== undefined ? { system: opts.system } : {}),
  });
  guard(result.finishReason, providerModel, maxTokens);
  return { object: result.output as T, record: recordFrom(providerModel, result.usage, result.finishReason) };
}

/** A real retrieved web source (the authoritative citation list for grounded findings). */
export interface WebSource {
  url: string;
  title: string;
}

export interface SearchResult {
  /** The model's grounded synthesis text. */
  text: string;
  /** Sources actually retrieved by the search — never let a later stage invent these. */
  sources: WebSource[];
  record: LlmCallRecord;
}

/**
 * A web-grounded completion using Anthropic's server-side web_search tool, so the
 * model cites real retrieved pages instead of inventing sources (the pipeline's #1
 * risk). Web search is provider-specific, so this path is Anthropic-only — the
 * researcher stage runs on an Anthropic model. Returns the grounded text plus the
 * real retrieved sources. Pass `modelOverride` (a mock) in tests to avoid a live call.
 *
 * Uses the `webSearch_20250305` tool, which calls the search DIRECTLY (the model emits
 * the tool use). The newer `webSearch_20260209` requires programmatic tool calling,
 * which only the larger models support (Haiku 4.5 rejects it) — direct calling works on
 * every Anthropic model, so a cheaper researcher tier stays a valid workflow-version arm.
 */
export async function searchWeb(
  opts: CompleteOptions & { maxSearches?: number },
  modelOverride?: LanguageModel,
): Promise<SearchResult> {
  const providerModel = registryId(opts.model);
  const maxTokens = opts.maxTokens ?? 8000;
  const result = await generateText({
    model: modelOverride ?? resolveModel(opts.model),
    prompt: opts.prompt,
    maxOutputTokens: maxTokens,
    tools: { web_search: anthropic.tools.webSearch_20250305({ maxUses: opts.maxSearches ?? 5 }) },
    ...(opts.system !== undefined ? { system: opts.system } : {}),
  });
  guard(result.finishReason, providerModel, maxTokens);
  const sources: WebSource[] = result.sources
    .filter((s) => s.sourceType === 'url')
    .map((s) => ({ url: s.url, title: s.title ?? s.url }));
  return { text: result.text, sources, record: recordFrom(providerModel, result.usage, result.finishReason) };
}
