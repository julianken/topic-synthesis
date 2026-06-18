import { describe, expect, it } from 'vitest';
import type { PrereqGraph } from '../domain/stages';
import { DEFAULT_THRESHOLDS, gateGraph } from './coverage-gate';

function node(slug: string, coverageConfidence: number) {
  return { slug, title: slug, summary: `${slug} summary`, coverageConfidence };
}

describe('gateGraph', () => {
  it('routes nodes built/text/soon by coverage confidence', () => {
    const graph: PrereqGraph = {
      nodes: [node('a', 0.9), node('b', 0.5), node('c', 0.1)],
      edges: [],
    };
    const gated = gateGraph(graph);
    const route = (s: string) => gated.nodes.find((n) => n.slug === s)?.route;
    expect(route('a')).toBe('built'); // >= 0.7
    expect(route('b')).toBe('text'); // >= 0.4
    expect(route('c')).toBe('soon'); // < 0.4
  });

  it('treats thresholds as inclusive and honors custom thresholds', () => {
    const graph: PrereqGraph = { nodes: [node('x', 0.7), node('y', 0.4)], edges: [] };
    expect(gateGraph(graph).nodes.find((n) => n.slug === 'x')?.route).toBe('built'); // boundary inclusive
    const strict = gateGraph(graph, { built: 0.95, text: 0.5 });
    expect(strict.nodes.find((n) => n.slug === 'x')?.route).toBe('text'); // 0.7 in [0.5, 0.95)
    expect(strict.nodes.find((n) => n.slug === 'y')?.route).toBe('soon'); // 0.4 < 0.5
  });

  it('topologically orders prerequisites before dependents', () => {
    const graph: PrereqGraph = {
      nodes: [node('c', 0.8), node('a', 0.8), node('b', 0.8)],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
      ],
    };
    const { topoOrder } = gateGraph(graph);
    expect(topoOrder.indexOf('a')).toBeLessThan(topoOrder.indexOf('b'));
    expect(topoOrder.indexOf('b')).toBeLessThan(topoOrder.indexOf('c'));
  });

  it('throws on a cycle', () => {
    const graph: PrereqGraph = {
      nodes: [node('a', 0.8), node('b', 0.8)],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
    };
    expect(() => gateGraph(graph)).toThrow(/cycle/);
  });

  it('drops an edge referencing an unknown node (LLM slug noise must not crash the run)', () => {
    const graph: PrereqGraph = {
      nodes: [node('a', 0.8), node('b', 0.8)],
      edges: [
        { from: 'a', to: 'b' }, // valid → kept
        { from: 'a', to: 'ghost' }, // dangling → dropped
      ],
    };
    const gated = gateGraph(graph);
    expect(gated.edges).toEqual([{ from: 'a', to: 'b' }]); // only the valid edge survives
    expect(gated.topoOrder).toHaveLength(2); // both nodes still ordered
  });

  it('throws on a duplicate node slug', () => {
    const graph: PrereqGraph = { nodes: [node('a', 0.8), node('a', 0.5)], edges: [] };
    expect(() => gateGraph(graph)).toThrow(/duplicate/);
  });

  it('exposes conservative defaults', () => {
    expect(DEFAULT_THRESHOLDS).toEqual({ built: 0.7, text: 0.4 });
  });
});
