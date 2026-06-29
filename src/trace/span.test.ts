import { describe, expect, it } from 'vitest';
import type { LlmCallRecord } from '../llm/client';
import type { TraceSpan } from '../pipeline/ports';
import { metricsOf, SpanCollector, spanTreeFor } from './span';

const rec = (costUsd: number, inT = 100, outT = 50): LlmCallRecord => ({
  providerModel: 'anthropic:claude-haiku-4-5',
  inputTokens: inT,
  outputTokens: outT,
  costUsd,
  rawUsage: null,
  finishReason: 'stop',
});

// A STREAMED-call record carrying PR-1's per-call wall-clock + size (the `code` stage shape, issue #176).
const timedRec = (over: Partial<LlmCallRecord> = {}): LlmCallRecord => ({
  ...rec(0.02, 100, 80),
  ttftMs: 500,
  genMs: 2000,
  maxTokens: 8000,
  outputBytes: 4096,
  ...over,
});

describe('SpanCollector', () => {
  it('captures spans in execution order (it is the TraceSink the CLI injects)', () => {
    const c = new SpanCollector();
    c.onSpan({ stage: 'planner', record: rec(0.01) });
    c.onSpan({ stage: 'spec', nodeSlug: 'x', record: rec(0.02) });
    expect(c.spans().map((s) => s.stage)).toEqual(['planner', 'spec']);
  });
});

describe('metricsOf', () => {
  it('maps tokens + cost, OMITTING the wall-clock keys (default / records carry no timing)', () => {
    const m = metricsOf(rec(0.012, 200, 80));
    expect(m).toEqual({ promptTokens: 200, completionTokens: 80, totalTokens: 280, costUsd: 0.012 });
    expect('durationMs' in m).toBe(false);
    expect('startMs' in m).toBe(false);
  });

  it('AC3: includeTiming on a timed record emits durationMs (ttft+gen), the additive keys + derived tokensPerSec', () => {
    const m = metricsOf(timedRec(), true); // ttft 500, gen 2000, out 80 tokens, 8000 cap, 4096 bytes
    expect(m).toEqual({
      promptTokens: 100,
      completionTokens: 80,
      totalTokens: 180,
      costUsd: 0.02,
      durationMs: 2500, // ttftMs + genMs
      ttftMs: 500,
      genMs: 2000,
      tokensPerSec: 40, // outputTokens / (genMs/1000) = 80 / 2
      outputBytes: 4096,
      maxTokens: 8000,
    });
  });

  it('AC4: includeTiming on a blocking-call record (no timing) emits only the four base keys', () => {
    const m = metricsOf(rec(0.012, 200, 80), true);
    expect(m).toEqual({ promptTokens: 200, completionTokens: 80, totalTokens: 280, costUsd: 0.012 });
    expect('durationMs' in m).toBe(false);
    expect('ttftMs' in m).toBe(false);
  });

  it('AC5: does not emit tokensPerSec when genMs === 0 (no Infinity/NaN)', () => {
    const m = metricsOf(timedRec({ genMs: 0 }), true);
    expect('tokensPerSec' in m).toBe(false);
    expect(m.durationMs).toBe(500); // ttft 500 + gen 0 — durationMs still emitted
  });

  it('omits outputBytes/maxTokens individually when a timed record lacks them', () => {
    // A streamed record with core timing (ttft/gen) but no size fields — each is OMITTED, not undefined.
    const partial: LlmCallRecord = { ...rec(0.02, 100, 80), ttftMs: 500, genMs: 2000 };
    const m = metricsOf(partial, true);
    expect('outputBytes' in m).toBe(false);
    expect('maxTokens' in m).toBe(false);
    expect(m.durationMs).toBe(2500); // core timing still present
    expect(m.tokensPerSec).toBe(40);
  });
});

describe('spanTreeFor', () => {
  it('builds a task root with one child per call; critic is a scorer, the rest llm', () => {
    const spans: TraceSpan[] = [
      { stage: 'spec', nodeSlug: 'sine', record: rec(0.01) },
      { stage: 'code', nodeSlug: 'sine', record: rec(0.02) },
      { stage: 'critic', nodeSlug: 'sine', record: rec(0.03) },
    ];
    const tree = spanTreeFor('sine', spans);
    expect(tree[0]).toEqual({ id: 'sine', parentId: null, name: 'sine', kind: 'task' });
    expect(tree.slice(1).map((s) => [s.name, s.kind, s.parentId])).toEqual([
      ['spec', 'llm', 'sine'],
      ['code', 'llm', 'sine'],
      ['critic', 'scorer', 'sine'],
    ]);
    expect(tree[3]?.metrics?.costUsd).toBe(0.03);
  });

  it('forwards includeTiming to metricsOf so the streamed code span carries wall-clock; default omits it', () => {
    const spans: TraceSpan[] = [
      { stage: 'spec', nodeSlug: 'sine', record: rec(0.01) }, // blocking call — no timing
      { stage: 'code', nodeSlug: 'sine', record: timedRec() }, // streamed call — carries timing
    ];
    // Opt-in: the code span gets durationMs; the blocking spec span never does (no record timing).
    const withTiming = spanTreeFor('sine', spans, true);
    expect(withTiming[1]?.metrics?.durationMs).toBeUndefined(); // spec (blocking)
    expect(withTiming[2]?.metrics?.durationMs).toBe(2500); // code (streamed) = ttft+gen
    expect(withTiming[2]?.metrics?.tokensPerSec).toBe(40);
    // Default (flag off): even the streamed code span stays wall-clock-free.
    const without = spanTreeFor('sine', spans);
    expect('durationMs' in (without[2]?.metrics ?? {})).toBe(false);
  });
});
