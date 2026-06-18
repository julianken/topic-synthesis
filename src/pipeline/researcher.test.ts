import { describe, expect, it, vi } from 'vitest';
import type { StageDeps } from './deps';
import { research } from './researcher';

const rec = (id: string) => ({
  providerModel: id,
  inputTokens: 1,
  outputTokens: 1,
  costUsd: 0.001,
  rawUsage: {},
  finishReason: 'stop',
});

describe('research', () => {
  it('grounds findings in the real retrieved sources and drops out-of-range citations', async () => {
    const searchWeb = vi.fn().mockResolvedValue({
      text: 'a grounded synthesis',
      sources: [
        { url: 'https://a.example', title: 'A' },
        { url: 'https://b.example', title: 'B' },
      ],
      record: rec('search'),
    });
    const completeObject = vi.fn().mockResolvedValue({
      object: {
        findings: [
          { claim: 'a real, supported claim', sourceIndex: 1 },
          { claim: 'a hallucinated citation', sourceIndex: 9 }, // out of range → must be dropped
        ],
      },
      record: rec('structure'),
    });
    const deps = { searchWeb, completeObject } as unknown as StageDeps;

    const out = await research(
      { subtopic: 'sine waves', question: 'what is a sine wave?', settings: { level: 'intro', depth: 2, audience: 'students' } },
      deps,
    );

    // sources come straight from the search (never the model)
    expect(out.research.sources).toEqual([
      { url: 'https://a.example', title: 'A' },
      { url: 'https://b.example', title: 'B' },
    ]);
    // the hallucinated citation (index 9) is filtered out — only the grounded finding survives
    expect(out.research.findings).toEqual([{ claim: 'a real, supported claim', sourceIndex: 1 }]);
    expect(out.records).toHaveLength(2);
    // the structuring pass is shown the real source list to cite against
    const [structureArg] = completeObject.mock.calls[0]!;
    expect(structureArg.prompt).toContain('https://a.example');
    expect(structureArg.system).toMatch(/never invent|index/i);
  });

  it('plumbs maxSearches through to the web search', async () => {
    const searchWeb = vi.fn().mockResolvedValue({ text: '', sources: [], record: rec('search') });
    const completeObject = vi.fn().mockResolvedValue({ object: { findings: [] }, record: rec('structure') });
    const deps = { searchWeb, completeObject } as unknown as StageDeps;
    await research(
      { subtopic: 's', question: 'q', settings: { level: 'intro', depth: 1, audience: 'a' }, maxSearches: 2 },
      deps,
    );
    const [searchArg] = searchWeb.mock.calls[0]!;
    expect(searchArg.maxSearches).toBe(2);
  });
});
