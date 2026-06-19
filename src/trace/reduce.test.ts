import { describe, expect, it } from 'vitest';
import type { LlmCallRecord } from '../llm/client';
import type { TraceSpan } from '../pipeline/ports';
import { ANALYSIS_ROW_KEY, reduceTrace } from './reduce';

const rec = (costUsd: number): LlmCallRecord => ({
  providerModel: 'anthropic:claude-haiku-4-5',
  inputTokens: 10,
  outputTokens: 5,
  costUsd,
  rawUsage: null,
  finishReason: 'stop',
});
const meta = { runId: 'run1', label: 'Fourier', startedAt: '2026-06-19T00:00:00Z' };

describe('reduceTrace', () => {
  it('produces one run + an analysis row + one row per built slug', () => {
    const spans: TraceSpan[] = [
      { stage: 'planner', record: rec(0.01) },
      { stage: 'graph', record: rec(0.02) },
      { stage: 'spec', nodeSlug: 'sine', record: rec(0.03) },
      { stage: 'code', nodeSlug: 'sine', record: rec(0.04) },
      { stage: 'spec', nodeSlug: 'cosine', record: rec(0.05) },
    ];
    const { run, rows } = reduceTrace(spans, meta);
    expect(run.id).toBe('run1');
    expect(run.label).toBe('Fourier');
    expect(run.startedAt).toBe('2026-06-19T00:00:00Z');
    expect(run.metrics?.calls).toBe(5);
    expect(run.metrics?.costUsd).toBeCloseTo(0.15);
    expect(rows.map((r) => r.rowKey)).toEqual([ANALYSIS_ROW_KEY, 'sine', 'cosine']);
    const sine = rows.find((r) => r.rowKey === 'sine');
    expect(sine?.scores?.calls).toBe(2);
    expect(sine?.scores?.costUsd).toBeCloseTo(0.07);
    expect(sine?.expected).toBeNull();
  });

  it('sums row cost back to the run cost (every call lands in exactly one row)', () => {
    const spans: TraceSpan[] = [
      { stage: 'planner', record: rec(0.01) },
      { stage: 'spec', nodeSlug: 'a', record: rec(0.02) },
    ];
    const { run, rows } = reduceTrace(spans, meta);
    const rowSum = rows.reduce((s, r) => s + (r.scores?.costUsd ?? 0), 0);
    expect(rowSum).toBeCloseTo(run.metrics?.costUsd ?? 0);
  });

  it('still emits the analysis row when nothing was built', () => {
    const { rows } = reduceTrace([{ stage: 'planner', record: rec(0.01) }], meta);
    expect(rows.map((r) => r.rowKey)).toEqual([ANALYSIS_ROW_KEY]);
  });

  it('omits config when absent and carries it when present (exactOptionalPropertyTypes)', () => {
    const without = reduceTrace([{ stage: 'planner', record: rec(0.01) }], meta).run;
    expect('config' in without).toBe(false);
    const withCfg = reduceTrace([{ stage: 'planner', record: rec(0.01) }], { ...meta, config: { v: 'cheap' } });
    expect(withCfg.run.config).toEqual({ v: 'cheap' });
  });
});
