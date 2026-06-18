import { describe, expect, it, vi } from 'vitest';
import type { GatedNode, PageSpec } from '../domain/stages';
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
const node: GatedNode = { slug: 'sine', title: 'Sine waves', summary: 'periodic', coverageConfidence: 0.8, route: 'built' };

describe('spec', () => {
  it('plans a page from a gated node with the spec model + PageSpecSchema', async () => {
    const pageSpec: PageSpec = {
      nodeSlug: 'sine',
      learningGoal: 'understand sine',
      interactionKind: 'canvas',
      a11yContract: 'keyboard + text alt',
      citations: [
        { url: 'https://a.example', title: 'A' }, // offered → kept
        { url: 'https://invented.example', title: 'X' }, // not offered → dropped
      ],
    };
    const completeObject = vi.fn().mockResolvedValue({ object: pageSpec, record: rec });
    const deps = { completeObject } as unknown as StageDeps;

    const out = await spec(
      { node, settings: { level: 'intro', depth: 2, audience: 'students' }, sources: [{ url: 'https://a.example', title: 'A' }] },
      deps,
    );

    expect(out.spec.learningGoal).toBe('understand sine');
    // a citation not among the offered sources is dropped (anti-fabrication, like the researcher)
    expect(out.spec.citations).toEqual([{ url: 'https://a.example', title: 'A' }]);
    expect(out.records).toEqual([rec]);
    const [arg] = completeObject.mock.calls[0]!;
    expect(arg.model.model).toBe('claude-sonnet-4-6');
    expect(arg.prompt).toContain('Sine waves');
    expect(arg.prompt).toContain('https://a.example'); // sources offered for citation
  });
});
