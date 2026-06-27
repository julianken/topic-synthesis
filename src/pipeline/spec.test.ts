import { describe, expect, it, vi } from 'vitest';
import type { LessonBrief, PageSpec } from '../domain/stages';
import type { StageDeps } from './deps';
import { spec } from './spec';

const rec = {
  providerModel: 'anthropic:claude-sonnet-4-6',
  inputTokens: 1,
  outputTokens: 1,
  costUsd: 0.001,
  rawUsage: {},
  finishReason: 'stop',
};

// The spec now consumes a LessonBrief (the Analysis→Synthesis seam), not a GatedNode.
const brief: LessonBrief = {
  learningGoal: 'understand sine',
  keyPoints: ['amplitude', 'frequency'],
  findings: [{ claim: 'sine is periodic', source: { url: 'https://a.example', title: 'A' } }],
  audience: 'students',
};

describe('spec', () => {
  it('plans a page from a LessonBrief with the spec model + PageSpecSchema', async () => {
    const pageSpec: PageSpec = {
      nodeSlug: 'sine',
      interactionKind: 'canvas',
      a11yContract: 'keyboard + text alt',
      citations: [
        { url: 'https://a.example', title: 'A' }, // a finding's source → kept
        { url: 'https://invented.example', title: 'X' }, // not offered → dropped
      ],
    };
    const completeObject = vi.fn().mockResolvedValue({ object: pageSpec, record: rec });
    const deps = { completeObject } as unknown as StageDeps;

    const out = await spec(
      { brief, settings: { level: 'intro', depth: 2, audience: 'students' } },
      deps,
    );

    // the brief is the sole source of the learning goal (it left PageSpec)
    expect('learningGoal' in out.spec).toBe(false);
    // a citation not among the findings' sources is dropped (anti-fabrication, like the researcher)
    expect(out.spec.citations).toEqual([{ url: 'https://a.example', title: 'A' }]);
    expect(out.records).toEqual([rec]);
    const [arg] = completeObject.mock.calls[0]!;
    expect(arg.model.model).toBe('claude-sonnet-4-6');
    expect(arg.prompt).toContain('understand sine'); // the brief's learning goal drives the prompt
    expect(arg.prompt).toContain('sine is periodic'); // the grounded finding's CLAIM reaches the spec
    expect(arg.prompt).toContain('https://a.example'); // the finding's source is offered for citation
  });
});
