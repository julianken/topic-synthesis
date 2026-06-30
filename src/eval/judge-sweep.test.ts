import { describe, expect, it } from 'vitest';
import type { LessonBrief } from '../domain/stages';
import {
  BatchClient,
  type BatchTransport,
  type BatchTransportEntry,
  type BatchTransportRequest,
} from '../llm/batch-client';
import { estimateCostUsd } from '../llm/pricing';
import { JUDGE_SYSTEM } from '../trace/judge';
import { type BatchedJudgeInput, judgeBriefsBatched, sweepCostUsd } from './judge-sweep';

const brief = (goal: string): LessonBrief => ({
  learningGoal: goal,
  keyPoints: ['kp1', 'kp2'],
  findings: [{ claim: 'grounded fact', source: { url: 'https://s.example', title: 'S' } }],
  audience: 'a self-taught developer',
});

/**
 * A fake `BatchTransport` keyed by a map of `custom_id → entry`. It records the lowered requests (so a
 * test can assert the 1-hour cache flag + shared system prefix) and returns the configured entries on
 * `results`. NO live spend. Entries default to `succeeded` with a fixed verdict JSON.
 */
function fakeTransport(entryFor: (customId: string) => BatchTransportEntry): BatchTransport & {
  submitted: BatchTransportRequest[];
} {
  return {
    submitted: [] as BatchTransportRequest[],
    async create(requests) {
      this.submitted = requests;
      return 'batch_judge_1';
    },
    async retrieve() {
      return 'ended';
    },
    async results() {
      return this.submitted.map((r) => entryFor(r.customId));
    },
  } as BatchTransport & { submitted: BatchTransportRequest[] };
}

const verdictEntry = (
  customId: string,
  verdict: { groundedness: number; goalClarity: number; audienceFit: number },
  usage = { inputTokens: 100, outputTokens: 20 },
): BatchTransportEntry => ({
  customId,
  status: 'succeeded',
  text: JSON.stringify(verdict),
  finishReason: 'stop',
  providerModel: 'anthropic:claude-opus-4-8',
  usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cacheWriteTokens: 0, cacheReadTokens: 0 },
});

const inputs: BatchedJudgeInput[] = [
  { customId: 'topic-a', brief: brief('understand A') },
  { customId: 'topic-b', brief: brief('understand B') },
];

