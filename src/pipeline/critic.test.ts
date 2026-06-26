import { describe, expect, it, vi } from 'vitest';
import {
  CRITIC_PASS_THRESHOLD,
  derivePassed,
  type LearningEfficacy,
  type LedgerConformance,
  type PageArtifact,
} from '../domain/stages';
import { critique, gradedCritique } from './critic';
import { defaultStages } from './ports';
import type { StageDeps } from './deps';

const rec = {
  providerModel: 'anthropic:claude-opus-4-8',
  inputTokens: 1,
  outputTokens: 1,
  costUsd: 0.001,
  rawUsage: {},
  finishReason: 'stop',
};
const artifact: PageArtifact = {
  nodeSlug: 'sine',
  html: '<!doctype html><html><body>sine</body></html>',
  learningGoal: 'understand sine',
  spec: { nodeSlug: 'sine', interactionKind: 'canvas', a11yContract: 'kbd', citations: [] },
};

describe('critique', () => {
  it('merges a passing verdict into the artifact, preserving the artifact', async () => {
    const completeObject = vi.fn().mockResolvedValue({ object: { passed: true, critique: 'solid' }, record: rec });
    const deps = { completeObject } as unknown as StageDeps;

    const out = await critique(artifact, deps);

    expect(out.artifact.passed).toBe(true);
    expect(out.artifact.critique).toBe('solid');
    expect(out.artifact.html).toBe(artifact.html);
    expect(out.artifact.nodeSlug).toBe('sine');
    const [arg] = completeObject.mock.calls[0]!;
    expect(arg.model.model).toBe('claude-opus-4-8');
    expect(arg.prompt).toContain('understand sine'); // the goal (read off the artifact) is judged against
    expect(arg.prompt).toContain(artifact.html); // the HTML is shown to the critic
  });

  it('reports a failing verdict', async () => {
    const completeObject = vi.fn().mockResolvedValue({ object: { passed: false, critique: 'not interactive' }, record: rec });
    const out = await critique(artifact, { completeObject } as unknown as StageDeps);
    expect(out.artifact.passed).toBe(false);
    expect(out.artifact.critique).toBe('not interactive');
  });

  it('the blob arm stays the live default (defaultStages.critic === binary critique)', () => {
    expect(defaultStages.critic).toBe(critique);
  });
});

// ── graded critic (CriticVerdict v2) — threshold arithmetic over canned sub-scores ──
const sub = (score: number): { score: number; note: string } => ({ score, note: `n=${score}` });

/** All sub-scores at one level — the simplest canned verdict for floor-threshold tests. */
const verdictAt = (score: number): { learningEfficacy: LearningEfficacy; ledgerConformance: LedgerConformance } => ({
  learningEfficacy: {
    misconceptionHook: sub(score),
    retrievalCheck: sub(score),
    findingsGrounded: sub(score),
    apparatusAddsBeyondProse: sub(score),
  },
  ledgerConformance: {
    namedGridPresent: sub(score),
    perSectionSubgrid: sub(score),
    collapseQueryPresent: sub(score),
    noRootLiteralOverride: sub(score),
    predictGateStructure: sub(score),
  },
});

const goodScores = verdictAt(0.9);
// A vapid lesson: a real misconception hook + grid present, but no genuine retrieval check
// and filler apparatus — the two named axes a scalar teachingQuality would have averaged away.
const vapidScores: { learningEfficacy: LearningEfficacy; ledgerConformance: LedgerConformance } = {
  learningEfficacy: {
    misconceptionHook: sub(0.8),
    retrievalCheck: sub(0.1),
    findingsGrounded: sub(0.7),
    apparatusAddsBeyondProse: sub(0.2),
  },
  ledgerConformance: {
    namedGridPresent: sub(0.9),
    perSectionSubgrid: sub(0.9),
    collapseQueryPresent: sub(0.9),
    noRootLiteralOverride: sub(0.9),
    predictGateStructure: sub(0.9),
  },
};

describe('derivePassed (CriticVerdict v2 threshold)', () => {
  it('passes when every sub-score is at or above the threshold', () => {
    expect(derivePassed(goodScores)).toBe(true);
  });

  it('fails when a single named axis (retrieval/apparatus) is below threshold — vapidity is not averaged away', () => {
    expect(derivePassed(vapidScores)).toBe(false);
  });

  it('is an all-axes floor: a sub-score exactly at the threshold still passes, just below fails', () => {
    expect(derivePassed(verdictAt(CRITIC_PASS_THRESHOLD))).toBe(true);
    expect(derivePassed(verdictAt(CRITIC_PASS_THRESHOLD - 0.01))).toBe(false);
  });
});

describe('gradedCritique (the v11 StageBundle.critic arm)', () => {
  it('derives passed from canned good sub-scores (overwriting the model boolean) and carries the sub-scores', async () => {
    // The model self-asserts passed:false, but every sub-score is high — derivePassed wins.
    const object = { passed: false, critique: 'graded', ...goodScores };
    const completeObject = vi.fn().mockResolvedValue({ object, record: rec });
    const out = await gradedCritique(artifact, { completeObject } as unknown as StageDeps);

    expect(out.artifact.passed).toBe(true); // derived, not the model's false
    expect(out.artifact.critique).toBe('graded');
    expect(out.artifact.html).toBe(artifact.html); // artifact preserved
    expect(out.artifact.scores?.learningEfficacy.retrievalCheck.score).toBe(0.9);
    expect(out.artifact.scores?.ledgerConformance.namedGridPresent.score).toBe(0.9);
  });

  it('derives passed:false from canned vapid sub-scores even when the model self-asserts passed:true', async () => {
    const object = { passed: true, critique: 'looks fine', ...vapidScores };
    const completeObject = vi.fn().mockResolvedValue({ object, record: rec });
    const out = await gradedCritique(artifact, { completeObject } as unknown as StageDeps);
    expect(out.artifact.passed).toBe(false); // a failing named axis sinks it
  });

  it('is assignable to StageBundle.critic (same signature as the binary arm)', () => {
    const swapped = { ...defaultStages, critic: gradedCritique };
    expect(swapped.critic).toBe(gradedCritique);
  });
});
