import { anthropic } from '@ai-sdk/anthropic';
import { generateText, Output, type LanguageModel } from 'ai';
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
}

export interface CompleteOptions {
  model: StageModel;
  prompt: string;
  system?: string;
  maxTokens?: number;
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
