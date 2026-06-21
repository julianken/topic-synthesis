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

  it('carries the assembled LessonBrief as the analysis row output when provided (issue #50)', () => {
    const brief = {
      learningGoal: 'understand the Fourier transform',
      keyPoints: ['frequency domain', 'orthogonality'],
      findings: [{ claim: 'sin and cos are orthogonal', source: { url: 'https://x', title: 'X' } }],
      audience: 'devs',
    };
    const { rows } = reduceTrace([{ stage: 'planner', record: rec(0.01) }], { ...meta, analysisOutput: brief });
    const analysisRow = rows.find((r) => r.rowKey === ANALYSIS_ROW_KEY);
    expect(analysisRow?.output).toEqual(brief); // the Analysis product, not the { phase: 'analysis' } sentinel
    expect(analysisRow?.output).not.toEqual({ phase: 'analysis' });
  });

  it('falls back to the { phase: "analysis" } sentinel when no brief is threaded', () => {
    const { rows } = reduceTrace([{ stage: 'planner', record: rec(0.01) }], meta);
    expect(rows.find((r) => r.rowKey === ANALYSIS_ROW_KEY)?.output).toEqual({ phase: 'analysis' });
  });

  it('omits config when absent and carries it when present (exactOptionalPropertyTypes)', () => {
    const without = reduceTrace([{ stage: 'planner', record: rec(0.01) }], meta).run;
    expect('config' in without).toBe(false);
    const withCfg = reduceTrace([{ stage: 'planner', record: rec(0.01) }], { ...meta, config: { v: 'cheap' } });
    expect(withCfg.run.config).toEqual({ v: 'cheap' });
  });

  it('writes the critic verdict (1/0) onto the matching synthesis row, keeping cost (issue #51)', () => {
    const spans: TraceSpan[] = [
      { stage: 'planner', record: rec(0.01) },
      { stage: 'spec', nodeSlug: 'sine', record: rec(0.03) },
      { stage: 'code', nodeSlug: 'sine', record: rec(0.04) },
      { stage: 'spec', nodeSlug: 'cosine', record: rec(0.05) },
    ];
    const { rows } = reduceTrace(spans, { ...meta, verdicts: { sine: true, cosine: false } });
    const sine = rows.find((r) => r.rowKey === 'sine');
    const cosine = rows.find((r) => r.rowKey === 'cosine');
    expect(sine?.scores?.passed).toBe(1); // AC 2 — verdict true → 1
    expect(cosine?.scores?.passed).toBe(0); // AC 3 — verdict false → 0
    // AC 4 — the cost signal is preserved alongside `passed`, not replaced.
    expect(sine?.scores?.calls).toBe(2);
    expect(sine?.scores?.costUsd).toBeCloseTo(0.07);
  });

  it('leaves a synthesis row without `passed` when no verdict is threaded for its slug', () => {
    const spans: TraceSpan[] = [
      { stage: 'planner', record: rec(0.01) },
      { stage: 'spec', nodeSlug: 'sine', record: rec(0.03) },
    ];
    const { rows } = reduceTrace(spans, meta);
    const sine = rows.find((r) => r.rowKey === 'sine');
    expect(sine?.scores && 'passed' in sine.scores).toBe(false);
    expect(sine?.scores?.costUsd).toBeCloseTo(0.03);
  });

  it('merges the LLM-judge scores onto the _analysis row alongside cost (AC 7)', () => {
    const judgeScores = { groundedness: 0.9, goalClarity: 0.8, audienceFit: 0.7 };
    const { rows } = reduceTrace([{ stage: 'planner', record: rec(0.01) }], { ...meta, analysisScores: judgeScores });
    const analysisRow = rows.find((r) => r.rowKey === ANALYSIS_ROW_KEY);
    expect(analysisRow?.scores?.groundedness).toBe(0.9);
    expect(analysisRow?.scores?.goalClarity).toBe(0.8);
    expect(analysisRow?.scores?.audienceFit).toBe(0.7);
    expect(analysisRow?.scores?.costUsd).toBeCloseTo(0.01); // cost preserved
    expect(analysisRow?.scores?.calls).toBe(1);
  });

  it('sets baseline on the run when provided, OMITS it when not (AC 8, exactOptionalPropertyTypes)', () => {
    const without = reduceTrace([{ stage: 'planner', record: rec(0.01) }], meta).run;
    expect('baseline' in without).toBe(false); // absent, not undefined
    const withBaseline = reduceTrace([{ stage: 'planner', record: rec(0.01) }], { ...meta, baseline: 'run0' }).run;
    expect(withBaseline.baseline).toBe('run0');
  });

  it('a judge span (no nodeSlug) folds into the _analysis row, keeping the row-sum invariant (AC 10)', () => {
    const spans: TraceSpan[] = [
      { stage: 'planner', record: rec(0.01) },
      { stage: 'spec', nodeSlug: 'a', record: rec(0.02) },
      { stage: 'judge', record: rec(0.05) }, // the post-pipeline judge call — no nodeSlug
    ];
    const { run, rows } = reduceTrace(spans, meta);
    const analysisRow = rows.find((r) => r.rowKey === ANALYSIS_ROW_KEY);
    // The judge cost lands in the analysis row, not a phantom extra row.
    expect(rows.map((r) => r.rowKey)).toEqual([ANALYSIS_ROW_KEY, 'a']);
    expect(analysisRow?.scores?.costUsd).toBeCloseTo(0.06); // planner 0.01 + judge 0.05
    const rowSum = rows.reduce((s, r) => s + (r.scores?.costUsd ?? 0), 0);
    expect(rowSum).toBeCloseTo(run.metrics?.costUsd ?? 0); // judge spend never escapes the invariant
  });
});
