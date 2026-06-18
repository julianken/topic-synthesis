import { describe, expect, it, vi } from 'vitest';
import type { PrereqGraph, Research } from '../domain/stages';
import type { StageDeps } from './deps';
import { buildGraph } from './graph';

const rec = {
  providerModel: 'anthropic:claude-opus-4-8',
  inputTokens: 1,
  outputTokens: 1,
  costUsd: 0.001,
  rawUsage: {},
  finishReason: 'stop',
};

describe('buildGraph', () => {
  it('feeds research findings to completeObject and returns the prerequisite graph', async () => {
    const graph: PrereqGraph = {
      nodes: [{ slug: 'sine', title: 'Sine waves', summary: 's', coverageConfidence: 0.8 }],
      edges: [],
    };
    const completeObject = vi.fn().mockResolvedValue({ object: graph, record: rec });
    const deps = { completeObject } as unknown as StageDeps;

    const research: Research[] = [
      { subtopic: 'sine waves', sources: [{ url: 'u', title: 't' }], findings: [{ claim: 'sine is periodic', sourceIndex: 0 }] },
    ];
    const out = await buildGraph(research, deps);

    expect(out.graph).toEqual(graph);
    expect(out.records).toEqual([rec]);
    const [arg] = completeObject.mock.calls[0]!;
    expect(arg.model.model).toBe('claude-opus-4-8');
    expect(arg.prompt).toContain('sine waves');
    expect(arg.prompt).toContain('sine is periodic');
  });
});
