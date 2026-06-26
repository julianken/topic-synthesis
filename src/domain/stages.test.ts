import { describe, expect, it } from 'vitest';
import {
  type LessonSpec,
  LessonSpecSchema,
  MIN_LESSON_SECTIONS,
  PageSpecSchema,
  PlanSchema,
  PrereqGraphSchema,
  SECTION_KINDS,
} from './stages';

describe('stage schemas', () => {
  it('PrereqGraphSchema parses object-shaped edges + coverage', () => {
    const parsed = PrereqGraphSchema.parse({
      nodes: [{ slug: 'a', title: 'A', summary: 's', coverageConfidence: 0.8 }],
      edges: [{ from: 'a', to: 'a' }],
    });
    expect(parsed.edges[0]).toEqual({ from: 'a', to: 'a' });
  });

  it('rejects coverageConfidence outside [0,1]', () => {
    expect(() =>
      PrereqGraphSchema.parse({
        nodes: [{ slug: 'a', title: 'A', summary: 's', coverageConfidence: 1.5 }],
        edges: [],
      }),
    ).toThrow();
  });

  it('PageSpecSchema constrains interactionKind to the enum', () => {
    expect(() =>
      PageSpecSchema.parse({
        nodeSlug: 'a',
        interactionKind: 'webgl',
        a11yContract: 'c',
        citations: [],
      }),
    ).toThrow();
  });

  it('PlanSchema parses a minimal plan', () => {
    expect(PlanSchema.parse({ scope: 's', subtopics: [], researchQuestions: [] }).scope).toBe('s');
  });
});

