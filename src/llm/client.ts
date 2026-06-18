import Anthropic from '@anthropic-ai/sdk';
import type { ModelId } from './models';
import { estimateCostUsd, type TokenUsage } from './pricing';

let shared: Anthropic | undefined;

/** Lazily-constructed Anthropic client (reads ANTHROPIC_API_KEY from the env). */
export function getClient(): Anthropic {
  if (!shared) shared = new Anthropic();
  return shared;
}

export type Effort = 'low' | 'medium' | 'high' | 'max';

export interface CompleteOptions {
  model: ModelId;
  prompt: string;
  system?: string;
  maxTokens?: number;
  effort?: Effort;
  /** Put a cache breakpoint on the system prompt (the shared graph/brief prefix). */
  cacheSystem?: boolean;
}

export interface CompleteResult {
  text: string;
  usage: TokenUsage;
  costUsd: number;
  stopReason: string | null;
}

/**
 * One Claude turn: adaptive thinking, effort-controlled, with cost computed from
 * the returned usage. Pass a client explicitly in tests to avoid a live call.
 * Throws on a `refusal` stop reason rather than returning empty/partial output.
 */
export async function complete(
  opts: CompleteOptions,
  client: Anthropic = getClient(),
): Promise<CompleteResult> {
  const { model, prompt, system, maxTokens = 8000, effort = 'high', cacheSystem = false } = opts;

  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: maxTokens,
    thinking: { type: 'adaptive' },
    output_config: { effort },
    messages: [{ role: 'user', content: prompt }],
  };
  if (system !== undefined) {
    params.system = cacheSystem
      ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
      : system;
  }

  const res = await client.messages.create(params);

  if (res.stop_reason === 'refusal') {
    throw new Error(`Claude refused the request (model ${model}); discard any partial output.`);
  }

  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const usage: TokenUsage = {
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
    cacheReadInputTokens: res.usage.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: res.usage.cache_creation_input_tokens ?? 0,
  };

  return { text, usage, costUsd: estimateCostUsd(model, usage), stopReason: res.stop_reason };
}
