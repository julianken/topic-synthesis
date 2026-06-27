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

// ── TS-13: the predict-gate + decision-12 postMessage emission contract (path a) ──────────────────
// Static-structure assertions over the emitted system prompt (per R7: gate on static structure + the
// validator's node unit tests, NOT a flaky LLM critic score). None calls a live model. The receive-
// side validator's own trust tests live in src/app/curriculum/[id]/lesson-message.test.ts.
describe('code — the TS-13 predict-gate + postMessage emission contract', () => {
  it('requires ≥1 predict-then-reveal gate with answer-specific feedback (AC1, AC2)', async () => {
    const { system } = await promptFor(pageSpec);
    // AC1: a prediction is committed BEFORE the reveal; AC2: no terminally-locked gate.
    expect(system).toContain('predict-then-');
    expect(system).toMatch(/AT LEAST ONE predict-then-\s*\n?\s*reveal gate/);
    expect(system).toContain('ANSWER-SPECIFIC'); // not a generic correct/incorrect
    expect(system).toMatch(/COMMITS A PREDICTION/);
    expect(system).toMatch(/reachable reveal path/); // AC2: every gate must be revealable
  });

  it('emits the coordinate-only postMessage sender to window.parent (AC3)', async () => {
    const { system } = await promptFor(pageSpec);
    expect(system).toContain('window.parent.postMessage');
    // The exact coordinate-only payload shape: section list + a 0..1 scroll scalar.
    expect(system).toContain("{ type: 'lesson:progress', sections, scrollProgress }");
    expect(system).toContain('`{ id, title }`'); // sections are {id, title} only
    expect(system).toContain('`scrollProgress` scalar in 0..1');
  });

  it('targets a KNOWN origin, never `"*"`, for the cross-iframe post (AC3)', async () => {
    const { system } = await promptFor(pageSpec);
    expect(system).toMatch(/target a KNOWN origin string, NEVER `"\*"`/);
    expect(system).toContain('document.referrer'); // the origin is derived, not wildcarded
  });

  it('shares the discriminant with the receive-side validator (one contract source)', async () => {
    const { system } = await promptFor(pageSpec);
    // The literal the validator (lesson-message.ts LESSON_MESSAGE_TYPE) accepts is the literal the
    // prompt instructs the sender to stamp — the two halves of the contract agree on one string.
    expect(system).toContain("'lesson:progress'");
  });

  it('keeps the predict-gate + postMessage in the SHARED CODE_SYSTEM (both arms, one pass)', async () => {
    // The TS-13 additions live in CODE_SYSTEM, so they apply to BOTH the blob and v11 arms and add
    // to the single one-pass emission (no second model call — covered by the one-pass test above).
    const blob = await promptFor(pageSpec);
    const v11 = await promptFor(lessonSpec);
    expect(blob.system).toBe(CODE_SYSTEM);
    expect(v11.system).toBe(CODE_SYSTEM);
    expect(CODE_SYSTEM).toContain('window.parent.postMessage');
    expect(CODE_SYSTEM).toContain('predict-then-');
  });
});

