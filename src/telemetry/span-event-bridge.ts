/**
 * Bridges the existing cost/token trace seam into the event stream WITHOUT re-threading the pipeline.
 * `run-pipeline` already notifies a `TraceSink` once per LLM call (`emit(stage, records) →
 * sink.onSpan({stage, record})`); each `LlmCallRecord` carries `providerModel`/tokens/`costUsd`. So
 * the Job injects this adapter where it used to pass `noopSink`, and every span becomes an `llm.call`
 * event — giving #167 cost/model/calls per phase. `stage` is normalized to the canonical vocabulary
 * (`stageLabel`) so the cost panels join the `step.finish` latency panels on the same phase keys.
 * Fence-clean (types only).
 */
import type { TraceSink, TraceSpan } from '../pipeline/ports';
import { stageLabel, type EventSink } from './events';

export class SpanToEventSink implements TraceSink {
  constructor(private readonly sink: EventSink) {}

  onSpan(span: TraceSpan): void {
    const r = span.record;
    const base = {
      eventType: 'llm.call' as const,
      stage: stageLabel(span.stage),
      model: r.providerModel,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      costUsd: r.costUsd,
    };
    // The streaming `code` call (PR-1) sets ALL the per-call timing fields together; a blocking call
    // sets none. Narrow on the whole group so the streamed branch assigns numbers (no explicit
    // `undefined` under exactOptionalPropertyTypes) and the blocking branch omits them entirely.
    // tokensPerSec is DERIVED here (the record stores genMs + outputTokens, not the throughput).
    if (
      r.ttftMs !== undefined &&
      r.genMs !== undefined &&
      r.maxTokens !== undefined &&
      r.outputBytes !== undefined
    ) {
      void this.sink.onEvent({
        ...base,
        ttftMs: r.ttftMs,
        genMs: r.genMs,
        tokensPerSec: r.genMs > 0 ? Math.round(r.outputTokens / (r.genMs / 1000)) : 0,
        maxTokens: r.maxTokens,
        outputBytes: r.outputBytes,
      });
    } else {
      void this.sink.onEvent(base);
    }
  }
}
