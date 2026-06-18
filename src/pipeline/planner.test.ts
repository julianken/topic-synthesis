import { describe, expect, it, vi } from 'vitest';
import type { Plan } from '../domain/stages';
import type { StageDeps } from './deps';
import { plan } from './planner';

const rec = {
  providerModel: 'anthropic:claude-opus-4-8',
  inputTokens: 1,
  outputTokens: 1,
  costUsd: 0.001,
  rawUsage: {},
  finishReason: 'stop',
};

describe('plan', () => {
  it('calls completeObject with the planner model + topic, returns the plan + record', async () => {
    const samplePlan: Plan = {
      scope: 'Fourier basics',
      subtopics: ['sine waves'],
      researchQuestions: ['what is frequency?'],
    };
    const completeObject = vi.fn().mockResolvedValue({ object: samplePlan, record: rec });
    const deps = { completeObject } as unknown as StageDeps;

    const out = await plan(
      { topic: 'Fourier transforms', settings: { level: 'intermediate', depth: 3, audience: 'devs' } },
      deps,
    );

    expect(out.plan).toEqual(samplePlan);
    expect(out.records).toEqual([rec]);
    const [arg] = completeObject.mock.calls[0]!;
    expect(arg.model.provider).toBe('anthropic');
    expect(arg.model.model).toBe('claude-opus-4-8');
    expect(arg.prompt).toContain('Fourier transforms');
    expect(arg.schema).toBeDefined();
  });
});
