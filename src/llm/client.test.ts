import { MockLanguageModelV3 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { complete, completeObject } from './client';
import type { StageModel } from './models';

const OPUS: StageModel = { provider: 'anthropic', model: 'claude-opus-4-8' };

function mockModel(
  text: string,
  opts: { finishReason?: 'stop' | 'length' | 'content-filter'; input?: number; output?: number } = {},
) {
  const reason = opts.finishReason ?? 'stop';
  return new MockLanguageModelV3({
    doGenerate: {
      content: [{ type: 'text', text }],
      finishReason: { unified: reason, raw: reason },
      usage: {
        inputTokens: { total: opts.input ?? 0, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: opts.output ?? 0, text: undefined, reasoning: undefined },
      },
      warnings: [],
    },
  });
}

describe('complete', () => {
  it('returns text and computes a per-call cost record', async () => {
    const res = await complete({ model: OPUS, prompt: 'hi' }, mockModel('Hello world', { input: 1_000_000, output: 0 }));
    expect(res.text).toBe('Hello world');
    expect(res.record.providerModel).toBe('anthropic:claude-opus-4-8');
    expect(res.record.inputTokens).toBe(1_000_000);
    expect(res.record.costUsd).toBeCloseTo(5, 6); // 1M input @ $5 on Opus 4.8
  });

  it('throws on a truncated (length) finish reason rather than returning partial text', async () => {
    await expect(
      complete({ model: OPUS, prompt: 'x', maxTokens: 8000 }, mockModel('partial...', { finishReason: 'length' })),
    ).rejects.toThrow(/truncated|cap/);
  });

  it('throws on a content-filtered finish reason', async () => {
    await expect(
      complete({ model: OPUS, prompt: 'x' }, mockModel('', { finishReason: 'content-filter' })),
    ).rejects.toThrow(/filter/);
  });
});

describe('completeObject', () => {
  it('parses schema-validated structured output', async () => {
    const schema = z.object({ scope: z.string(), subtopics: z.array(z.string()) });
    const res = await completeObject(
      { model: OPUS, prompt: 'plan', schema },
      mockModel('{"scope":"Fourier transforms","subtopics":["sine","frequency"]}', { input: 100, output: 50 }),
    );
    expect(res.object.scope).toBe('Fourier transforms');
    expect(res.object.subtopics).toEqual(['sine', 'frequency']);
    expect(res.record.costUsd).toBeGreaterThan(0);
  });
});
