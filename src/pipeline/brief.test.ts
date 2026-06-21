import { describe, expect, it, vi } from 'vitest';
import type { LessonBrief, Plan, Research } from '../domain/stages';
import { brief } from './brief';
import type { StageDeps } from './deps';

const rec = {
  providerModel: 'anthropic:claude-opus-4-8',
  inputTokens: 1,
  outputTokens: 1,
  costUsd: 0.001,
  rawUsage: {},
  finishReason: 'stop',
};

const plan: Plan = {
  scope: 'Fourier basics',
  subtopics: ['sine waves'],
  researchQuestions: ['what is frequency?'],
};

// The input research carries ONE real source; a brief finding citing another is fabricated.
const research: Research[] = [
  {
    subtopic: 'sine waves',
    sources: [{ url: 'https://real.example', title: 'Real' }],
    findings: [{ claim: 'sine is periodic', sourceIndex: 0 }],
  },
];

describe('brief', () => {
  it('builds a LessonBrief from plan + research with the brief model + LessonBriefSchema', async () => {
    const out: LessonBrief = {
      learningGoal: 'understand sine waves',
      keyPoints: ['amplitude', 'frequency'],
      findings: [{ claim: 'sine is periodic', source: { url: 'https://real.example', title: 'Real' } }],
      audience: 'students',
    };
    const completeObject = vi.fn().mockResolvedValue({ object: out, record: rec });
    const deps = { completeObject } as unknown as StageDeps;

    const result = await brief({ plan, research, settings: { level: 'intro', depth: 2, audience: 'students' } }, deps);

    expect(result.brief).toEqual(out);
    expect(result.records).toEqual([rec]);
    const [arg] = completeObject.mock.calls[0]!;
    expect(arg.model.model).toBe('claude-opus-4-8'); // the brief is an Opus-class Analysis stage
    expect(arg.schema).toBeDefined();
    expect(arg.prompt).toContain('sine waves'); // the plan's subtopic reaches the prompt
    expect(arg.prompt).toContain('sine is periodic'); // the grounded finding's claim reaches the prompt
  });

  it('drops a finding whose source is not present in the input research (anti-fabrication)', async () => {
    const fabricated: LessonBrief = {
      learningGoal: 'understand sine waves',
      keyPoints: ['frequency'],
      findings: [
        { claim: 'sine is periodic', source: { url: 'https://real.example', title: 'Real' } }, // real → kept
        { claim: 'invented fact', source: { url: 'https://fake.example', title: 'Fake' } }, // not retrieved → dropped
      ],
      audience: 'students',
    };
    const completeObject = vi.fn().mockResolvedValue({ object: fabricated, record: rec });
    const deps = { completeObject } as unknown as StageDeps;

    const result = await brief({ plan, research, settings: { level: 'intro', depth: 2, audience: 'students' } }, deps);

    expect(result.brief.findings).toEqual([
      { claim: 'sine is periodic', source: { url: 'https://real.example', title: 'Real' } },
    ]);
  });
});
