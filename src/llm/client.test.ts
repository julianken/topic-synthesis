import { MockLanguageModelV3, convertArrayToReadableStream } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { complete, completeObject, searchWeb, streamComplete } from './client';
import type { StageModel } from './models';

const OPUS: StageModel = { provider: 'anthropic', model: 'claude-opus-4-8' };

function mockModel(
  text: string,
  opts: {
    finishReason?: 'stop' | 'length' | 'content-filter' | 'error' | 'tool-calls';
    input?: number;
    output?: number;
  } = {},
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

  it('throws on an unexpected terminal finish reason (error/other/unknown)', async () => {
    await expect(
      complete({ model: OPUS, prompt: 'x' }, mockModel('junk', { finishReason: 'error' })),
    ).rejects.toThrow(/unexpected finish reason/);
  });

  it('allows tool-calls as a clean finish (the Output.object tool-forcing path)', async () => {
    const res = await complete({ model: OPUS, prompt: 'x' }, mockModel('ok', { finishReason: 'tool-calls' }));
    expect(res.text).toBe('ok');
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

describe('searchWeb', () => {
  it('extracts the retrieved url sources, falling back to the url when a title is absent', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: {
        content: [
          { type: 'text', text: 'A grounded answer.' },
          { type: 'source', sourceType: 'url', id: 's1', url: 'https://a.example', title: 'A' },
          { type: 'source', sourceType: 'url', id: 's2', url: 'https://b.example' }, // no title → fall back to url
        ],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 100, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 50, text: undefined, reasoning: undefined },
        },
        warnings: [],
      },
    });

    const res = await searchWeb({ model: OPUS, prompt: 'what is x?' }, model);
    expect(res.text).toBe('A grounded answer.');
    expect(res.sources).toEqual([
      { url: 'https://a.example', title: 'A' },
      { url: 'https://b.example', title: 'https://b.example' }, // title fell back to the url
    ]);
    expect(res.record.costUsd).toBeGreaterThan(0);
  });
});

/** A mock STREAMING model (the doStream sibling of mockModel) — emits the text in deltas, then a finish
 *  part carrying the usage + finish reason, exactly as a real provider stream does. */
function mockStream(
  chunks: string[],
  opts: { finishReason?: 'stop' | 'length' | 'content-filter' | 'error' | 'tool-calls'; input?: number; output?: number } = {},
) {
  const reason = opts.finishReason ?? 'stop';
  return new MockLanguageModelV3({
    doStream: {
      stream: convertArrayToReadableStream([
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 't1' },
        ...chunks.map((delta) => ({ type: 'text-delta' as const, id: 't1', delta })),
        { type: 'text-end', id: 't1' },
        {
          type: 'finish',
          finishReason: { unified: reason, raw: reason },
          usage: {
            inputTokens: { total: opts.input ?? 0, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: opts.output ?? 0, text: undefined, reasoning: undefined },
          },
        },
      ]),
    },
  });
}

describe('streamComplete', () => {
  it('streams the text and records per-call timing (ttftMs / genMs / maxTokens / outputBytes)', async () => {
    const res = await streamComplete(
      { model: OPUS, prompt: 'hi', maxTokens: 32000 },
      undefined,
      mockStream(['<!doctype html>', '<body>', '...</body>'], { output: 120 }),
    );
    expect(res.text).toBe('<!doctype html><body>...</body>');
    expect(res.record.outputTokens).toBe(120);
    expect(typeof res.record.ttftMs).toBe('number');
    expect(typeof res.record.genMs).toBe('number');
    expect(res.record.ttftMs).toBeGreaterThanOrEqual(0);
    expect(res.record.genMs).toBeGreaterThanOrEqual(0);
    expect(res.record.maxTokens).toBe(32000);
    expect(res.record.outputBytes).toBe('<!doctype html><body>...</body>'.length);
  });

  it('throws on a truncated (length) finish reason — the guard is preserved on the streaming path', async () => {
    await expect(
      streamComplete({ model: OPUS, prompt: 'x', maxTokens: 8000 }, undefined, mockStream(['partial'], { finishReason: 'length' })),
    ).rejects.toThrow(/truncated|cap/);
  });

  it('reports progress as chunks arrive (the PR-4 live-UI hook)', async () => {
    const seen: { outputTokens: number; elapsedMs: number; phase: string }[] = [];
    await streamComplete({ model: OPUS, prompt: 'hi' }, (p) => seen.push(p), mockStream(['a', 'b', 'c'], { output: 9 }));
    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect(seen[seen.length - 1]?.phase).toBe('generating');
    expect(seen[seen.length - 1]?.elapsedMs).toBeGreaterThanOrEqual(0);
  });
});
