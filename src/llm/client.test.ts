import { APICallError } from 'ai';
import { MockLanguageModelV3, convertArrayToReadableStream } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { complete, completeObject, DEFAULT_CODE_DEADLINE_MS, searchWeb, streamComplete } from './client';
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
    const seen: { outputTokens: number; elapsedMs: number; phase: string; maxTokens: number }[] = [];
    await streamComplete({ model: OPUS, prompt: 'hi' }, (p) => seen.push(p), mockStream(['a', 'b', 'c'], { output: 9 }));
    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect(seen[seen.length - 1]?.phase).toBe('generating');
    expect(seen[seen.length - 1]?.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('carries the request cap (maxTokens) in EVERY onProgress sample — the PR-4 fraction input', async () => {
    // PR-4 (#180): the live code-phase sink divides outputTokens / maxTokens to a bounded fraction, so the
    // cap must ride the per-delta payload (computed in the sink, never re-hardcoded). The cap defaults to
    // 8000 when unset and is the explicit value when the caller (code.ts) passes 32000.
    const def: number[] = [];
    await streamComplete({ model: OPUS, prompt: 'hi' }, (p) => def.push(p.maxTokens), mockStream(['a', 'b'], { output: 4 }));
    expect(def.length).toBeGreaterThanOrEqual(1);
    expect(def.every((m) => m === 8000)).toBe(true); // the default cap rides every sample

    const capped: number[] = [];
    await streamComplete(
      { model: OPUS, prompt: 'hi', maxTokens: 32000 },
      (p) => capped.push(p.maxTokens),
      mockStream(['a', 'b', 'c'], { output: 6 }),
    );
    expect(capped.length).toBeGreaterThanOrEqual(1);
    expect(capped.every((m) => m === 32000)).toBe(true); // the explicit request cap rides every sample
  });

  // ---- issue #186: fail fast + cheap on a stall, never re-bill (maxRetries:0 + a total-elapsed deadline) ----

  it('caps SDK retries at 0 — a retryable establishment failure is tried ONCE, never 3× re-billed (#186)', async () => {
    // A retryable APICallError (e.g. a 529 overloaded) is EXACTLY the class the AI SDK would otherwise
    // re-run on (default maxRetries:2 → 3 attempts). With maxRetries:0 the stalled/failing establishment
    // is attempted once and the cost (~$0.228) is never amplified. Asserting the invocation count proves
    // the cap directly: doStreamCalls records every attempt the SDK made.
    const model = new MockLanguageModelV3({
      doStream: async () => {
        throw new APICallError({
          message: 'overloaded',
          url: 'https://api.anthropic.test',
          requestBodyValues: {},
          statusCode: 529,
          isRetryable: true,
        });
      },
    });
    await expect(
      streamComplete({ model: OPUS, prompt: 'x', maxTokens: 32000 }, undefined, model),
    ).rejects.toThrow();
    expect(model.doStreamCalls.length).toBe(1); // maxRetries:0 → one attempt; the uncapped default would be 3
  });

  it('aborts a stalled stream at the deadline and propagates the timeout UN-retried → degrade-to-soon (#186)', async () => {
    // Model the establishment stall the issue exists to kill: the call never returns a first chunk. The
    // AbortSignal.timeout(deadlineMs) is the single binding total-elapsed cap; when it fires the call
    // aborts. The abort propagates as a THROW (so synthesizeLesson's catch degrades the run to 'soon'
    // rather than crashing) and is NOT retried (an abort is non-retryable). A tiny deadline keeps the
    // test deterministic and fast — it must fire ~at the deadline, not wait out a real 15-min stall.
    const model = new MockLanguageModelV3({
      doStream: async ({ abortSignal }) => {
        // Never yield a first chunk; reject only when the deadline AbortSignal fires.
        await new Promise<never>((_, reject) => {
          if (abortSignal?.aborted) reject(abortSignal.reason);
          abortSignal?.addEventListener('abort', () => reject(abortSignal.reason));
        });
        throw new Error('unreachable — the abort rejects first');
      },
    });
    const startedAt = Date.now();
    await expect(
      streamComplete({ model: OPUS, prompt: 'x', maxTokens: 32000, deadlineMs: 40 }, undefined, model),
    ).rejects.toThrow(/abort|timeout/i);
    expect(model.doStreamCalls.length).toBe(1); // the timed-out establishment is never retried
    expect(Date.now() - startedAt).toBeLessThan(2000); // fired at the ~40ms deadline, not a long stall
  });

  it('defaults the deadline to DEFAULT_CODE_DEADLINE_MS, anchored under the 3600s Job task timeout (#186)', () => {
    // The default must leave a healthy slow generation room (anchored on the observed ~210–270s band)
    // yet sit well under the Cloud Run Job's 3600s task timeout so THIS deadline is what bounds a stall.
    expect(DEFAULT_CODE_DEADLINE_MS).toBeGreaterThan(270_000); // > the observed healthy code-phase max
    expect(DEFAULT_CODE_DEADLINE_MS).toBeLessThan(3_600_000); // < the 3600s Job task timeout (cloud-run.tf:95)
  });
});
