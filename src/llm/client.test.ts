import { APICallError } from 'ai';
import { MockLanguageModelV3, convertArrayToReadableStream } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  complete,
  completeObject,
  DEFAULT_CODE_DEADLINE_MS,
  searchWeb,
  streamComplete,
  withResilientRetry,
} from './client';
import type { StageModel } from './models';
import { estimateCostUsd } from './pricing';

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

// ---- issue #187: withResilientRetry — bounded, jittered retry for the TRANSIENT failure class ----

/** Build a retryable/non-retryable provider error with an optional Retry-After header. */
function apiError(statusCode: number, opts: { retryAfter?: string; isRetryable?: boolean } = {}): APICallError {
  return new APICallError({
    message: `status ${statusCode}`,
    url: 'https://api.anthropic.test',
    requestBodyValues: {},
    statusCode,
    ...(opts.retryAfter !== undefined ? { responseHeaders: { 'retry-after': opts.retryAfter } } : {}),
    isRetryable: opts.isRetryable ?? (statusCode >= 500 || statusCode === 429),
  });
}

describe('withResilientRetry (#187)', () => {
  it('(a) retries a 429 ONCE after honoring Retry-After, then succeeds', async () => {
    const delays: number[] = [];
    const sleep = vi.fn(async (ms: number) => void delays.push(ms));
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw apiError(429, { retryAfter: '2' }); // server asked for 2s
      return 'ok';
    });

    const res = await withResilientRetry(fn, { sleep, random: () => 0.5 });

    expect(res).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2); // one transient retry, then success
    expect(delays).toEqual([2000]); // honored the 2s Retry-After exactly (not a jittered value)
  });

  it('(b) retries a 529 with FULL-JITTER backoff within bounds, never trusting its Retry-After', async () => {
    const delays: number[] = [];
    const sleep = vi.fn(async (ms: number) => void delays.push(ms));
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      // A 529 may carry a Retry-After too; the policy IGNORES it (overloaded servers' values are
      // unreliable) and jitters instead, so we assert the delay is the jittered window, not 300_000.
      if (calls === 1) throw apiError(529, { retryAfter: '300' });
      return 'ok';
    });

    const base = 500;
    const cap = 8000;
    const res = await withResilientRetry(fn, { sleep, random: () => 0.5, baseDelayMs: base, capDelayMs: cap });

    expect(res).toBe('ok');
    expect(delays).toHaveLength(1);
    const window = Math.min(cap, base * 2 ** 1); // attempt 1's full-jitter window
    expect(delays[0]).toBeGreaterThanOrEqual(0);
    expect(delays[0]).toBeLessThanOrEqual(window); // within [0, min(cap, base·2^attempt)]
    expect(delays[0]).not.toBe(300_000); // did NOT honor the 529's Retry-After
  });

  it('(b2) the full-jitter delay stays within bounds across the RNG range (0 and ~1)', async () => {
    // Assert the jitter window, not exact timing: at random()→0 the delay is 0; at random()→~1 it
    // approaches (never exceeds) the window. Deterministic via an injected, non-random RNG.
    for (const r of [0, 0.999999]) {
      const delays: number[] = [];
      const sleep = vi.fn(async (ms: number) => void delays.push(ms));
      let calls = 0;
      const fn = vi.fn(async () => {
        calls += 1;
        if (calls === 1) throw apiError(529);
        return 'ok';
      });
      await withResilientRetry(fn, { sleep, random: () => r, baseDelayMs: 500, capDelayMs: 8000 });
      const window = Math.min(8000, 500 * 2 ** 1);
      expect(delays[0]).toBeGreaterThanOrEqual(0);
      expect(delays[0]).toBeLessThanOrEqual(window);
    }
  });

  it('(a2) clamps a huge honored 429 Retry-After to retryAfterCapMs (no unbounded sleep)', async () => {
    const delays: number[] = [];
    const sleep = vi.fn(async (ms: number) => void delays.push(ms));
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw apiError(429, { retryAfter: '3600' }); // server asks for a full HOUR
      return 'ok';
    });

    const res = await withResilientRetry(fn, { sleep, retryAfterCapMs: 60_000 });

    expect(res).toBe('ok');
    expect(delays).toEqual([60_000]); // clamped to the 60s cap, NOT the 3_600_000ms the server asked for
  });

  it('(c) rethrows a non-retryable 400 IMMEDIATELY without retrying or sleeping', async () => {
    const sleep = vi.fn(async () => {});
    const fn = vi.fn(async () => {
      throw apiError(400, { isRetryable: false });
    });

    await expect(withResilientRetry(fn, { sleep })).rejects.toThrow(/status 400/);
    expect(fn).toHaveBeenCalledTimes(1); // no retry on a client error
    expect(sleep).not.toHaveBeenCalled();
  });

  it('(c2) rethrows a non-APICallError (e.g. an abort/timeout) without retrying', async () => {
    const sleep = vi.fn(async () => {});
    const fn = vi.fn(async () => {
      throw new Error('aborted by deadline'); // the #186 TimeoutError class — never retried
    });

    await expect(withResilientRetry(fn, { sleep })).rejects.toThrow(/aborted/);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('(e) caps total attempts and rethrows the LAST error after exhausting them', async () => {
    const sleep = vi.fn(async () => {});
    const fn = vi.fn(async () => {
      throw apiError(529);
    });

    await expect(withResilientRetry(fn, { sleep, maxAttempts: 3, random: () => 0.5 })).rejects.toThrow(/status 529/);
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries, then give up
    expect(sleep).toHaveBeenCalledTimes(2); // one backoff before each retry
  });

  it('(e2) stops retrying once the outer AbortSignal deadline elapses during backoff', async () => {
    const controller = new AbortController();
    // Model the deadline firing mid-backoff: the injected sleep aborts the controller while "sleeping".
    const sleep = vi.fn(async () => void controller.abort());
    const fn = vi.fn(async () => {
      throw apiError(529);
    });

    await expect(
      withResilientRetry(fn, { sleep, signal: controller.signal, maxAttempts: 5, random: () => 0.5 }),
    ).rejects.toThrow(/status 529/);
    expect(fn).toHaveBeenCalledTimes(1); // first failure → backoff trips the deadline → give up (not 5×)
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('(e3) does not retry at all when the deadline is ALREADY aborted before the first failure', async () => {
    const controller = new AbortController();
    controller.abort();
    const sleep = vi.fn(async () => {});
    const fn = vi.fn(async () => {
      throw apiError(529);
    });

    await expect(withResilientRetry(fn, { sleep, signal: controller.signal })).rejects.toThrow(/status 529/);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});

// ---- issue #187: the code-stage length-aware retry (opt-in via retryAtMaxTokens) ----

/** A streaming result that finishes with a chosen reason + usage — the doStream return shape. */
function streamResult(
  reason: 'stop' | 'length' | 'content-filter' | 'error',
  text: string,
  usage: { input?: number; output?: number } = {},
) {
  return {
    stream: convertArrayToReadableStream([
      { type: 'stream-start' as const, warnings: [] },
      { type: 'text-start' as const, id: 't1' },
      { type: 'text-delta' as const, id: 't1', delta: text },
      { type: 'text-end' as const, id: 't1' },
      {
        type: 'finish' as const,
        finishReason: { unified: reason, raw: reason },
        usage: {
          inputTokens: { total: usage.input ?? 1, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: usage.output ?? 1, text: undefined, reasoning: undefined },
        },
      },
    ]),
  };
}

describe('streamComplete — length-aware retry (code stage, #187)', () => {
  it('(d) retries ONCE at the raised maxTokens on finishReason==="length", then succeeds', async () => {
    // First attempt truncates at the base cap; the opt-in retryAtMaxTokens triggers exactly ONE more
    // attempt at the raised cap (< the model's 64K cap), which finishes cleanly.
    const model = new MockLanguageModelV3({
      doStream: async ({ maxOutputTokens }) =>
        (maxOutputTokens ?? 0) <= 32000 ? streamResult('length', 'partial') : streamResult('stop', 'full page'),
    });

    const res = await streamComplete(
      { model: OPUS, prompt: 'x', maxTokens: 32000, retryAtMaxTokens: 48000 },
      undefined,
      model,
    );

    expect(res.text).toBe('full page');
    expect(model.doStreamCalls).toHaveLength(2);
    expect(model.doStreamCalls[0]?.maxOutputTokens).toBe(32000); // base cap first
    expect(model.doStreamCalls[1]?.maxOutputTokens).toBe(48000); // raised cap on the single retry
    expect(res.record.maxTokens).toBe(48000); // the record reflects the successful (raised) attempt
  });

  it('(d2) does NOT retry a content-filter finish — no raised-cap re-bill', async () => {
    const model = new MockLanguageModelV3({ doStream: async () => streamResult('content-filter', 'blocked') });

    await expect(
      streamComplete({ model: OPUS, prompt: 'x', maxTokens: 32000, retryAtMaxTokens: 48000 }, undefined, model),
    ).rejects.toThrow(/filter/);
    expect(model.doStreamCalls).toHaveLength(1); // never re-billed at the raised cap
  });

  it('(d3) still degrades (throws) when the raised-cap retry ALSO truncates — one retry only', async () => {
    const model = new MockLanguageModelV3({ doStream: async () => streamResult('length', 'partial') });

    await expect(
      streamComplete({ model: OPUS, prompt: 'x', maxTokens: 32000, retryAtMaxTokens: 48000 }, undefined, model),
    ).rejects.toThrow(/truncated|cap/);
    expect(model.doStreamCalls).toHaveLength(2); // base + exactly ONE raised retry, then give up
  });

  it('(d4) does not retry length at all when retryAtMaxTokens is unset (opt-in only)', async () => {
    const model = new MockLanguageModelV3({ doStream: async () => streamResult('length', 'partial') });

    await expect(
      streamComplete({ model: OPUS, prompt: 'x', maxTokens: 32000 }, undefined, model),
    ).rejects.toThrow(/truncated|cap/);
    expect(model.doStreamCalls).toHaveLength(1); // no opt-in → guard throws on the first length
  });

  it('(d6) folds BOTH attempts cost + tokens into the record on a length-retry (no under-report)', async () => {
    // The first (truncated 'length') attempt is a REAL, already-billed ~32K generation; the returned record
    // must represent the TOTAL code-stage spend (attempt1 + attempt2), not just the successful attempt, or
    // the #166/#167 telemetry + eleatic trace + per-lesson $ metric under-report it (#196 review).
    const model = new MockLanguageModelV3({
      doStream: async ({ maxOutputTokens }) =>
        (maxOutputTokens ?? 0) <= 32000
          ? streamResult('length', 'partial', { input: 1000, output: 32000 })
          : streamResult('stop', 'full page', { input: 1000, output: 40000 }),
    });

    const res = await streamComplete(
      { model: OPUS, prompt: 'x', maxTokens: 32000, retryAtMaxTokens: 48000 },
      undefined,
      model,
    );

    expect(res.record.inputTokens).toBe(2000); // 1000 (truncated) + 1000 (success)
    expect(res.record.outputTokens).toBe(72000); // 32000 (truncated) + 40000 (success)
    expect(res.record.finishReason).toBe('stop'); // the clean second-attempt reason, not 'length'
    const c1 = estimateCostUsd('anthropic:claude-opus-4-8', { inputTokens: 1000, outputTokens: 32000 });
    const c2 = estimateCostUsd('anthropic:claude-opus-4-8', { inputTokens: 1000, outputTokens: 40000 });
    expect(res.record.costUsd).toBeCloseTo(c1 + c2, 9); // total spend, NOT just attempt2…
    expect(res.record.costUsd).toBeGreaterThan(c2); // …which would silently drop the first attempt's bill
  });

  it('(d5) prefers an external signal over a self-created timeout (shared deadline across attempts)', async () => {
    // #187 shares ONE deadline across every retry attempt; streamComplete must thread opts.signal through
    // to the inner streamText abortSignal rather than minting a fresh per-call timeout.
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    const model = new MockLanguageModelV3({
      doStream: async ({ abortSignal }) => {
        seen = abortSignal;
        return streamResult('stop', 'ok');
      },
    });

    await streamComplete({ model: OPUS, prompt: 'x', maxTokens: 32000, signal: controller.signal }, undefined, model);
    expect(seen).toBe(controller.signal); // the caller's deadline reached the inner call
  });
});
