import { describe, expect, it, vi } from 'vitest';
import {
  isLessonSpec,
  type LessonBrief,
  type LessonSpec,
  LessonSpecSchema,
  type PageSpec,
} from '../domain/stages';
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
// IN PRODUCTION the ≤1-component-per-section invariant is enforced by `LessonSpecSchema` (Zod, TS-10):
// `completeObject` validates the model output and `SectionSchema` (default strip) drops an off-schema
// `components` array before `specV11` runs. The fake `completeObject` here BYPASSES Zod, so it can
// return the over-fill — this exercises the stage's belt-and-suspenders clamp, the only thing that
// fires on a non-validating injection point (not the production enforcer).
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

// Prose-only content sections (NO apparatus component) used to pad a fixture up to the TS-12b section
// floor (MIN_LESSON_SECTIONS) so `specV11`'s re-validation against `LessonSpecSchema` passes for the
// reason the test cares about — they never carry a primitive, so they don't perturb the apparatus logic.
const contentFiller = [
  { kind: 'concept' as const, prose: 'content prose A' },
  { kind: 'concept' as const, prose: 'content prose B' },
  { kind: 'takeaways' as const, prose: 'content prose C' },
];

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
        ...contentFiller, // pad past the section floor so re-validation passes
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
        ...contentFiller, // pad past the section floor so re-validation passes
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
    // The fixture carries BOTH load-bearing primitives so it is contract-valid: `specV11` now
    // re-validates the (clamped) emission against LessonSpecSchema, so a primitive-less spec would
    // trip the self-repair retry rather than reaching the citation filter under test.
    const lessonSpec = {
      nodeSlug: 'recursion',
      sections: [
        {
          kind: 'hook',
          prose: 'p0',
          component: {
            kind: 'predict-gate',
            teachingPurpose: 'predict',
            answerable: { prompt: 'q', answer: 'a' },
          },
        },
        {
          kind: 'self-check',
          prose: 'p',
          component: {
            kind: 'self-check',
            teachingPurpose: 'retrieval',
            answerable: { prompt: 'q', answer: 'a' },
          },
        },
        ...contentFiller, // pad past the section floor so re-validation passes
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
        ...contentFiller, // pad past the section floor so re-validation passes
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

  // ── TS-12b quality steer: demand a RICH multi-section lesson with both REAL primitives ──
  it('TS-12b — SPEC_V11_SYSTEM demands a rich multi-section lesson, not a single section', () => {
    // a single-section lesson is the degenerate failure mode the live render exposed
    expect(SPEC_V11_SYSTEM).toMatch(/multi-section/i);
    expect(SPEC_V11_SYSTEM).toMatch(/section for each key point|one section per key point/i);
    expect(SPEC_V11_SYSTEM).toMatch(/densify every section/i);
    expect(SPEC_V11_SYSTEM).toMatch(/never collapse the lesson to one section/i);
    // TS-12b — the system prompt states the explicit section floor (>= 4) the schema now enforces
    expect(SPEC_V11_SYSTEM).toMatch(/at\s+least 4 sections/i);
  });

  it('TS-12b — SPEC_V11_SYSTEM re-scopes documentedReasonAbsent to pure-reference pages only', () => {
    // it must FORBID the escape on an ordinary explanatory lesson (the Photosynthesis bug)
    expect(SPEC_V11_SYSTEM).toMatch(/documentedReasonAbsent/);
    expect(SPEC_V11_SYSTEM).toMatch(/ordinary explanatory lesson.*always needs both real primitives/is);
    expect(SPEC_V11_SYSTEM).toMatch(/never use documentedReasonAbsent to skip them/i);
    // the escape is valid ONLY on a genuinely apparatus-free page (NEITHER primitive present) — the
    // closed half-apparatus hole
    expect(SPEC_V11_SYSTEM).toMatch(/NO predict-gate AND NO self-check/i);
    expect(SPEC_V11_SYSTEM).toMatch(/does NOT excuse\s+a half-apparatus lesson/i);
  });

  it('TS-12b — the v11 prompt asks for one section per brief key point (N key-points → N sections)', async () => {
    // a brief with three key points must drive the prompt to request a section for EACH — not a blob
    const completeObject = vi.fn().mockResolvedValue({ object: validLessonSpec(), record: rec });
    const deps = { completeObject } as unknown as StageDeps;

    await specV11(
      { brief: v11Brief(), settings: { level: 'intro', depth: 2, audience: 'students' } },
      deps,
    );

    const prompt = completeObject.mock.calls[0]![0].prompt as string;
    // v11Brief() has 3 key points → the prompt states the count and asks for a section for each
    expect(prompt).toMatch(/Key points \(3;/);
    expect(prompt).toMatch(/a section for EACH key point/i);
    expect(prompt).toMatch(/Do NOT collapse to one\s+section/i);
    // and steers away from the escape hatch on an ordinary lesson
    expect(prompt).toMatch(/use documentedReasonAbsent ONLY for a/i);
  });

  // ── self-repair retry (TS-12b: refines absent from the JSON Schema → intermittent invalid specs) ──
  // A valid sectioned LessonSpec with BOTH load-bearing primitives — the shape a successful (or
  // self-corrected) emission produces.
  function validLessonSpec(): LessonSpec {
    return {
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
        ...contentFiller, // pad past the section floor so re-validation passes
      ],
      a11yContract: 'kb',
      citations: [],
    };
  }

  // A spec that VIOLATES a top-level refine: a self-check but NO predict-gate and no
  // documentedReasonAbsent (the exact intermittent failure TS-12b surfaced live).
  const missingPrimitive = {
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
    citations: [],
  };

  it('self-repairs a returned-but-invalid spec: re-calls with the Zod error appended, then succeeds', async () => {
    // The fake bypasses the SDK validation, so it RETURNS an invalid spec on the first call (no
    // predict-gate). specV11 must re-validate, append the Zod error, and re-call — succeeding on the retry.
    const completeObject = vi
      .fn()
      .mockResolvedValueOnce({ object: missingPrimitive, record: { ...rec, costUsd: 0.5 } })
      .mockResolvedValueOnce({ object: validLessonSpec(), record: { ...rec, costUsd: 0.7 } });
    const deps = { completeObject } as unknown as StageDeps;

    const out = await specV11(
      { brief: v11Brief(), settings: { level: 'intro', depth: 2, audience: 'students' } },
      deps,
    );

    if (!isLessonSpec(out.spec)) throw new Error('expected a LessonSpec');
    // it re-called exactly once after the invalid first attempt
    expect(completeObject).toHaveBeenCalledTimes(2);
    // the result is the valid (repaired) spec — both primitives present
    const hasPredictGate = out.spec.sections.some((s) => s.component?.kind === 'predict-gate');
    const hasSelfCheck = out.spec.sections.some(
      (s) => s.component?.kind === 'self-check' && !!s.component.answerable,
    );
    expect(hasPredictGate && hasSelfCheck).toBe(true);
    // BOTH attempts' cost records thread through (a returning attempt is a paid call)
    expect(out.records.map((r) => r.costUsd)).toEqual([0.5, 0.7]);
    // the retry prompt carries the repair feedback the model self-corrects against
    const retryPrompt = completeObject.mock.calls[1]![0].prompt as string;
    expect(retryPrompt).toMatch(/did NOT satisfy the LessonSpec contract/i);
    expect(retryPrompt).toMatch(/predict-gate/);
    // TS-12b: the repair must steer toward ADDING a real primitive + KEEPING existing sections,
    // and AWAY from the cheap path (collapse + documentedReasonAbsent) the live render exposed
    expect(retryPrompt).toMatch(/ADD the missing primitive as a REAL component/i);
    expect(retryPrompt).toMatch(/KEEP all the sections you already wrote/i);
    expect(retryPrompt).toMatch(/do NOT\s+collapse the lesson to fewer sections/i);
    expect(retryPrompt).toMatch(/Do NOT reach for documentedReasonAbsent/i);
    // and it still carries the base prompt (the brief feed) so the model has the full context
    expect(retryPrompt).toContain('understand recursion');
  });

  it('TS-12b — self-repair recovers by ADDING a real self-check (not the documentedReasonAbsent escape)', async () => {
    // First attempt lacks a self-check (a predict-gate only, no documentedReasonAbsent) — invalid.
    // The repaired attempt ADDS a REAL self-check section (with an answerable), the rich fix the steer
    // demands. Asserting the recovered spec has a real self-check primitive AND no escape hatch proves
    // the fix path is "add the missing primitive", not "collapse + documentedReasonAbsent".
    const predictGateOnly = {
      nodeSlug: 'recursion',
      sections: [
        {
          kind: 'hook',
          prose: 'why does a function call itself?',
          component: {
            kind: 'predict-gate',
            teachingPurpose: 'predict the stop condition',
            answerable: { prompt: 'what stops it?', answer: 'the base case' },
          },
        },
        { kind: 'concept', prose: 'a function that calls itself needs a base case' },
      ],
      a11yContract: 'kb',
      citations: [],
    };
    const completeObject = vi
      .fn()
      .mockResolvedValueOnce({ object: predictGateOnly, record: { ...rec, costUsd: 0.3 } })
      .mockResolvedValueOnce({ object: validLessonSpec(), record: { ...rec, costUsd: 0.4 } });
    const deps = { completeObject } as unknown as StageDeps;

    const out = await specV11(
      { brief: v11Brief(), settings: { level: 'intro', depth: 2, audience: 'students' } },
      deps,
    );

    if (!isLessonSpec(out.spec)) throw new Error('expected a LessonSpec');
    expect(completeObject).toHaveBeenCalledTimes(2);
    // the recovered spec carries a REAL self-check with an answerable — not the escape hatch
    const selfCheck = out.spec.sections.find(
      (s) => s.component?.kind === 'self-check' && !!s.component.answerable,
    );
    expect(selfCheck).toBeDefined();
    expect(selfCheck!.component!.answerable!.prompt.length).toBeGreaterThan(0);
    expect(selfCheck!.component!.answerable!.answer.length).toBeGreaterThan(0);
    expect(out.spec.documentedReasonAbsent).toBeUndefined(); // it did NOT use the escape hatch
    // and it kept BOTH primitives (rich, not collapsed)
    expect(out.spec.sections.some((s) => s.component?.kind === 'predict-gate')).toBe(true);
  });

  it('self-repairs when completeObject THROWS (the real SDK path) — re-calls, then succeeds', async () => {
    // The real client validates with the SAME schema and THROWS on a refine miss before returning, so
    // the live failure is a throw (no record to thread). The AI SDK wraps the failure TWO levels deep —
    // NoObjectGeneratedError → (a TypeValidationError-like wrapper) → ZodError — so the test mirrors
    // that depth to prove `findZodError` descends the `.cause` chain and prettifies the real Zod detail.
    const cause = LessonSpecSchema.safeParse(missingPrimitive);
    if (cause.success) throw new Error('fixture should be invalid');
    // Mirror the live two-level wrapping the AI SDK produces — NoObjectGeneratedError →
    // TypeValidationError → ZodError — with plain nested Errors (specV11 detects the ZodError by
    // walking `.cause`, not by the SDK's error class, so a structural mirror is the faithful fixture).
    const typeValidationLike = new Error('Type validation failed', { cause: cause.error });
    const thrown = new Error('No object generated: response did not match schema.', {
      cause: typeValidationLike,
    });
    const completeObject = vi
      .fn()
      .mockRejectedValueOnce(thrown)
      .mockResolvedValueOnce({ object: validLessonSpec(), record: { ...rec, costUsd: 0.9 } });
    const deps = { completeObject } as unknown as StageDeps;

    const out = await specV11(
      { brief: v11Brief(), settings: { level: 'intro', depth: 2, audience: 'students' } },
      deps,
    );

    if (!isLessonSpec(out.spec)) throw new Error('expected a LessonSpec');
    expect(completeObject).toHaveBeenCalledTimes(2);
    // only the successful (returning) attempt threads a record — the throwing attempt carries none
    expect(out.records.map((r) => r.costUsd)).toEqual([0.9]);
    // the retry prompt carries the prettified Zod detail dug out of the TWO-level-wrapped cause chain,
    // not the opaque SDK message — proving findZodError descended to the ZodError
    const retryPrompt = completeObject.mock.calls[1]![0].prompt as string;
    expect(retryPrompt).toMatch(/did NOT satisfy the LessonSpec contract/i);
    expect(retryPrompt).toContain('documentedReasonAbsent'); // the refine's path, from the prettified ZodError
  });

  it('fails loud after the bounded repair attempts rather than looping forever', async () => {
    // The model keeps emitting the same invalid spec; specV11 must stop after SPEC_V11_MAX_ATTEMPTS (3)
    // and surface the failure — never loop indefinitely on an unfixable model.
    const completeObject = vi.fn().mockResolvedValue({ object: missingPrimitive, record: rec });
    const deps = { completeObject } as unknown as StageDeps;

    await expect(
      specV11({ brief: v11Brief(), settings: { level: 'intro', depth: 2, audience: 'students' } }, deps),
    ).rejects.toThrow();
    expect(completeObject).toHaveBeenCalledTimes(3); // 1 initial + 2 repairs, then it gives up
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
