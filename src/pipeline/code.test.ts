import { describe, expect, it, vi } from 'vitest';
import type { PageSpec } from '../domain/stages';
import { code } from './code';
import type { StageDeps } from './deps';

const rec = {
  providerModel: 'anthropic:claude-sonnet-4-6',
  inputTokens: 1,
  outputTokens: 1,
  costUsd: 0.001,
  rawUsage: {},
  finishReason: 'stop',
};
const pageSpec: PageSpec = {
  nodeSlug: 'sine',
  learningGoal: 'understand sine',
  interactionKind: 'canvas',
  a11yContract: 'keyboard + text alt',
  citations: [],
};

describe('code', () => {
  it('generates a standalone HTML artifact from the spec', async () => {
    const html = '<!doctype html><html><body>sine</body></html>';
    const complete = vi.fn().mockResolvedValue({ text: html, record: rec });
    const deps = { complete } as unknown as StageDeps;

    const out = await code(pageSpec, deps);

    expect(out.artifact.html).toBe(html);
    expect(out.artifact.nodeSlug).toBe('sine');
    expect(out.artifact.spec).toEqual(pageSpec);
    const [arg] = complete.mock.calls[0]!;
    expect(arg.model.model).toBe('claude-sonnet-4-6');
    expect(arg.maxTokens).toBe(16000); // larger budget for a full page
    expect(arg.prompt).toContain('keyboard + text alt'); // a11y contract carried into the prompt
  });
});
