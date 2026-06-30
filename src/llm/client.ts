import { anthropic } from '@ai-sdk/anthropic';
import { APICallError, generateText, Output, streamText, type LanguageModel } from 'ai';
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
  /**
   * An EXTERNAL total-elapsed deadline for a STREAMED call (`streamComplete` only). When set it is used
   * as the inner call's `abortSignal` INSTEAD of the self-minted `AbortSignal.timeout(deadlineMs)` — so a
   * resilient-retry wrapper (issue #187) can create ONE deadline and SHARE it across every retry attempt
   * + backoff, making total elapsed bound by a single deadline rather than resetting per attempt. With no
   * `signal` the #186 behavior is unchanged (a fresh per-call timeout derived from `deadlineMs`).
   */
  signal?: AbortSignal;
  /**
   * Opt-in LENGTH-retry cap for the `code` stage (`streamComplete` only, issue #187). When the stream
   * finishes with `finishReason === 'length'` (a truncation — the page nearly fit), streamComplete makes
   * exactly ONE more attempt at this raised cap (the caller bounds it < the model's 64K output cap) before
   * `guard` throws → degrade-to-'soon'. ONLY 'length' qualifies — a `content-filter`/unexpected finish is
   * non-retryable and is NOT re-billed at the raised cap. Unset (the default) = no length-retry.
   */
  retryAtMaxTokens?: number;
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

/**
 * Options for {@link withResilientRetry}. The delay + RNG are INJECTABLE so a test is fully
 * deterministic (no real timers, no `Math.random`) — pass `sleep`/`random` to seed them.
 */
