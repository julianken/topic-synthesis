import { describe, expect, it } from 'vitest';
import type { WorkflowEvent } from './events';
import { SpanToEventSink } from './span-event-bridge';

const record = {
  providerModel: 'anthropic:claude-haiku-4-5',
  inputTokens: 10,
  outputTokens: 20,
  costUsd: 0.001,
  rawUsage: {},
  finishReason: 'stop',
};

describe('SpanToEventSink', () => {
  it('maps a span to one llm.call event (model<-providerModel, canonical stage)', () => {
    const events: WorkflowEvent[] = [];
    const bridge = new SpanToEventSink({ onEvent: (e) => void events.push(e) });
    bridge.onSpan({ stage: 'planner', record });
    expect(events).toEqual([
      {
        eventType: 'llm.call',
        stage: 'plan', // normalized from the 'planner' Stage so it joins the 'plan' step.finish
        model: 'anthropic:claude-haiku-4-5',
        inputTokens: 10,
        outputTokens: 20,
        costUsd: 0.001,
      },
    ]);
  });

  it('passes already-canonical stages through unchanged', () => {
    const events: WorkflowEvent[] = [];
    new SpanToEventSink({ onEvent: (e) => void events.push(e) }).onSpan({ stage: 'code', record });
    expect((events[0] as { stage: string }).stage).toBe('code');
  });

  it('carries per-call timing + a DERIVED tokensPerSec for a streamed (code) call (PR-1)', () => {
    const events: WorkflowEvent[] = [];
    const streamed = { ...record, outputTokens: 400, ttftMs: 1200, genMs: 4000, maxTokens: 32000, outputBytes: 18000 };
    new SpanToEventSink({ onEvent: (e) => void events.push(e) }).onSpan({ stage: 'code', record: streamed });
    expect(events[0]).toMatchObject({
      eventType: 'llm.call',
      stage: 'code',
      ttftMs: 1200,
      genMs: 4000,
      maxTokens: 32000,
      outputBytes: 18000,
      tokensPerSec: 100, // 400 tokens / (4000ms / 1000) = 100 tok/s
    });
  });

  it('omits the timing fields entirely for a blocking call (record without them)', () => {
    const events: WorkflowEvent[] = [];
    new SpanToEventSink({ onEvent: (e) => void events.push(e) }).onSpan({ stage: 'planner', record });
    expect(Object.keys(events[0] as object)).not.toContain('ttftMs');
    expect(Object.keys(events[0] as object)).not.toContain('tokensPerSec');
  });
});
