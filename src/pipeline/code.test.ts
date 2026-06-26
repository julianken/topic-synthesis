import { describe, expect, it, vi } from 'vitest';
import type { LessonSpec, PageSpec } from '../domain/stages';
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
const lessonSpec: LessonSpec = {
  nodeSlug: 'fourier',
  a11yContract: 'keyboard + text alt',
  citations: [],
  sections: [
    { kind: 'hook', prose: 'A surprising fact about waves.' },
    {
      kind: 'concept',
      prose: 'The transform decomposes a signal.',
      component: {
        kind: 'predict-gate',
        teachingPurpose: 'force a prediction of the spectrum before revealing it',
        answerable: { prompt: 'What frequency dominates?', answer: 'the fundamental' },
      },
    },
    {
      kind: 'self-check',
      prose: 'Check your understanding.',
      component: {
        kind: 'self-check',
        teachingPurpose: 'retrieval check on the decomposition idea',
        answerable: { prompt: 'What does the transform return?', answer: 'frequency components' },
      },
    },
  ],
};
const LEARNING_GOAL = 'understand sine'; // now threaded alongside the spec (it left PageSpec)

/** Run `code` with a fake `complete` and return the single recorded call's arg (no live model). */
async function promptFor(spec: PageSpec | LessonSpec): Promise<{ system: string; prompt: string }> {
  const complete = vi
    .fn()
    .mockResolvedValue({ text: '<!doctype html><html></html>', record: rec });
  await code(spec, LEARNING_GOAL, { complete } as unknown as StageDeps);
  const [arg] = complete.mock.calls[0]!;
  return { system: arg.system as string, prompt: arg.prompt as string };
}

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

  it('makes exactly ONE model call — one-pass, no shell-then-fill (TS-5 verdict)', async () => {
    const complete = vi
      .fn()
      .mockResolvedValue({ text: '<!doctype html><html></html>', record: rec });
    await code(pageSpec, LEARNING_GOAL, { complete } as unknown as StageDeps);
    expect(complete).toHaveBeenCalledTimes(1); // AC6: a single deps.complete, no second pass
  });

  it('narrows the v11 LessonSpec arm and renders its sections into the workspace', async () => {
    const html = '<!doctype html><html></html>';
    const complete = vi.fn().mockResolvedValue({ text: html, record: rec });
    const out = await code(lessonSpec, LEARNING_GOAL, { complete } as unknown as StageDeps);

    expect(out.artifact.nodeSlug).toBe('fourier');
    expect(out.artifact.spec).toEqual(lessonSpec); // the sectioned arm is preserved on the artifact
    const [arg] = complete.mock.calls[0]!;
    // The sectioned prose + the apparatus (kind + teaching purpose + answerable) reach the prompt.
    expect(arg.prompt).toContain('A surprising fact about waves.');
    expect(arg.prompt).toContain('predict-gate');
    expect(arg.prompt).toContain('force a prediction of the spectrum before revealing it');
    expect(arg.prompt).toContain('the fundamental'); // the answerable item is threaded
  });

  it('strips a markdown code fence the model may wrap the HTML in', async () => {
    const fenced = '```html\n<!doctype html><html></html>\n```';
    const complete = vi.fn().mockResolvedValue({ text: fenced, record: rec });
    const out = await code(pageSpec, LEARNING_GOAL, { complete } as unknown as StageDeps);
    expect(out.artifact.html).toBe('<!doctype html><html></html>'); // fence removed
  });
});

// ── the v11 workspace prompt/contract surface (TS-12 — asserted deterministically, no live model) ──
// These assert the STATIC contract the downstream graded critic (TS-7) gates on and serve-time
// injection (TS-19) relies on. The contract lives in CODE_SYSTEM (hashed → PROMPTS_VERSION), so the
// assertions read the emitted system prompt; none calls a live model or gates on a critic score.
describe('code — the v11 workspace contract surface', () => {
  it('requires the named grid-line literal `[screen-start] [read] [gap] [panel] [scrub]` verbatim', async () => {
    const { system } = await promptFor(pageSpec);
    // AC2: the exact named column-line set (incl. the `[scrub]` track) is a hard requirement, and
    // it is required IN `grid-template-columns` — the same literal the TS-7 critic gates on.
    expect(system).toContain('[screen-start] [read] [gap] [panel] [scrub]');
    expect(system).toContain('[scrub]'); // the track TS-5 showed the model drops — required, not optional
    expect(system).toContain('grid-template-columns');
  });

  it('requires `var(--token)` theming for all color/geometry', async () => {
    const { system } = await promptFor(pageSpec);
    expect(system).toContain('var(--token'); // AC3: var() token references required
  });

  it('forbids a competing `:root` color/geometry literal block', async () => {
    const { system } = await promptFor(pageSpec);
    // AC4: no competing `:root` literal block (serve-time injection re-themes via the injected :root).
    expect(system).toContain(':root');
    expect(system).toMatch(/Do NOT emit a competing `:root`|no\s+`:root`\s+rule/);
  });

  it('specifies an inline `var(--token, <fallback>)` self-contained no-injection fallback', async () => {
    const { system } = await promptFor(pageSpec);
    // AC5: the fallback is the inline-default form (var(--token, <fallback>)) so a var()-only doc
    // still renders unstyled-free when no :root is injected — the one AC with its own atomic check
    // (per the plan-review IMPORTANT finding: AC3's bare-var() reading must not silently satisfy AC5).
    expect(system).toContain('var(--token, <fallback>)');
    expect(system).toMatch(/INLINE FALLBACK|no-injection|still renders/);
  });

  it('requires the ≤900px single-column collapse media query', async () => {
    const { system } = await promptFor(pageSpec);
    expect(system).toContain('@media (max-width: 900px)'); // AC1/AC8: the collapse query
  });

  it('states the ≤3-gloss / ≤1-mini-figure per-section apparatus cap (path B)', async () => {
    const { system } = await promptFor(pageSpec);
    // The per-section rendered-apparatus cap is enforced at the code prompt (path B — DESIGN.md SoT),
    // NOT modeled on LessonSpec; assert the prompt states it.
    expect(system).toContain('≤3 key-term glosses');
    expect(system).toContain('≤1 teaching mini-figure');
  });

  it('states the two-column workspace + stable-spine + per-section subgrid contract', async () => {
    const { system } = await promptFor(pageSpec);
    expect(system).toContain('Two columns MAX');
    expect(system.toLowerCase()).toContain('stable spine');
    expect(system).toContain('per-section subgrid');
  });

  it('CODE_SYSTEM is the shared layout contract for BOTH arms (blob + v11)', async () => {
    // The layout contract is stated ONCE in CODE_SYSTEM, so it applies whichever arm fed the spec —
    // assert the same system prompt is emitted for the blob and v11 specs.
    const blob = await promptFor(pageSpec);
    const v11 = await promptFor(lessonSpec);
    expect(blob.system).toBe(CODE_SYSTEM);
    expect(v11.system).toBe(CODE_SYSTEM);
  });
});

describe('stripCodeFence', () => {
  it('removes a ```html or ``` fence and passes plain HTML through unchanged', () => {
    expect(stripCodeFence('```html\n<p>x</p>\n```')).toBe('<p>x</p>');
    expect(stripCodeFence('```\n<p>x</p>\n```')).toBe('<p>x</p>');
    expect(stripCodeFence('<!doctype html><p>x</p>')).toBe('<!doctype html><p>x</p>');
  });
});
