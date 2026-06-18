import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';
import { openai } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import type { StageModel } from './models';

// Local OpenAI-compatible endpoint (Ollama / vLLM / any compatible server). Base
// URL from the env; the key may be a placeholder for keyless local servers.
const local = createOpenAICompatible({
  name: 'local',
  baseURL: process.env.LOCAL_OPENAI_BASE_URL ?? 'http://localhost:11434/v1',
  apiKey: process.env.LOCAL_OPENAI_API_KEY ?? 'not-needed',
});

/**
 * Resolve a StageModel to a Vercel AI SDK LanguageModel. Constructing the model
 * object needs no API key; the provider reads its key from the env at call time
 * (ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY).
 */
export function resolveModel(m: StageModel): LanguageModel {
  switch (m.provider) {
    case 'anthropic':
      return anthropic(m.model);
    case 'openai':
      return openai(m.model);
    case 'google':
      return google(m.model);
    case 'local':
      return local(m.model);
    default: {
      const unreachable: never = m.provider;
      throw new Error(`Unknown provider: ${String(unreachable)}`);
    }
  }
}
