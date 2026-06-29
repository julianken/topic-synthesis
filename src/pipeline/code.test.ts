import { describe, expect, it, vi } from 'vitest';
import type { PageSpec } from '../domain/stages';
import { code, CODE_SYSTEM, stripCodeFence } from './code';
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
  interactionKind: 'canvas',
  a11yContract: 'keyboard + text alt',
  citations: [],
};
const LEARNING_GOAL = 'understand sine'; // now threaded alongside the spec (it left PageSpec)

describe('code', () => {
  it('generates a standalone HTML artifact from the spec + learning goal', async () => {
    const html = '<!doctype html><html><body>sine</body></html>';
    const complete = vi.fn().mockResolvedValue({ text: html, record: rec });
    const deps = { complete } as unknown as StageDeps;

    const out = await code(pageSpec, LEARNING_GOAL, deps);

    expect(out.artifact.html).toBe(html);
    expect(out.artifact.nodeSlug).toBe('sine');
    expect(out.artifact.learningGoal).toBe(LEARNING_GOAL); // echoed onto the artifact for the critic
    expect(out.artifact.spec).toEqual(pageSpec);
    const [arg] = complete.mock.calls[0]!;
    expect(arg.model.model).toBe('claude-sonnet-4-6');
    expect(arg.maxTokens).toBe(32000); // larger budget so a full interactive page isn't truncated
    expect(arg.prompt).toContain('keyboard + text alt'); // a11y contract carried into the prompt
    expect(arg.prompt).toContain(LEARNING_GOAL); // the goal (now threaded) reaches the prompt
  });

  it('strips a markdown code fence the model may wrap the HTML in', async () => {
    const fenced = '```html\n<!doctype html><html></html>\n```';
    const complete = vi.fn().mockResolvedValue({ text: fenced, record: rec });
    const out = await code(pageSpec, LEARNING_GOAL, { complete } as unknown as StageDeps);
    expect(out.artifact.html).toBe('<!doctype html><html></html>'); // fence removed
  });
});

describe('CODE_SYSTEM — the coordinate-only progress + apparatus sender contract (PR-F)', () => {
  // The prompt is the SENDER half of the decision-12 channel; the receiver
  // (src/app/lesson/[id]/lesson-message.ts) is the parse half. This pins that the prompt instructs
  // the EXACT message shape the receiver validates, so the two halves can't silently drift.

  it('instructs the EXACT lesson:progress message with sections + scrollProgress + apparatus', () => {
    expect(CODE_SYSTEM).toContain('lesson:progress'); // the discriminant LESSON_MESSAGE_TYPE
    expect(CODE_SYSTEM).toContain('sections');
    expect(CODE_SYSTEM).toContain('scrollProgress');
    expect(CODE_SYSTEM).toContain('apparatus');
    expect(CODE_SYSTEM).toContain('window.parent'); // posts OUTWARD to the parent, the receive side
  });

  it('instructs every apparatus field as SERIALIZED data (glosses/figures/sources/checks/takeaways)', () => {
    for (const field of ['glosses', 'figures', 'sources', 'checks', 'takeaways']) {
      expect(CODE_SYSTEM).toContain(field);
    }
    // …and the per-entry shapes the receiver's sanitizer admits.
    for (const key of ['term', 'definition', 'caption', 'title', 'url', 'prompt', 'answer']) {
      expect(CODE_SYSTEM).toContain(key);
    }
  });

  it('keeps the sender coordinate-only + known-origin: never "*", values not HTML/DOM refs', () => {
    expect(CODE_SYSTEM).toContain('document.referrer'); // derive a KNOWN target origin
    expect(CODE_SYSTEM).toMatch(/never\s+"\*"/i); // forbids the '*' wildcard target
    expect(CODE_SYSTEM).toMatch(/never\s+(HTML|DOM)/i); // serialized data, not HTML/DOM nodes
    expect(CODE_SYSTEM).toMatch(/try\s*\/\s*catch|try\/catch/i); // harmless frame-less open
  });

  it('keeps the existing standalone-doc + a11y generation requirements intact', () => {
    expect(CODE_SYSTEM).toContain('standalone');
    expect(CODE_SYSTEM).toContain('accessibility contract');
    expect(CODE_SYSTEM).toMatch(/keyboard/i);
  });
});

describe('stripCodeFence', () => {
  it('removes a ```html or ``` fence and passes plain HTML through unchanged', () => {
    expect(stripCodeFence('```html\n<p>x</p>\n```')).toBe('<p>x</p>');
    expect(stripCodeFence('```\n<p>x</p>\n```')).toBe('<p>x</p>');
    expect(stripCodeFence('<!doctype html><p>x</p>')).toBe('<!doctype html><p>x</p>');
  });
});