export interface ResilientRetryOptions {
  /** Max total attempts (the first try + retries). Default 3 (≈2 retries). */
  maxAttempts?: number;
  /** Full-jitter base (ms). Default 500. */
  baseDelayMs?: number;
  /** Full-jitter window cap (ms) — a single backoff never exceeds this. Default 8000. */
  capDelayMs?: number;
  /**
   * Total-elapsed deadline. The backoff sleep is bounded by it AND retries stop the moment it fires, so
   * total retry time never exceeds the caller's deadline (issue #187 — the `code` call shares ONE signal
   * across every attempt + backoff). Typically the same `AbortSignal` passed into the wrapped call.
   */
  signal?: AbortSignal;
  /**
   * Absolute cap (ms) on an HONORED 429 `Retry-After`, so an arbitrarily large server value can never
   * cause an unbounded sleep — important for a caller without a `signal` deadline (the streamed `code`
   * caller always passes one, but this helper is reused by #189). Default 60_000 (60s). The jitter branch
   * is already bounded by `capDelayMs`; this caps the otherwise-unbounded server-supplied wait.
   */
  retryAfterCapMs?: number;
  /** Injected RNG in [0,1). Default `Math.random`. */
  random?: () => number;
  /** Injected delay (abortable). Default a real `setTimeout` that resolves early when `signal` fires. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

type RetryDecision =
  | { kind: 'rethrow' }
  | { kind: 'jitter' }
  | { kind: 'retry-after'; retryAfterMs: number };

/** Read a header case-insensitively (provider maps are normally lowercased, but don't assume). */
function readHeader(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

/** Parse an HTTP `Retry-After` value — delta-seconds OR an HTTP-date — into ms-from-now (clamped ≥0). */
function parseRetryAfterMs(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000; // delta-seconds
  const at = Date.parse(trimmed); // HTTP-date form
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

/**
 * Classify a thrown error for the resilient-retry policy:
 * - `429` (rate-limited) → retry, honoring `Retry-After` when the server sent one (else full-jitter);
 * - `529` (Anthropic overloaded) / any `5xx` → retry with full-jitter, NEVER trusting a Retry-After
 *   (an overloaded server's retry-after is unreliable — jitter spreads the thundering herd instead);
 * - everything else (a non-retryable 4xx client error, a non-`APICallError`, an abort/timeout) → rethrow.
 */
function classifyRetry(err: unknown): RetryDecision {
  if (!APICallError.isInstance(err)) return { kind: 'rethrow' };
  const status = err.statusCode;
  if (status === 429) {
    const ms = parseRetryAfterMs(readHeader(err.responseHeaders, 'retry-after'));
    return ms !== undefined ? { kind: 'retry-after', retryAfterMs: ms } : { kind: 'jitter' };
  }
  if (status !== undefined && (status === 529 || (status >= 500 && status < 600))) {
    return { kind: 'jitter' };
  }
  return { kind: 'rethrow' };
}

/** Full-jitter backoff `random(0, min(cap, base·2^attempt))` (AWS Builders' Library formula). */
function fullJitterMs(base: number, cap: number, attempt: number, random: () => number): number {
  return random() * Math.min(cap, base * 2 ** attempt);
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Wrap a single LLM call with a bounded, jittered retry for the TRANSIENT failure class ONLY. This is
 * the ONE retry layer ABOVE the SDK's own `maxRetries: 0` (issue #186) — it never double-stacks. It is
 * the shared primitive reused by the streamed `code` call (#187) and the research fan-out (#189);
 * whichever lands first owns it, the other consumes it. Retries `429`/`529`/`5xx` with full-jitter
 * backoff (honoring `Retry-After` on a 429 only), rethrows everything else immediately, caps attempts,
 * and bounds total time by `opts.signal` (the call's deadline) so backoff can never run unbounded.
 */
export async function withResilientRetry<T>(fn: () => Promise<T>, opts: ResilientRetryOptions = {}): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const capDelayMs = opts.capDelayMs ?? 8000;
  const retryAfterCapMs = opts.retryAfterCapMs ?? 60_000;
  const random = opts.random ?? Math.random;
  const sleep = opts.sleep ?? defaultSleep;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      const decision = classifyRetry(err);
      if (decision.kind === 'rethrow' || attempt >= maxAttempts || opts.signal?.aborted) throw err;
      const delayMs =
        decision.kind === 'retry-after'
          ? Math.min(decision.retryAfterMs, retryAfterCapMs) // clamp a huge server value (no unbounded sleep)
          : fullJitterMs(baseDelayMs, capDelayMs, attempt, random);
      await sleep(delayMs, opts.signal);
      if (opts.signal?.aborted) throw err; // the deadline elapsed during backoff → give up, degrade
    }
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

/** The raw, UN-guarded output of one streamed attempt — `streamComplete` guards + records it (and may
 *  retry it once on a `length` truncation). `finishReason` is surfaced so the caller can decide. */
interface RawStream {
  text: string;
  finishReason: string;
  usage: { inputTokens: number | undefined; outputTokens: number | undefined };
  ttftMs: number;
  genMs: number;
  maxTokens: number;
  outputBytes: number;
}

type ProgressHook = (p: { outputTokens: number; elapsedMs: number; phase: 'prefill' | 'generating'; maxTokens: number }) => void;

/** One streamed attempt: establishes + drains the stream and captures per-call timing, WITHOUT guarding
 *  the finish reason (so a `length`-retry can decide before `guard` throws). */
async function streamOnce(opts: CompleteOptions, onProgress?: ProgressHook, modelOverride?: LanguageModel): Promise<RawStream> {
  const maxTokens = opts.maxTokens ?? 8000;
  const startMs = Date.now();
  const result = streamText({
    model: modelOverride ?? resolveModel(opts.model),
    prompt: opts.prompt,
    maxOutputTokens: maxTokens,
    // Fail fast + cheap on a stall: never blindly re-bill (transient retries are #187's job, one layer
    // up in `withResilientRetry`), and bound TOTAL elapsed with an explicit deadline. A shared external
    // `opts.signal` (from #187's retry wrapper) bounds total elapsed across attempts; absent it, a fresh
    // per-call timeout from `deadlineMs` (#186). A timeout aborts un-retried → degrade-to-'soon'.
    maxRetries: 0,
    abortSignal: opts.signal ?? AbortSignal.timeout(opts.deadlineMs ?? DEFAULT_CODE_DEADLINE_MS),
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
  const ttft = ttftMs ?? totalMs; // no delta (empty output) → the whole call was prefill
  return {
    text,
    finishReason,
    usage: await result.usage,
    ttftMs: ttft,
    genMs: Math.max(0, totalMs - ttft),
    maxTokens,
    outputBytes: text.length,
  };
}

/**
 * A STREAMING free-text completion — the `code` stage's path. Streaming is what lets us capture
 * per-call WALL-CLOCK: `ttftMs` (time to the first text delta = prefill/think) and `genMs`
 * (generation = total − ttft), plus `maxTokens` (cap-proximity) and `outputBytes` (size). It also
 * exposes a periodic `onProgress` hook — the live code-phase progress feed (PR-1 only EMITS it; PR-4
 * consumes it). The `guard(finishReason)` truncation/abort check is preserved exactly as on the
 * blocking path. Pass `modelOverride` (a mock streaming model) in tests, mirroring `complete`.
 *
 * Two failure-cost guards on the inner `streamText` call (issue #186): `maxRetries: 0` so a stalled or
 * failing establishment is NEVER blindly re-billed (the AI SDK `maxRetries` is a flat count over all
 * retryable errors — there is no "retry only transient 429/529"; the jittered transient-retry policy
 * is #187's `withResilientRetry`, layered ABOVE this single-attempt inner call), and an `abortSignal`
 * as the single binding TOTAL-elapsed cap (with streaming, undici's `headersTimeout` is satisfied at
 * prefill and `bodyTimeout` guards only inter-chunk gaps, so neither bounds total elapsed — the
 * AbortSignal is the real ceiling). On abort the stream ends and the subsequent `await
 * result.finishReason` rejects with the `TimeoutError`, propagating UN-retried through `code` →
 * `synthesizeLesson`'s catch → degrade-to-'soon' (no crash, no re-bill).
 *
 * LENGTH-aware retry (issue #187, opt-in via `opts.retryAtMaxTokens`): when an attempt finishes with
 * `finishReason === 'length'` (a truncation — the page nearly fit), make EXACTLY ONE more attempt at the
 * raised cap before `guard` throws. ONLY 'length' qualifies — `content-filter`/unexpected reasons fall
 * straight to `guard` (no wasted re-bill). This is distinct from `withResilientRetry`'s TRANSIENT retry:
 * one handles a clean-but-truncated finish, the other handles a thrown `429`/`529`.
 */
export async function streamComplete(
  opts: CompleteOptions,
  // PR-4 (#180): `maxTokens` (the resolved request cap) rides the per-delta payload so a consumer can
  // compute a bounded fraction WITHOUT re-hardcoding the cap — the live code-phase progress sink divides
  // `outputTokens / maxTokens` server-side. The cap stays the caller's single source (code.ts sets 32000).
  onProgress?: ProgressHook,
  modelOverride?: LanguageModel,
): Promise<TextResult> {
  const providerModel = registryId(opts.model);
  const raised = opts.retryAtMaxTokens;
  const first = await streamOnce(opts, onProgress, modelOverride);
  if (first.finishReason === 'length' && raised !== undefined && raised > first.maxTokens) {
    // Exactly ONE raised-cap retry, sharing the same deadline (streamOnce ignores `retryAtMaxTokens`, so
    // overriding only `maxTokens` can't recurse). The first (truncated) attempt was a REAL, already-billed
    // generation — its tokens + cost are FOLDED into the returned record (`billedPrior`) so a length-retry
    // run never UNDER-reports its code-phase spend in the #166/#167 telemetry, the eleatic trace, or the
    // per-lesson $ metric (#187 review). A still-truncated retry falls through to guard → degrade.
    const second = await streamOnce({ ...opts, maxTokens: raised }, onProgress, modelOverride);
    guard(second.finishReason, providerModel, second.maxTokens);
    return streamResultRecord(providerModel, second, first);
  }
  guard(first.finishReason, providerModel, first.maxTokens);
  return streamResultRecord(providerModel, first);
}

/**
 * Build the `TextResult` for a streamed call. `billedPrior` (the truncated first attempt of a length-
 * retry) is OPTIONAL: when present, its already-billed input/output tokens are SUMMED into the record so
 * the returned cost represents the TOTAL code-stage spend, not just the final attempt — cost is linear in
 * tokens at one model's rates, so summed usage yields exactly cost(attempt1)+cost(attempt2). The clean
 * `finishReason` + the per-call timing/bytes come from `raw` (the successful attempt that produced the
 * returned text).
 */
function streamResultRecord(providerModel: string, raw: RawStream, billedPrior?: RawStream): TextResult {
  const inputTokens = (raw.usage.inputTokens ?? 0) + (billedPrior?.usage.inputTokens ?? 0);
  const outputTokens = (raw.usage.outputTokens ?? 0) + (billedPrior?.usage.outputTokens ?? 0);
  const record = recordFrom(providerModel, { inputTokens, outputTokens }, raw.finishReason);
  record.ttftMs = raw.ttftMs;
  record.genMs = raw.genMs;
  record.maxTokens = raw.maxTokens;
  record.outputBytes = raw.outputBytes;
  return { text: raw.text, record };
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
