import type { LlmCallRecord } from '../llm/client';
import type { TraceSink, TraceSpan } from '../pipeline/ports';
import type { EvalSpan } from './eval-records';

/**
 * A `TraceSink` that accumulates the pipeline's per-call spans in execution order. The eval/CLI
 * path injects one into `runPipeline`; afterward `reduce.ts` turns the collected spans into an
 * eleatic run + rows. Pure data — imports nothing from `@eleatic/eval` (see eval-records.ts).
 */
export class SpanCollector implements TraceSink {
  private readonly captured: TraceSpan[] = [];

  onSpan(span: TraceSpan): void {
    this.captured.push(span);
  }

  /** The captured spans, in execution order. */
  spans(): readonly TraceSpan[] {
    return this.captured;
  }
}

/**
 * cost + tokens for one call → an EvalSpan.metrics. By default (the historical path) it returns ONLY
 * `{promptTokens, completionTokens, totalTokens, costUsd}` — no wall-clock. With `includeTiming` and a
 * record that carries streamed-call timing (`ttftMs`/`genMs`, populated only by the `code` stage's
 * streamed call — issue #176), it ALSO emits `durationMs` (= ttftMs + genMs, eleatic's NATIVE column)
 * plus the additive `ttftMs`/`genMs`/`tokensPerSec` (derived)/`outputBytes`/`maxTokens` keys (issue
 * #179). Opt-in + additive: with the flag off, or on a blocking-call record (no timing), the output is
 * byte-identical to before. Each optional field is spread conditionally so an absent one is OMITTED,
 * never `undefined` (exactOptionalPropertyTypes).
 */
export function metricsOf(record: LlmCallRecord, includeTiming = false): NonNullable<EvalSpan['metrics']> {
  const base = {
    promptTokens: record.inputTokens,
    completionTokens: record.outputTokens,
    totalTokens: record.inputTokens + record.outputTokens,
    costUsd: record.costUsd,
  };
  // Timing is present ONLY on a streamed call (today just `code`); a blocking-call record leaves
  // ttftMs/genMs undefined, so even with the flag on it stays wall-clock-free.
  if (!includeTiming || record.ttftMs === undefined || record.genMs === undefined) return base;
  const { ttftMs, genMs } = record;
  return {
    ...base,
    durationMs: ttftMs + genMs, // total call wall-clock → eleatic's native duration column
    ttftMs,
    genMs,
    // tokensPerSec is DERIVED here (outputTokens / generation seconds), not read — it lives on the PR-1
    // event, not on LlmCallRecord. Guard genMs === 0 so a zero-duration record never yields Infinity/NaN.
    ...(genMs > 0 ? { tokensPerSec: record.outputTokens / (genMs / 1000) } : {}),
    ...(record.outputBytes !== undefined ? { outputBytes: record.outputBytes } : {}),
    ...(record.maxTokens !== undefined ? { maxTokens: record.maxTokens } : {}),
  };
}

/** The span tags that are scoring passes (a verdict over an artifact), not generation calls. */
const SCORER_STAGES = new Set<TraceSpan['stage']>(['critic', 'judge']);

/**
 * Build a self-contained EvalSpan subtree for one row: a `task` root named `rootName`, with each
 * call as an `llm` (or `scorer`, for the critic and the LLM-judge) child carrying that call's
 * cost/token metrics. ids are namespaced under `rootName` so subtrees from different rows never
 * collide. `includeTiming` (issue #179) is forwarded to `metricsOf`, so the per-call wall-clock rides
 * the streamed `code` child only under the opt-in `--trace-timing`; default → wall-clock-free.
 */
export function spanTreeFor(rootName: string, spans: readonly TraceSpan[], includeTiming = false): EvalSpan[] {
  const root: EvalSpan = { id: rootName, parentId: null, name: rootName, kind: 'task' };
  const children = spans.map((span, i): EvalSpan => ({
    id: `${rootName}:${span.stage}:${i}`,
    parentId: rootName,
    name: span.stage,
    kind: SCORER_STAGES.has(span.stage) ? 'scorer' : 'llm',
    metrics: metricsOf(span.record, includeTiming),
  }));
  return [root, ...children];
}
