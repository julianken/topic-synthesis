import { describe, expect, it } from 'vitest';
import {
  BatchClient,
  type BatchRequest,
  type BatchTransport,
  type BatchTransportEntry,
  type BatchTransportRequest,
} from './batch-client';
import { STAGE_MODELS } from './models';
import { estimateCostUsd } from './pricing';

/**
 * A fully in-memory `BatchTransport` — NO live spend. It records the lowered requests, reports
 * `in_progress` for the first `pollsUntilEnded` retrieves then `ended`, and returns a fixed entry list on
 * `results` (which can be out of submit order, to prove `custom_id` fan-back doesn't depend on position).
 */
function fakeTransport(opts: {
  entries: BatchTransportEntry[];
  pollsUntilEnded?: number;
}): BatchTransport & { submitted: BatchTransportRequest[]; createdId: string; pollCount: number } {
  const state = {
    submitted: [] as BatchTransportRequest[],
    createdId: '',
    pollCount: 0,
  };
  const pollsUntilEnded = opts.pollsUntilEnded ?? 1;
  return {
    ...state,
    async create(requests) {
      this.submitted = requests;
      this.createdId = 'batch_test_1';
      return this.createdId;
    },
    async retrieve() {
      this.pollCount += 1;
      return this.pollCount >= pollsUntilEnded ? 'ended' : 'in_progress';
    },
    async results() {
      return opts.entries;
    },
  };
}

const succeeded = (
  customId: string,
  providerModel: string,
  usage: { inputTokens: number; outputTokens: number; cacheWriteTokens?: number; cacheReadTokens?: number },
  text = 'ok',
): BatchTransportEntry => ({
  customId,
  status: 'succeeded',
  text,
  finishReason: 'stop',
  providerModel,
  usage: {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
  },
});

const reqs: BatchRequest[] = [
  { customId: 'a', model: STAGE_MODELS.critic, prompt: 'judge a', system: 'SYS', cacheSystem: true },
  { customId: 'b', model: STAGE_MODELS.critic, prompt: 'judge b', system: 'SYS', cacheSystem: true },
];

describe('BatchClient.submit', () => {
  it('lowers each request to the wire shape — bare model id, system + 1h cache flag preserved', async () => {
    const transport = fakeTransport({ entries: [] });
    const client = new BatchClient(transport, { sleep: async () => {} });
    const id = await client.submit(reqs);
    expect(id).toBe('batch_test_1');
    expect(transport.submitted.map((r) => r.customId)).toEqual(['a', 'b']);
    expect(transport.submitted[0]?.model).toBe(STAGE_MODELS.critic.model); // bare id, not provider:model
    expect(transport.submitted[0]?.system).toBe('SYS');
    expect(transport.submitted[0]?.cacheSystem).toBe(true);
  });
});

describe('BatchClient.poll', () => {
  it('returns false until the transport reports ended, then true', async () => {
    const transport = fakeTransport({ entries: [], pollsUntilEnded: 3 });
    const client = new BatchClient(transport, { sleep: async () => {} });
    expect(await client.poll('batch_test_1')).toBe(false);
    expect(await client.poll('batch_test_1')).toBe(false);
    expect(await client.poll('batch_test_1')).toBe(true);
  });
});

describe('BatchClient.collect — custom_id fan-back', () => {
  it('maps every entry back to its custom_id regardless of result order', async () => {
    // Results returned in REVERSE submit order — fan-back must key by custom_id, never position.
    const transport = fakeTransport({
      entries: [
        succeeded('b', 'anthropic:claude-opus-4-8', { inputTokens: 10, outputTokens: 5 }, 'B-text'),
        succeeded('a', 'anthropic:claude-opus-4-8', { inputTokens: 10, outputTokens: 5 }, 'A-text'),
      ],
    });
    const client = new BatchClient(transport, { sleep: async () => {} });
    const out = await client.collect('batch_test_1');
    const a = out.get('a');
    const b = out.get('b');
    expect(a?.ok).toBe(true);
    expect(b?.ok).toBe(true);
    if (a?.ok) expect(a.text).toBe('A-text');
    if (b?.ok) expect(b.text).toBe('B-text');
  });
});

describe('BatchClient cost (issue #188 — batch rate, not full rate)', () => {
  it('records costUsd at ~half the synchronous estimateCostUsd for the same tokens', async () => {
    const usage = { inputTokens: 50_000, outputTokens: 12_000 };
    const transport = fakeTransport({ entries: [succeeded('a', 'anthropic:claude-opus-4-8', usage)] });
    const client = new BatchClient(transport, { sleep: async () => {} });
    const out = await client.collect('batch_test_1');
    const a = out.get('a');
    expect(a?.ok).toBe(true);
    if (a?.ok) {
      const sync = estimateCostUsd('anthropic:claude-opus-4-8', usage);
      expect(a.record.costUsd).toBeCloseTo(sync / 2, 9); // the 50% discount lands in the record
      expect(a.record.providerModel).toBe('anthropic:claude-opus-4-8');
    }
  });
});

describe('BatchClient — a failed entry surfaces without crashing the sweep', () => {
  it('keeps succeeded siblings and reports the errored entry as ok:false', async () => {
    const transport = fakeTransport({
      entries: [
        succeeded('a', 'anthropic:claude-opus-4-8', { inputTokens: 10, outputTokens: 5 }),
        { customId: 'b', status: 'errored', error: 'invalid_request: bad params' },
        { customId: 'c', status: 'expired' },
      ],
    });
    const client = new BatchClient(transport, { sleep: async () => {} });
    const out = await client.collect('batch_test_1');
    expect(out.get('a')?.ok).toBe(true);
    const b = out.get('b');
    const c = out.get('c');
    expect(b?.ok).toBe(false);
    if (b && !b.ok) expect(b.error).toMatch(/invalid_request/);
    expect(c?.ok).toBe(false);
    if (c && !c.ok) expect(c.error).toMatch(/expired/);
  });
});

describe('BatchClient.run — submit → poll → collect end to end', () => {
  it('drives the whole flow with no real timers and fans results back by custom_id', async () => {
    const transport = fakeTransport({
      entries: [succeeded('a', 'anthropic:claude-opus-4-8', { inputTokens: 1, outputTokens: 1 })],
      pollsUntilEnded: 2,
    });
    const client = new BatchClient(transport, { sleep: async () => {}, pollIntervalMs: 0 });
    const out = await client.run([reqs[0]!]);
    expect(transport.pollCount).toBeGreaterThanOrEqual(2);
    expect(out.get('a')?.ok).toBe(true);
  });
});
