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
    void this.sink.onEvent({
      eventType: 'llm.call',
      stage: stageLabel(span.stage),
      model: span.record.providerModel,
      inputTokens: span.record.inputTokens,
      outputTokens: span.record.outputTokens,
      costUsd: span.record.costUsd,
    });
  }
}