describe('LessonSpecSchema (TS-10 — typed sectioned spec + non-optional pedagogy primitives)', () => {
  // A base section helper so each test isolates the ONE invariant it asserts.
  const section = (overrides: Partial<LessonSpec['sections'][number]>): LessonSpec['sections'][number] => ({
    kind: 'concept',
    prose: 'some prose',
    ...overrides,
  });
  const predictGateSection = section({
    kind: 'hook',
    component: {
      kind: 'predict-gate',
      teachingPurpose: 'surface the learner’s prior belief before the reveal',
      answerable: { prompt: 'What happens to the wave?', answer: 'it doubles in frequency' },
    },
  });
  const selfCheckSection = section({
    kind: 'self-check',
    component: {
      kind: 'self-check',
      teachingPurpose: 'force retrieval of the key relationship',
      answerable: { prompt: 'Define the period.', answer: '1 / frequency' },
    },
  });
  // Prose-only content sections — they carry NO apparatus component, so they pad a spec up to the
  // section floor WITHOUT affecting the primitive logic the surrounding test is asserting.
  const contentFiller = (n: number): LessonSpec['sections'] =>
    Array.from({ length: n }, () => section({ kind: 'concept', prose: 'content prose' }));
  // Pad an arbitrary sections array up to MIN_LESSON_SECTIONS with prose-only filler so a spec under
  // test clears the floor and isolates the invariant it actually asserts. A no-op once already ≥ floor.
  const withFloor = (sections: LessonSpec['sections']): LessonSpec['sections'] => [
    ...sections,
    ...contentFiller(Math.max(0, MIN_LESSON_SECTIONS - sections.length)),
  ];
  const base = (overrides: Partial<LessonSpec>): unknown => ({
    nodeSlug: 'sine',
    sections: [],
    a11yContract: 'keyboard operable; text alternatives provided',
    citations: [],
    ...overrides,
  });

  it('the seven section kinds are exactly the locked taxonomy in order', () => {
    expect([...SECTION_KINDS]).toEqual([
      'hook',
      'concrete-case',
      'concept',
      'worked-example',
      'intuition',
      'self-check',
      'takeaways',
    ]);
  });

  // (a) — well-formed: a predict-gate + a self-check with an answerable item (padded to the floor)
  // parses.
  it('parses a well-formed spec with a predict-gate AND a self-check with an answerable item', () => {
    const result = LessonSpecSchema.safeParse(
      base({ sections: withFloor([predictGateSection, selfCheckSection]) }),
    );
    expect(result.success).toBe(true);
  });

  // (b) — neither primitive AND no documentedReasonAbsent → fails.
  it('rejects a spec with neither primitive and no documentedReasonAbsent', () => {
    const result = LessonSpecSchema.safeParse(
      base({ sections: [section({}), section({}), section({})] }),
    );
    expect(result.success).toBe(false);
  });

  // (b′) — an EMPTY documentedReasonAbsent does not rescue it (min(1) rejects the empty string).
  it('rejects a spec with neither primitive and an empty documentedReasonAbsent', () => {
    const result = LessonSpecSchema.safeParse(
      base({ sections: [section({})], documentedReasonAbsent: '' }),
    );
    expect(result.success).toBe(false);
  });

  // (b″) — a WHITESPACE-ONLY documentedReasonAbsent does not rescue it either. This field has no
  // downstream critic backstop, so the schema is the only guard: `.trim().min(1)` must reject "   "
  // so a single space can't silently disable the "teaches nothing is UNPARSEABLE" guarantee.
  it('rejects a spec with neither primitive and a whitespace-only documentedReasonAbsent', () => {
    const result = LessonSpecSchema.safeParse(
      base({ sections: [section({})], documentedReasonAbsent: '   ' }),
    );
    expect(result.success).toBe(false);
  });

  // (c) — a GENUINE apparatus-free reference page: NEITHER primitive, a non-empty
  // documentedReasonAbsent, AND ≥ the section floor (a reference page is still multi-section) → parses.
  it('parses a genuine apparatus-free multi-section reference page with documentedReasonAbsent and neither primitive', () => {
    const result = LessonSpecSchema.safeParse(
      base({
        sections: withFloor([section({ kind: 'concept' })]),
        documentedReasonAbsent: 'a pure-definition reference page — a predict-gate is pedagogically wrong here',
      }),
    );
    expect(result.success).toBe(true);
  });

  // (d) — an empty teachingPurpose fails the schema-level min(1) (distinct from the generic-purpose
  // CRITIC judgement, which TS-7 owns).
  it('rejects a component with an empty teachingPurpose (schema min(1), not the generic-purpose critic check)', () => {
    const result = LessonSpecSchema.safeParse(
      base({
        sections: withFloor([
          predictGateSection,
          section({
            kind: 'self-check',
            component: {
              kind: 'self-check',
              teachingPurpose: '',
              answerable: { prompt: 'Define the period.', answer: '1 / frequency' },
            },
          }),
        ]),
      }),
    );
    expect(result.success).toBe(false);
  });

  // (d′) — a WHITESPACE-ONLY teachingPurpose fails too: `.trim().min(1)` rejects "   " so a single
  // space can't pass as a stated purpose (the empty-string guard at (d) extended to whitespace).
  it('rejects a component with a whitespace-only teachingPurpose', () => {
    const result = LessonSpecSchema.safeParse(
      base({
        sections: withFloor([
          predictGateSection,
          section({
            kind: 'self-check',
            component: {
              kind: 'self-check',
              teachingPurpose: '   ',
              answerable: { prompt: 'Define the period.', answer: '1 / frequency' },
            },
          }),
        ]),
      }),
    );
    expect(result.success).toBe(false);
  });

  // (e) — a self-check whose answerable item is empty fails (empty prompt OR empty answer).
  it('rejects a self-check whose answerable prompt/answer is empty', () => {
    const emptyAnswer = LessonSpecSchema.safeParse(
      base({
        sections: withFloor([
          predictGateSection,
          section({
            kind: 'self-check',
            component: {
              kind: 'self-check',
              teachingPurpose: 'retrieval',
              answerable: { prompt: 'Define the period.', answer: '' },
            },
          }),
        ]),
      }),
    );
    expect(emptyAnswer.success).toBe(false);
  });

  // (e′) — a primitive component MISSING its answerable item entirely fails (the SectionSchema refine).
  it('rejects a predict-gate / self-check component with no answerable item', () => {
    const result = LessonSpecSchema.safeParse(
      base({
        sections: withFloor([
          section({
            kind: 'hook',
            component: { kind: 'predict-gate', teachingPurpose: 'surface a prior belief' },
          }),
          selfCheckSection,
        ]),
      }),
    );
    expect(result.success).toBe(false);
  });

  // learningGoal stays OFF the spec (it lives only on LessonBrief) — AC #7.
  it('does not declare learningGoal on the spec (it remains on LessonBrief only)', () => {
    const result = LessonSpecSchema.safeParse(
      base({ sections: withFloor([predictGateSection, selfCheckSection]) }),
    );
    expect(result.success).toBe(true);
    if (result.success) expect('learningGoal' in result.data).toBe(false);
  });

  // ── TS-12b — the documentedReasonAbsent hole + the section floor ──────────────────────────────
  // (f) — THE CLOSED HOLE: a predict-gate-only spec (one primitive present, the self-check missing)
  // with a non-empty documentedReasonAbsent now FAILS. Before TS-12b this PASSED (any non-empty
  // string bypassed the both-primitives requirement) — the exact live abuse: a 1-section hook with a
  // predict-gate and a lie in documentedReasonAbsent shipped a thin half-apparatus lesson.
  it('rejects a half-apparatus spec (predict-gate only) even WITH a non-empty documentedReasonAbsent', () => {
    const result = LessonSpecSchema.safeParse(
      base({
        sections: withFloor([predictGateSection]),
        documentedReasonAbsent: 'not-used — both required primitives are present',
      }),
    );
    expect(result.success).toBe(false);
  });

  // (f′) — the symmetric half-apparatus case: a self-check-only spec with documentedReasonAbsent also
  // FAILS. The escape excuses ONLY a page with NEITHER primitive, so one-primitive-present is invalid
  // whichever primitive it is.
  it('rejects a half-apparatus spec (self-check only) even WITH a non-empty documentedReasonAbsent', () => {
    const result = LessonSpecSchema.safeParse(
      base({
        sections: withFloor([selfCheckSection]),
        documentedReasonAbsent: 'a self-check is present so this should not excuse a missing predict-gate',
      }),
    );
    expect(result.success).toBe(false);
  });

  // (g) — THE FLOOR: a degenerate 1-section spec FAILS even when it carries BOTH primitives is
  // impossible at one section (one section holds ≤1 component), so the realistic degenerate case is a
  // single section. A lone predict-gate hook + documentedReasonAbsent — the live shape — fails on
  // BOTH the floor and the closed hole.
  it('rejects a degenerate 1-section spec (below the section floor)', () => {
    const result = LessonSpecSchema.safeParse(
      base({
        sections: [predictGateSection],
        documentedReasonAbsent: 'not-used — both required primitives are present',
      }),
    );
    expect(result.success).toBe(false);
  });

  // (g′) — the floor bites a 1-section spec on its own: even a hypothetical lone section can't reach
  // the floor of MIN_LESSON_SECTIONS, so a 1-section spec is invalid regardless of the escape.
  it('rejects a 1-section spec on the floor alone (well under MIN_LESSON_SECTIONS)', () => {
    expect(MIN_LESSON_SECTIONS).toBeGreaterThanOrEqual(4);
    const result = LessonSpecSchema.safeParse(
      base({
        sections: [section({ kind: 'concept' })],
        documentedReasonAbsent: 'a pure-definition reference page',
      }),
    );
    expect(result.success).toBe(false);
  });

  // (h) — a RICH both-primitives multi-section spec (well above the floor) parses — the happy path the
  // tightened rules must not regress.
  it('parses a rich both-primitives multi-section spec (above the floor)', () => {
    const result = LessonSpecSchema.safeParse(
      base({
        sections: [
          predictGateSection,
          section({ kind: 'concrete-case' }),
          section({ kind: 'concept' }),
          section({ kind: 'worked-example' }),
          section({ kind: 'intuition' }),
          selfCheckSection,
          section({ kind: 'takeaways' }),
        ],
      }),
    );
    expect(result.success).toBe(true);
  });
});
