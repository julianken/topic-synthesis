import { describe, expect, it, vi } from 'vitest';
import { classifyCategory, normalizeCategory } from './classify-category';
import type { StageDeps } from './deps';

const rec = {
  providerModel: 'anthropic:claude-haiku-4-5',
  inputTokens: 1,
  outputTokens: 1,
  costUsd: 0.0001,
  rawUsage: {},
  finishReason: 'stop',
};

describe('normalizeCategory (copy-appropriateness — pure)', () => {
  it('uppercases a real one- or two-word subject label', () => {
    expect(normalizeCategory('Biology')).toBe('BIOLOGY');
    expect(normalizeCategory('computer science')).toBe('COMPUTER SCIENCE');
    expect(normalizeCategory('  Mathematics  ')).toBe('MATHEMATICS');
  });

  it('rejects internal/render-backend identifiers — never the interactionKind enum on a user surface', () => {
    // The exact leak the copy-appropriateness gate forbids.
    expect(normalizeCategory('svg')).toBeNull();
    expect(normalizeCategory('canvas')).toBeNull();
    expect(normalizeCategory('html')).toBeNull();
    expect(normalizeCategory('TS')).toBeNull();
    expect(normalizeCategory('ADR')).toBeNull();
    expect(normalizeCategory('Lesson')).toBeNull();
  });

  it('rejects generic filler the eyebrow must never show', () => {
    expect(normalizeCategory('General')).toBeNull();
    expect(normalizeCategory('Other')).toBeNull();
    expect(normalizeCategory('Misc')).toBeNull();
    expect(normalizeCategory('NONE')).toBeNull();
  });

  it('rejects non-alpha / code-ish / sentence / over-long / empty answers → null', () => {
    expect(normalizeCategory('Biology 101')).toBeNull(); // digits
    expect(normalizeCategory('ts-17')).toBeNull(); // identifier (hyphen)
    expect(normalizeCategory('interaction_kind')).toBeNull(); // snake_case identifier (underscore)
    expect(normalizeCategory('It belongs to biology, broadly.')).toBeNull(); // a sentence (comma/period)
    expect(normalizeCategory('https://example.com')).toBeNull(); // a url
    expect(normalizeCategory('A'.repeat(40))).toBeNull(); // over the length ceiling
    expect(normalizeCategory('')).toBeNull();
    expect(normalizeCategory('   ')).toBeNull();
    expect(normalizeCategory(null)).toBeNull();
    expect(normalizeCategory(undefined)).toBeNull();
  });
});

describe('classifyCategory (isolated, fail-safe, cheap)', () => {
  it('returns the validated uppercase label + threads the call cost record', async () => {
    const completeObject = vi.fn().mockResolvedValue({ object: { category: 'Biology' }, record: rec });
    const deps = { completeObject } as unknown as StageDeps;
    const out = await classifyCategory('Photosynthesis', deps);
    expect(out.category).toBe('BIOLOGY');
    expect(out.records).toEqual([rec]); // the real call's cost rides through like any LlmCallRecord
    // ONE short bounded call — never the synthesis arm, a tiny token budget.
    expect(completeObject).toHaveBeenCalledTimes(1);
    const call = completeObject.mock.calls[0]?.[0] as { maxTokens?: number };
    expect(call.maxTokens).toBeLessThanOrEqual(64);
  });

  it('FAIL-SAFE: a THROWING classifier never throws — it yields category null + no record', async () => {
    // The owner-reverted-prior-change guard: a classifier fault must NOT surface into the run.
    const completeObject = vi.fn().mockRejectedValue(new Error('model timeout'));
    const deps = { completeObject } as unknown as StageDeps;
    const out = await classifyCategory('Anything', deps);
    expect(out.category).toBeNull();
    expect(out.records).toEqual([]); // no honest cost row for a call that never returned
  });

  it('FAIL-SAFE: a returned-but-invalid label yields category null (the call still cost, so keep the record)', async () => {
    // The model answered, but the answer is a forbidden internal token — the eyebrow must be omitted, not
    // leaked. The call really happened, so the cost record is kept (only the value is rejected).
    const completeObject = vi.fn().mockResolvedValue({ object: { category: 'svg' }, record: rec });
    const deps = { completeObject } as unknown as StageDeps;
    const out = await classifyCategory('A diagram lesson', deps);
    expect(out.category).toBeNull();
    expect(out.records).toEqual([rec]);
  });
});
