import type { TraceSpan } from '../pipeline/ports';
import type { EvalRowRecord, EvalRunRecord } from './eval-records';
import { spanTreeFor } from './span';

/** Sentinel rowKey for the run-level analysis phase (plan/research/graph), which has no page. */
export const ANALYSIS_ROW_KEY = '_analysis';

export interface TraceMeta {
  runId: string;
  label: string;
  /** ISO-8601 start time — the caller stamps it (runPipeline has no clock by design). */
  startedAt: string;
  /** Optional run-config snapshot (workflow_version / model snapshots) → eleatic config_json. */
  config?: Record<string, unknown>;
  /**
   * The Analysis phase's product — the assembled `LessonBrief` — carried as the `_analysis` row's
   * `output` (issue #50). When present, an Analysis-only eval arm is inspectable/scoreable end-to-end
   * WITHOUT running Synthesis. Typed loosely (`EvalRowRecord.output` is `unknown`) so `reduce.ts`
   * imports no domain stage type and stays a pure trace reducer. Absent → the legacy `{ phase:
   * 'analysis' }` sentinel, so existing callers (and a brief-less run) are unchanged.
   */
  analysisOutput?: unknown;
}

const sumCost = (spans: readonly TraceSpan[]): number => spans.reduce((sum, s) => sum + s.record.costUsd, 0);

function row(runId: string, rowKey: string, output: unknown, spans: readonly TraceSpan[]): EvalRowRecord {
  return {
    runId,
    rowKey,
    output,
    expected: null,
    scores: { costUsd: sumCost(spans), calls: spans.length },
    trace: { spans: spanTreeFor(rowKey, spans) },
  };
}

/**
 * Reduce the pipeline's per-call spans into one eleatic run + its rows. Pure — no I/O, no
 * `@eleatic/eval` import (uses the local mirror types). The run is the generation invocation;
 * rows are one analysis row (the run-level plan/research/graph stages) plus one row per built
 * page (rowKey = the node slug), each carrying its own span subtree + summed cost. A run with no
 * synthesis spans (all nodes routed soon/text) still gets the analysis row. The summed row cost
 * equals the run cost — every call lands in exactly one row.
 */
export function reduceTrace(
  spans: readonly TraceSpan[],
  meta: TraceMeta,
): { run: EvalRunRecord; rows: EvalRowRecord[] } {
  const analysis = spans.filter((s) => s.nodeSlug === undefined);
  const byNode = new Map<string, TraceSpan[]>();
  for (const span of spans) {
    if (span.nodeSlug === undefined) continue;
    const list = byNode.get(span.nodeSlug) ?? [];
    list.push(span);
    byNode.set(span.nodeSlug, list);
  }

  const rows: EvalRowRecord[] = [];
  // The analysis row's output carries the assembled LessonBrief when the caller threads it (issue #50
  // OWNS this swap — it carries the Analysis OUTPUT; issue #51 owns the analysis-row SCORES, untouched
  // here). Absent → the legacy `{ phase: 'analysis' }` sentinel, so a brief-less run is unchanged.
  const analysisOutput = meta.analysisOutput ?? { phase: 'analysis' };
  if (analysis.length > 0) rows.push(row(meta.runId, ANALYSIS_ROW_KEY, analysisOutput, analysis));
  for (const [slug, nodeSpans] of byNode) rows.push(row(meta.runId, slug, { phase: 'synthesis', slug }, nodeSpans));

  const run: EvalRunRecord = {
    id: meta.runId,
    label: meta.label,
    startedAt: meta.startedAt,
    ...(meta.config !== undefined ? { config: meta.config } : {}),
    metrics: { costUsd: sumCost(spans), calls: spans.length },
  };
  return { run, rows };
}