describe('judgeBriefsBatched', () => {
  it('submits ONE batch with the shared JUDGE_SYSTEM prefix marked for 1-hour caching (AC #4)', async () => {
    const transport = fakeTransport((id) => verdictEntry(id, { groundedness: 0.9, goalClarity: 0.8, audienceFit: 0.7 }));
    const client = new BatchClient(transport, { sleep: async () => {} });
    await judgeBriefsBatched(inputs, client);
    expect(transport.submitted).toHaveLength(2);
    for (const r of transport.submitted) {
      expect(r.system).toBe(JUDGE_SYSTEM);
      expect(r.cacheSystem).toBe(true); // 1-hour prompt caching on the repeated prefix
    }
  });

  it('fans verdicts back to the right custom_id even when results arrive out of order', async () => {
    const verdicts: Record<string, { groundedness: number; goalClarity: number; audienceFit: number }> = {
      'topic-a': { groundedness: 0.91, goalClarity: 0.81, audienceFit: 0.71 },
      'topic-b': { groundedness: 0.42, goalClarity: 0.52, audienceFit: 0.62 },
    };
    // Return results in REVERSE submit order to prove fan-back is by custom_id, not position.
    const reversing: BatchTransport = {
      async create() {
        return 'batch_judge_1';
      },
      async retrieve() {
        return 'ended';
      },
      async results() {
        return inputs.map((i) => verdictEntry(i.customId, verdicts[i.customId]!)).reverse();
      },
    };
    const client = new BatchClient(reversing, { sleep: async () => {} });
    const out = await judgeBriefsBatched(inputs, client);
    const a = out.get('topic-a');
    const b = out.get('topic-b');
    expect(a?.ok).toBe(true);
    expect(b?.ok).toBe(true);
    if (a?.ok) expect(a.result.scores.groundedness).toBeCloseTo(0.91, 6);
    if (b?.ok) expect(b.result.scores.audienceFit).toBeCloseTo(0.62, 6);
  });

  it("records each verdict's cost at the BATCH rate (~half the synchronous estimate) (AC #2)", async () => {
    const usage = { inputTokens: 40_000, outputTokens: 8_000 };
    const transport = fakeTransport((id) =>
      verdictEntry(id, { groundedness: 0.5, goalClarity: 0.5, audienceFit: 0.5 }, usage),
    );
    const client = new BatchClient(transport, { sleep: async () => {} });
    const out = await judgeBriefsBatched([inputs[0]!], client);
    const a = out.get('topic-a');
    expect(a?.ok).toBe(true);
    if (a?.ok) {
      const sync = estimateCostUsd('anthropic:claude-opus-4-8', usage);
      expect(a.result.record.costUsd).toBeCloseTo(sync / 2, 9);
    }
  });

  it('surfaces a failed batch entry as ok:false without dropping its succeeded siblings', async () => {
    const transport = fakeTransport((id) =>
      id === 'topic-b'
        ? { customId: id, status: 'errored', error: 'invalid_request: over the cap' }
        : verdictEntry(id, { groundedness: 0.9, goalClarity: 0.8, audienceFit: 0.7 }),
    );
    const client = new BatchClient(transport, { sleep: async () => {} });
    const out = await judgeBriefsBatched(inputs, client);
    expect(out.get('topic-a')?.ok).toBe(true);
    const b = out.get('topic-b');
    expect(b?.ok).toBe(false);
    if (b && !b.ok) expect(b.error).toMatch(/invalid_request/);
  });

  it('surfaces an unparseable verdict as ok:false (a malformed-JSON judge response)', async () => {
    const transport = fakeTransport((id) => ({
      customId: id,
      status: 'succeeded',
      text: 'the brief looks great honestly',
      finishReason: 'stop',
      providerModel: 'anthropic:claude-opus-4-8',
      usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
    }));
    const client = new BatchClient(transport, { sleep: async () => {} });
    const out = await judgeBriefsBatched([inputs[0]!], client);
    const a = out.get('topic-a');
    expect(a?.ok).toBe(false);
    if (a && !a.ok) expect(a.error).toMatch(/not JSON|validation/);
  });

  it('parses a verdict wrapped in a ```json code fence', async () => {
    const transport = fakeTransport((id) => ({
      customId: id,
      status: 'succeeded',
      text: '```json\n{"groundedness": 0.6, "goalClarity": 0.7, "audienceFit": 0.8}\n```',
      finishReason: 'stop',
      providerModel: 'anthropic:claude-opus-4-8',
      usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
    }));
    const client = new BatchClient(transport, { sleep: async () => {} });
    const out = await judgeBriefsBatched([inputs[0]!], client);
    const a = out.get('topic-a');
    expect(a?.ok).toBe(true);
    if (a?.ok) expect(a.result.scores.goalClarity).toBeCloseTo(0.7, 6);
  });
});

describe('sweepCostUsd', () => {
  it('sums only the succeeded verdicts at the batch rate', async () => {
    const transport = fakeTransport((id) =>
      id === 'topic-b'
        ? { customId: id, status: 'expired' }
        : verdictEntry(id, { groundedness: 0.9, goalClarity: 0.8, audienceFit: 0.7 }, { inputTokens: 1000, outputTokens: 1000 }),
    );
    const client = new BatchClient(transport, { sleep: async () => {} });
    const out = await judgeBriefsBatched(inputs, client);
    const total = sweepCostUsd(out);
    const a = out.get('topic-a');
    expect(a?.ok).toBe(true);
    if (a?.ok) expect(total).toBeCloseTo(a.result.record.costUsd, 12); // only topic-a counts; topic-b expired
  });
});
