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

/** cost + tokens for one call → an EvalSpan.metrics; omits startMs/durationMs (no wall-clock). */
export function metricsOf(record: LlmCallRecord): NonNullable<EvalSpan['metrics']> {
  return {
    promptTokens: record.inputTokens,
    completionTokens: record.outputTokens,
    totalTokens: record.inputTokens + record.outputTokens,
    costUsd: record.costUsd,
  };
}

/**
 * Build a self-contained EvalSpan subtree for one row: a `task` root named `rootName`, with each
 * call as an `llm` (or `scorer`, for the critic) child carrying that call's cost/token metrics.
 * ids are namespaced under `rootName` so subtrees from different rows never collide.
 */
export function spanTreeFor(rootName: string, spans: readonly TraceSpan[]): EvalSpan[] {
  const root: EvalSpan = { id: rootName, parentId: null, name: rootName, kind: 'task' };
  const children = spans.map((span, i): EvalSpan => ({
    id: `${rootName}:${span.stage}:${i}`,
    parentId: rootName,
    name: span.stage,
    kind: span.stage === 'critic' ? 'scorer' : 'llm',
    metrics: metricsOf(span.record),
  }));
  return [root, ...children];
}
