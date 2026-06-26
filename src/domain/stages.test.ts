import { describe, expect, it } from 'vitest';
import {
  type LessonSpec,
  LessonSpecSchema,
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

  // (a) — well-formed: a predict-gate + a self-check with an answerable item parses.
  it('parses a well-formed spec with a predict-gate AND a self-check with an answerable item', () => {
    const result = LessonSpecSchema.safeParse(
      base({ sections: [predictGateSection, selfCheckSection] }),
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

  // (c) — neither primitive but a non-empty documentedReasonAbsent → parses.
  it('parses a spec with neither primitive but a non-empty documentedReasonAbsent', () => {
    const result = LessonSpecSchema.safeParse(
      base({
        sections: [section({})],
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
        sections: [
          predictGateSection,
          section({
            kind: 'self-check',
            component: {
              kind: 'self-check',
              teachingPurpose: '',
              answerable: { prompt: 'Define the period.', answer: '1 / frequency' },
            },
          }),
        ],
      }),
    );
    expect(result.success).toBe(false);
  });

  // (e) — a self-check whose answerable item is empty fails (empty prompt OR empty answer).
  it('rejects a self-check whose answerable prompt/answer is empty', () => {
    const emptyAnswer = LessonSpecSchema.safeParse(
      base({
        sections: [
          predictGateSection,
          section({
            kind: 'self-check',
            component: {
              kind: 'self-check',
              teachingPurpose: 'retrieval',
              answerable: { prompt: 'Define the period.', answer: '' },
            },
          }),
        ],
      }),
    );
    expect(emptyAnswer.success).toBe(false);
  });

  // (e′) — a primitive component MISSING its answerable item entirely fails (the SectionSchema refine).
  it('rejects a predict-gate / self-check component with no answerable item', () => {
    const result = LessonSpecSchema.safeParse(
      base({
        sections: [
          section({
            kind: 'hook',
            component: { kind: 'predict-gate', teachingPurpose: 'surface a prior belief' },
          }),
          selfCheckSection,
        ],
      }),
    );
    expect(result.success).toBe(false);
  });

  // learningGoal stays OFF the spec (it lives only on LessonBrief) — AC #7.
  it('does not declare learningGoal on the spec (it remains on LessonBrief only)', () => {
    const result = LessonSpecSchema.safeParse(
      base({ sections: [predictGateSection, selfCheckSection] }),
    );
    expect(result.success).toBe(true);
    if (result.success) expect('learningGoal' in result.data).toBe(false);
  });
});
