import { describe, expect, it } from 'vitest';
import type { LessonBrief } from '../domain/stages';
import type { LlmCallRecord, ObjectResult } from '../llm/client';
import { STAGE_MODELS, type StageModel } from '../llm/models';
import type { StageDeps } from '../pipeline/deps';
import { judgeBrief, JUDGE_SYSTEM } from './judge';

const rec = (costUsd: number): LlmCallRecord => ({
  providerModel: 'anthropic:claude-opus-4-8',
  inputTokens: 100,
  outputTokens: 20,
  costUsd,
  rawUsage: null,
  finishReason: 'stop',
});

const brief: LessonBrief = {
  learningGoal: 'understand the discrete Fourier transform',
  keyPoints: ['frequency domain', 'orthogonality of basis functions'],
  findings: [{ claim: 'sin and cos are orthogonal over a period', source: { url: 'https://x', title: 'X' } }],
  audience: 'a self-taught developer',
};

/**
 * A `StageDeps` whose `completeObject` returns a fixed verdict object + cost record — so the judge
 * runs with NO live model (the injection pattern every stage uses). `complete`/`searchWeb` are unused
 * by the judge, so they throw if ever reached (a guard against an accidental live dependency).
 */
function fakeDeps(verdict: Record<string, number>, record: LlmCallRecord): StageDeps {
  return {
    complete: () => {
      throw new Error('complete should not be called by the judge');
    },
    completeObject: <T>(): Promise<ObjectResult<T>> =>
      Promise.resolve({ object: verdict as T, record }),
    searchWeb: () => {
      throw new Error('searchWeb should not be called by the judge');
    },
  };
}

describe('judgeBrief', () => {
  it('returns the numeric sub-scores + the call record from an injected completeObject (AC 5)', async () => {
    const verdict = { groundedness: 0.9, goalClarity: 0.85, audienceFit: 0.8 };
    const result = await judgeBrief(brief, fakeDeps(verdict, rec(0.04)));
    expect(result.scores).toEqual(verdict);
    expect(typeof result.scores.groundedness).toBe('number');
    expect(result.record.costUsd).toBe(0.04); // the record is surfaced so the CLI folds it into cost
  });

  it('passes the strict-judge system prompt and a prompt mentioning the brief to the model', async () => {
    let captured: { system?: string; prompt: string } | undefined;
    const deps: StageDeps = {
      complete: () => {
        throw new Error('unused');
      },
      completeObject: <T>(opts: { system?: string; prompt: string }): Promise<ObjectResult<T>> => {
        captured = { ...(opts.system !== undefined ? { system: opts.system } : {}), prompt: opts.prompt };
        return Promise.resolve({ object: { groundedness: 1, goalClarity: 1, audienceFit: 1 } as T, record: rec(0.01) });
      },
      searchWeb: () => {
        throw new Error('unused');
      },
    };
    await judgeBrief(brief, deps);
    expect(captured?.system).toBe(JUDGE_SYSTEM);
    expect(captured?.prompt).toContain(brief.learningGoal);
    expect(captured?.prompt).toContain(brief.audience);
  });

  it('judges on the passed model (#57 SUGGESTION #2) and defaults to STAGE_MODELS.critic', async () => {
    let captured: StageModel | undefined;
    const deps: StageDeps = {
      complete: () => {
        throw new Error('unused');
      },
      completeObject: <T>(opts: { model: StageModel }): Promise<ObjectResult<T>> => {
        captured = opts.model;
        return Promise.resolve({ object: { groundedness: 1, goalClarity: 1, audienceFit: 1 } as T, record: rec(0.01) });
      },
      searchWeb: () => {
        throw new Error('unused');
      },
    };
    const haiku: StageModel = { provider: 'anthropic', model: 'claude-haiku-4-5' };
    await judgeBrief(brief, deps, haiku);
    expect(captured).toEqual(haiku); // a cheap run judges on the threaded cheap model
    await judgeBrief(brief, deps);
    expect(captured).toEqual(STAGE_MODELS.critic); // default: opus
  });
});
