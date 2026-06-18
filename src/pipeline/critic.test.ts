import { describe, expect, it, vi } from 'vitest';
import type { PageArtifact } from '../domain/stages';
import { critique } from './critic';
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
  spec: { nodeSlug: 'sine', learningGoal: 'understand sine', interactionKind: 'canvas', a11yContract: 'kbd', citations: [] },
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
    expect(arg.prompt).toContain(artifact.html); // the HTML is shown to the critic
  });

  it('reports a failing verdict', async () => {
    const completeObject = vi.fn().mockResolvedValue({ object: { passed: false, critique: 'not interactive' }, record: rec });
    const out = await critique(artifact, { completeObject } as unknown as StageDeps);
    expect(out.artifact.passed).toBe(false);
    expect(out.artifact.critique).toBe('not interactive');
  });
});
