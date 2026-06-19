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

describe('SpanCollector', () => {
  it('captures spans in execution order (it is the TraceSink the CLI injects)', () => {
    const c = new SpanCollector();
    c.onSpan({ stage: 'planner', record: rec(0.01) });
    c.onSpan({ stage: 'spec', nodeSlug: 'x', record: rec(0.02) });
    expect(c.spans().map((s) => s.stage)).toEqual(['planner', 'spec']);
  });
});

describe('metricsOf', () => {
  it('maps tokens + cost, OMITTING the wall-clock keys (records carry no timing)', () => {
    const m = metricsOf(rec(0.012, 200, 80));
    expect(m).toEqual({ promptTokens: 200, completionTokens: 80, totalTokens: 280, costUsd: 0.012 });
    expect('durationMs' in m).toBe(false);
    expect('startMs' in m).toBe(false);
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
});
