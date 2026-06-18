import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { complete } from './client';

function fakeClient(message: unknown): Anthropic {
  return { messages: { create: vi.fn().mockResolvedValue(message) } } as unknown as Anthropic;
}

describe('complete', () => {
  it('joins text blocks, maps usage, and computes cost', async () => {
    const client = fakeClient({
      content: [
        { type: 'thinking', thinking: '...' },
        { type: 'text', text: 'Hello ' },
        { type: 'text', text: 'world' },
      ],
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 1_000_000,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    });
    const res = await complete({ model: 'claude-opus-4-8', prompt: 'hi' }, client);
    expect(res.text).toBe('Hello world');
    expect(res.usage.inputTokens).toBe(1_000_000);
    expect(res.costUsd).toBeCloseTo(5, 6); // 1M input @ $5 on Opus 4.8
    expect(res.stopReason).toBe('end_turn');
  });

  it('throws on a refusal stop reason', async () => {
    const client = fakeClient({
      content: [],
      stop_reason: 'refusal',
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    await expect(complete({ model: 'claude-sonnet-4-6', prompt: 'x' }, client)).rejects.toThrow(
      /refused/,
    );
  });
});