// ── TS-15 judge fix: §0-faithful inline fallbacks + correct font roles + no-overflow/stable-spine ──
// The live no-injection path (TS-19 serve-time injection is unbuilt) renders the inline `var()`
// FALLBACKS, so a wrong fallback ships the wrong palette. These assert the prompt embeds the canonical
// DESIGN.md §0 dark-OKLCH values verbatim, binds the font roles correctly, and reinforces the
// no-overflow / stable-spine rules. Prompt-text assertions over the emitted system prompt; no live LLM.
describe('code — §0-faithful fallbacks + font roles + no-overflow (TS-15 judge)', () => {
  it('embeds the canonical §0 dark-OKLCH color fallbacks verbatim (the decisive fix)', async () => {
    const { system } = await promptFor(pageSpec);
    // The fallback for each color token is the EXACT DESIGN.md §0 OKLCH value — dark on dark, NOT
    // the light-parchment/forest-green (#f4f3f0 / #4a7c59) inversion the judge rendered.
    expect(system).toContain('var(--bg-app, oklch(0.165 0.018 250))');
    expect(system).toContain('var(--bg-surface, oklch(0.205 0.020 250))');
    expect(system).toContain('var(--bg-raised, oklch(0.215 0.018 250))');
    expect(system).toContain('var(--border, oklch(0.32 0.020 250))');
    expect(system).toContain('var(--text, oklch(0.95 0.008 250))');
    expect(system).toContain('var(--text-muted, oklch(0.74 0.015 250))');
    expect(system).toContain('var(--text-faint, oklch(0.65 0.016 250))');
    expect(system).toContain('var(--accent, oklch(0.82 0.145 215))');
    expect(system).toContain('var(--accent-dim, oklch(0.70 0.11 215))');
    expect(system).toContain('var(--ok, oklch(0.78 0.15 152))');
    expect(system).toContain('var(--warn, oklch(0.82 0.13 80))');
    expect(system).toContain('var(--err, oklch(0.66 0.17 25))');
    expect(system).toContain('var(--kind-svg, oklch(0.80 0.13 295))');
    expect(system).toContain('var(--kind-canvas, oklch(0.82 0.13 50))');
    expect(system).toContain('var(--kind-html, oklch(0.80 0.12 175))');
  });

  it('forbids the light/sRGB-hex inversion the judge found', async () => {
    const { system } = await promptFor(pageSpec);
    // Defensive: the canonical fallbacks are OKLCH, so the prompt must not seed sRGB hex or the
    // observed light-parchment/forest-green literals (#f4f3f0 / #4a7c59). The prompt names the
    // anti-pattern explicitly so the model doesn't re-invent it.
    expect(system).not.toContain('#f4f3f0');
    expect(system).not.toContain('#4a7c59');
    expect(system).toMatch(/do NOT invent light\/parchment colors, sRGB hex, or serif\s*\n?\s*body type/);
    expect(system).toMatch(/cyan-blue, NOT green/); // the accent is OKLCH cyan-blue, not green
  });

  it('embeds the canonical §0 geometry + font-family fallbacks verbatim', async () => {
    const { system } = await promptFor(pageSpec);
    expect(system).toContain('var(--measure, 33rem)');
    expect(system).toContain('var(--panel-w, 23rem)');
    expect(system).toContain('var(--col-gap, clamp(1.6rem, 2.6vw, 3.4rem))');
    expect(system).toContain('var(--edge-gap, clamp(1.6rem, 2.4vw, 3.2rem))');
    expect(system).toContain('var(--scrub-w, 1.1rem)');
    expect(system).toContain('var(--frame-max, 1640px)');
    expect(system).toContain('var(--sans, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif)');
    expect(system).toContain('var(--serif, "Iowan Old Style", "Charter", "Georgia", serif)');
    expect(system).toContain('var(--mono, ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace)');
  });

  it('binds the font ROLES correctly — sans body/chrome, serif headings only, mono code', async () => {
    const { system } = await promptFor(pageSpec);
    // Corrects the observed inversion (serif on body, sans on headings).
    expect(system).toMatch(/BODY \+ ALL CHROME[\s\S]*SANS stack/);
    expect(system).toMatch(/body is NEVER serif/);
    expect(system).toMatch(/LESSON \+ SECTION HEADINGS ONLY[\s\S]*SERIF stack/);
    expect(system).toMatch(/Serif is for headings ONLY/);
    expect(system).toMatch(/CODE \/ TOKENS[\s\S]*MONO stack/);
  });

  it('reinforces no horizontal overflow at 390px (wrap or scroll, never overflowing nowrap)', async () => {
    const { system } = await promptFor(pageSpec);
    expect(system).toContain('NO HORIZONTAL OVERFLOW at 390px');
    expect(system).toContain('overflow-wrap: anywhere');
    expect(system).toContain('overflow-x: auto');
    expect(system).toMatch(/NEVER `white-space: nowrap` on content that\s*\n?\s*then overflows/);
    expect(system).toContain('`.math`'); // long formulas / .math must wrap
  });

  it('reinforces the STABLE-SPINE HARD rule (identical left edge + width, lone centers text)', async () => {
    const { system } = await promptFor(pageSpec);
    expect(system).toMatch(/STABLE SPINE \(HARD rule, restated/);
    expect(system).toMatch(/IDENTICAL\s*\n?\s*left edge and width across ALL sections/);
    expect(system).toMatch(/apparatus-paired sections and lone[\s\S]*sections alike/);
    expect(system).toMatch(/centers its TEXT inside that fixed column[\s\S]*NEVER moves or narrows the column/);
  });
});

describe('stripCodeFence', () => {
  it('removes a ```html or ``` fence and passes plain HTML through unchanged', () => {
    expect(stripCodeFence('```html\n<p>x</p>\n```')).toBe('<p>x</p>');
    expect(stripCodeFence('```\n<p>x</p>\n```')).toBe('<p>x</p>');
    expect(stripCodeFence('<!doctype html><p>x</p>')).toBe('<!doctype html><p>x</p>');
  });
});
