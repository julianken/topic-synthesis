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

// Every downstream stage trusts this wrapper, so a silent truncation or a filtered
// response would surface as an unexplained parse failure. Fail loud on both.
function guard(finishReason: string, providerModel: string, maxTokens: number): void {
  if (finishReason === 'length') {
    throw new Error(`"${providerModel}" hit the output cap (${maxTokens}); output is truncated. Raise maxTokens.`);
  }
  if (finishReason === 'content-filter') {
    throw new Error(`"${providerModel}" response was content-filtered; discard any partial output.`);
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
