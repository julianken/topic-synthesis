import { describe, expect, it } from 'vitest';
import { PageSpecSchema, PlanSchema, PrereqGraphSchema } from './stages';

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
