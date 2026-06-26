import { describe, expect, it, vi } from 'vitest';
import { isLessonSpec, type LessonBrief, type LessonSpec, type PageSpec } from '../domain/stages';
import type { StageDeps } from './deps';
import { defaultStages, type StageBundle } from './ports';
import { spec, SPEC_V11_SYSTEM, specV11 } from './spec';

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

// ── the v11 SECTIONED spec (TS-11) ───────────────────────────────────────────
// A LessonSpec the fake returns; section[1] is deliberately OVER-FILLED with two components (a shape
// a real LLM might return despite the one-component instruction) so the deterministic clamp is exercised.
// The fake `completeObject` bypasses Zod, so it can return an off-schema `components` array — the
// stage's clamp is what enforces TS-10's ≤1-component-per-section invariant (enforce-don't-assume).
function v11Brief(): LessonBrief {
  return {
    learningGoal: 'understand recursion',
    keyPoints: ['base case', 'recursive case', 'the call stack'],
    findings: [
      { claim: 'recursion needs a base case', source: { url: 'https://a.example', title: 'A' } },
      { claim: 'each call frames on the stack', source: { url: 'https://b.example', title: 'B' } },
    ],
    audience: 'students',
  };
}

describe('specV11 (the v11 sectioned arm)', () => {
  it('requests the sectioned LessonSpec schema (not PageSpecSchema) on the spec model', async () => {
    const lessonSpec: LessonSpec = {
      nodeSlug: 'recursion',
      sections: [
        {
          kind: 'hook',
          prose: 'why does a function call itself?',
          component: {
            kind: 'predict-gate',
            teachingPurpose: 'let the learner predict the stop condition before revealing it',
            answerable: { prompt: 'what stops the recursion?', answer: 'the base case' },
          },
        },
        {
          kind: 'self-check',
          prose: 'check your understanding',
          component: {
            kind: 'self-check',
            teachingPurpose: 'a retrieval check on the base case',
            answerable: { prompt: 'name the case that does not recurse', answer: 'the base case' },
          },
        },
      ],
      a11yContract: 'keyboard + text alt',
      citations: [{ url: 'https://a.example', title: 'A' }],
    };
    const completeObject = vi.fn().mockResolvedValue({ object: lessonSpec, record: rec });
    const deps = { completeObject } as unknown as StageDeps;

    const out = await specV11(
      { brief: v11Brief(), settings: { level: 'intro', depth: 2, audience: 'students' } },
      deps,
    );

    expect(isLessonSpec(out.spec)).toBe(true); // the v11 arm emits a sectioned LessonSpec
    const [arg] = completeObject.mock.calls[0]!;
    expect(arg.model.model).toBe('claude-sonnet-4-6');
    expect(arg.system).toBe(SPEC_V11_SYSTEM);
    // AC4 — the brief's learningGoal + keyPoints + grounded findings (claim) feed the prompt
    expect(arg.prompt).toContain('understand recursion');
    expect(arg.prompt).toContain('base case');
    expect(arg.prompt).toContain('recursion needs a base case');
  });

  it('emits sections in brief/reading order', async () => {
    const lessonSpec = {
      nodeSlug: 'recursion',
      sections: [
        { kind: 'hook', prose: 'p0' },
        { kind: 'concept', prose: 'p1' },
        {
          kind: 'self-check',
          prose: 'p2',
          component: {
            kind: 'self-check',
            teachingPurpose: 'retrieval',
            answerable: { prompt: 'q', answer: 'a' },
          },
        },
        {
          kind: 'intuition',
          prose: 'p3',
          component: {
            kind: 'predict-gate',
            teachingPurpose: 'predict',
            answerable: { prompt: 'q', answer: 'a' },
          },
        },
      ],
      a11yContract: 'kb',
      citations: [],
    };
    const completeObject = vi.fn().mockResolvedValue({ object: lessonSpec, record: rec });
    const deps = { completeObject } as unknown as StageDeps;

    const out = await specV11(
      { brief: v11Brief(), settings: { level: 'intro', depth: 2, audience: 'students' } },
      deps,
    );
    expect(isLessonSpec(out.spec)).toBe(true);
    if (!isLessonSpec(out.spec)) throw new Error('unreachable');
    expect(out.spec.sections.map((s) => s.kind)).toEqual([
      'hook',
      'concept',
      'self-check',
      'intuition',
    ]);
  });

  it('AC5 — clamps a section the model over-fills with 2 components down to 1 (the first wins)', async () => {
    // section[0] returns a `components` ARRAY of two — the model ignoring the one-component rule. The
    // clamp keeps the head (reading order) and drops the rest; TS-10's `Section.component` is singular.
    const lessonSpec = {
      nodeSlug: 'recursion',
      sections: [
        {
          kind: 'hook',
          prose: 'p0',
          components: [
            { kind: 'predict-gate', teachingPurpose: 'KEPT', answerable: { prompt: 'q', answer: 'a' } },
            { kind: 'svg', teachingPurpose: 'DROPPED' },
          ],
        },
        {
          kind: 'self-check',
          prose: 'p1',
          component: {
            kind: 'self-check',
            teachingPurpose: 'retrieval',
            answerable: { prompt: 'q', answer: 'a' },
          },
        },
      ],
      a11yContract: 'kb',
      citations: [],
    };
    const completeObject = vi.fn().mockResolvedValue({ object: lessonSpec, record: rec });
    const deps = { completeObject } as unknown as StageDeps;

    const out = await specV11(
      { brief: v11Brief(), settings: { level: 'intro', depth: 2, audience: 'students' } },
      deps,
    );
    if (!isLessonSpec(out.spec)) throw new Error('expected a LessonSpec');
    // every section carries ≤1 component (the invariant), and the over-filled section kept the FIRST
    for (const s of out.spec.sections) expect(s.component === undefined || !Array.isArray(s.component)).toBe(true);
    expect(out.spec.sections[0]!.component?.teachingPurpose).toBe('KEPT');
    // the off-schema `components` array is not carried through onto the clamped section
    expect((out.spec.sections[0] as unknown as { components?: unknown }).components).toBeUndefined();
  });

  it('AC6 — drops a citation pointing at a source not in the brief findings', async () => {
    const lessonSpec = {
      nodeSlug: 'recursion',
      sections: [
        {
          kind: 'self-check',
          prose: 'p',
          component: {
            kind: 'self-check',
            teachingPurpose: 'retrieval',
            answerable: { prompt: 'q', answer: 'a' },
          },
        },
      ],
      a11yContract: 'kb',
      citations: [
        { url: 'https://a.example', title: 'A' }, // a finding's source → kept
        { url: 'https://invented.example', title: 'X' }, // not offered → dropped
      ],
    };
    const completeObject = vi.fn().mockResolvedValue({ object: lessonSpec, record: rec });
    const deps = { completeObject } as unknown as StageDeps;

    const out = await specV11(
      { brief: v11Brief(), settings: { level: 'intro', depth: 2, audience: 'students' } },
      deps,
    );
    if (!isLessonSpec(out.spec)) throw new Error('expected a LessonSpec');
    expect(out.spec.citations).toEqual([{ url: 'https://a.example', title: 'A' }]);
  });

  it('AC7 — the load-bearing pedagogy primitives (predict-gate + self-check) are present in a valid emission', async () => {
    const lessonSpec: LessonSpec = {
      nodeSlug: 'recursion',
      sections: [
        {
          kind: 'hook',
          prose: 'p0',
          component: {
            kind: 'predict-gate',
            teachingPurpose: 'predict the stop condition',
            answerable: { prompt: 'what stops it?', answer: 'the base case' },
          },
        },
        {
          kind: 'self-check',
          prose: 'p1',
          component: {
            kind: 'self-check',
            teachingPurpose: 'retrieval on the base case',
            answerable: { prompt: 'name the non-recursing case', answer: 'base case' },
          },
        },
      ],
      a11yContract: 'kb',
      citations: [],
    };
    const completeObject = vi.fn().mockResolvedValue({ object: lessonSpec, record: rec });
    const deps = { completeObject } as unknown as StageDeps;

    const out = await specV11(
      { brief: v11Brief(), settings: { level: 'intro', depth: 2, audience: 'students' } },
      deps,
    );
    if (!isLessonSpec(out.spec)) throw new Error('expected a LessonSpec');
    const hasPredictGate = out.spec.sections.some((s) => s.component?.kind === 'predict-gate');
    const hasSelfCheck = out.spec.sections.some(
      (s) => s.component?.kind === 'self-check' && !!s.component.answerable,
    );
    expect(hasPredictGate && hasSelfCheck).toBe(true);
    expect(out.records).toEqual([rec]);
  });

  it('AC2 — SPEC_V11_SYSTEM states the at-most-one-component-per-section anti-clutter discipline', () => {
    expect(SPEC_V11_SYSTEM).toMatch(/at most one/i);
    expect(SPEC_V11_SYSTEM).toMatch(/predict-gate/);
    expect(SPEC_V11_SYSTEM).toMatch(/self-check/);
    // mirrors the critic's apparatusAddsBeyondProse language so emission + grading agree
    expect(SPEC_V11_SYSTEM).toMatch(/ADD what the prose/i);
  });

  it('AC8 — wires as a StageBundle.spec arm OVERRIDE, not a mutation of defaultStages.spec', () => {
    // The v11 spec is a valid `StageBundle.spec` override (same signature, LessonSpec ⊆ the union),
    // and the live default arm still points at the blob `spec`. Building the arm does NOT mutate it.
    const v11Arm: StageBundle = { ...defaultStages, spec: specV11 };
    expect(v11Arm.spec).toBe(specV11);
    expect(defaultStages.spec).toBe(spec); // the blob spec stays the live default / kill-switch
    expect(defaultStages.spec).not.toBe(specV11);
  });
});
