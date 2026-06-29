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
   * Another run's id this run is paired against (issue #51): eleatic uses `EvalRunRecord.baseline`
   * to compare two arms over the SAME topic, so an Analysis-only change is ranked arm-vs-arm, not
   * just by absolute USD. The CLI reads it from a `--baseline <runId>` flag. Absent → the field is
   * OMITTED from the run record (not `undefined` — the `exactOptionalPropertyTypes` discipline).
   */
  baseline?: string;
  /**
   * The Analysis phase's product — the assembled `LessonBrief` — carried as the `_analysis` row's
   * `output` (issue #50). When present, an Analysis-only eval arm is inspectable/scoreable end-to-end
   * WITHOUT running Synthesis. Typed loosely (`EvalRowRecord.output` is `unknown`) so `reduce.ts`
   * imports no domain stage type and stays a pure trace reducer. Absent → the legacy `{ phase:
   * 'analysis' }` sentinel, so existing callers (and a brief-less run) are unchanged.
   */
  analysisOutput?: unknown;
  /**
   * Per-slug critic pass/fail (slug → passed), threaded by the CLI from the pipeline result it
   * already holds (each `CritiquedArtifact` has `.nodeSlug` + `.passed`) — NOT read from a span,
   * because a `TraceSpan` is a call-level record with no verdict (issue #51). When a synthesis row's
   * slug is present here, `reduceTrace` writes `scores.passed` (1/0) onto it ALONGSIDE the existing
   * `costUsd`/`calls` — a QUALITY signal on the synthesis row, not a replacement of the cost signal.
   */
  verdicts?: Record<string, boolean>;
  /**
   * The LLM-judge's quality sub-scores over the `LessonBrief` (groundedness/goalClarity/audienceFit),
   * computed by the CLI/eval path (src/trace/judge.ts) and merged onto the `_analysis` row's `scores`
   * alongside `costUsd`/`calls` (issue #51). `reduce.ts` stays pure: it receives the numbers, it never
   * calls the judge. Absent → the analysis row carries cost only, as before.
   */
  analysisScores?: Record<string, number>;
  /**
   * OPT-IN per-call wall-clock for the streamed `code` call (issue #179). When true, `spanTreeFor` →
   * `metricsOf` emits `durationMs`/`ttftMs`/`genMs`/`tokensPerSec`/`outputBytes`/`maxTokens` on the
   * `code` span (other, blocking-call spans carry no timing and are unchanged). The CLI reads it from
   * a `--trace-timing` flag. Absent/false → the trace is byte-identical to today (wall-clock-free). It
   * only forwards the boolean; `reduce.ts` reads no clock and stays pure.
   */
  includeTiming?: boolean;
}

const sumCost = (spans: readonly TraceSpan[]): number => spans.reduce((sum, s) => sum + s.record.costUsd, 0);

function row(
  runId: string,
  rowKey: string,
  output: unknown,
  spans: readonly TraceSpan[],
  // Extra QUALITY scores merged AFTER the cost signal, so cost is preserved, never replaced (issue
  // #51: the critic verdict on a synthesis row, the LLM-judge scores on the analysis row).
  extraScores: Record<string, number> = {},
  // Forwarded to spanTreeFor → metricsOf: opt-in per-call wall-clock on the streamed `code` span
  // (issue #179). Default false → wall-clock-free, byte-identical output.
  includeTiming = false,
): EvalRowRecord {
  return {
    runId,
    rowKey,
    output,
    expected: null,
    scores: { costUsd: sumCost(spans), calls: spans.length, ...extraScores },
    trace: { spans: spanTreeFor(rowKey, spans, includeTiming) },
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
  // The LLM-judge's quality scores ride onto the analysis row alongside its cost (issue #51); absent
  // → the row carries cost only.
  const analysisScores = meta.analysisScores ?? {};
  // Opt-in per-call wall-clock (issue #179) — forwarded into each row's span tree; default false.
  const includeTiming = meta.includeTiming ?? false;
  if (analysis.length > 0)
    rows.push(row(meta.runId, ANALYSIS_ROW_KEY, analysisOutput, analysis, analysisScores, includeTiming));
  for (const [slug, nodeSpans] of byNode) {
    // The critic's pass/fail (1/0) rides onto the synthesis row alongside its cost (issue #51) when
    // the CLI threaded a verdict for this slug; absent → the row carries cost only, as before.
    const verdict = meta.verdicts?.[slug];
    const extra = verdict !== undefined ? { passed: verdict ? 1 : 0 } : {};
    rows.push(row(meta.runId, slug, { phase: 'synthesis', slug }, nodeSpans, extra, includeTiming));
  }

  const run: EvalRunRecord = {
    id: meta.runId,
    label: meta.label,
    startedAt: meta.startedAt,
    // Conditionally spread the optional fields so an absent one is OMITTED, not set to `undefined`
    // (exactOptionalPropertyTypes), matching how `config` is threaded.
    ...(meta.baseline !== undefined ? { baseline: meta.baseline } : {}),
    ...(meta.config !== undefined ? { config: meta.config } : {}),
    metrics: { costUsd: sumCost(spans), calls: spans.length },
  };
  return { run, rows };
}
