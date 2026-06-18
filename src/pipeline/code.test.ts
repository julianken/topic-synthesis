import { describe, expect, it, vi } from 'vitest';
import type { PageSpec } from '../domain/stages';
import { code, stripCodeFence } from './code';
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

  it('strips a markdown code fence the model may wrap the HTML in', async () => {
    const fenced = '```html\n<!doctype html><html></html>\n```';
    const complete = vi.fn().mockResolvedValue({ text: fenced, record: rec });
    const out = await code(pageSpec, { complete } as unknown as StageDeps);
    expect(out.artifact.html).toBe('<!doctype html><html></html>'); // fence removed
  });
});

describe('stripCodeFence', () => {
  it('removes a ```html or ``` fence and passes plain HTML through unchanged', () => {
    expect(stripCodeFence('```html\n<p>x</p>\n```')).toBe('<p>x</p>');
    expect(stripCodeFence('```\n<p>x</p>\n```')).toBe('<p>x</p>');
    expect(stripCodeFence('<!doctype html><p>x</p>')).toBe('<!doctype html><p>x</p>');
  });
});
