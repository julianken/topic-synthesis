import type { GatedGraph, GatedNode, PrereqGraph } from '../domain/stages';
import type { PageStatus } from '../domain/sitemap';

/**
 * Coverage thresholds → routing. A node routes 'built' at/above `built`, 'text'
 * at/above `text`, else 'soon'. Tunable per workflow_version; defaults are
 * conservative (we'd rather ship a cited text page than a thinly-grounded build).
 */
export interface GateThresholds {
  built: number;
  text: number;
}

export const DEFAULT_THRESHOLDS: GateThresholds = { built: 0.7, text: 0.4 };

function routeFor(confidence: number, thresholds: GateThresholds): PageStatus {
  if (confidence >= thresholds.built) return 'built';
  if (confidence >= thresholds.text) return 'text';
  return 'soon';
}

/**
 * The grounding/coverage gate — a pure, deterministic pass over the prerequisite
 * graph. It validates structural integrity (no duplicate slugs, no edge to an
 * unknown node, no cycle), throwing on any defect rather than fabricating, and
 * routes each node to built | text | soon by its coverage confidence. Thin coverage
 * degrades to text/soon; the gate never invents an interactive page.
 */
export function gateGraph(
  graph: PrereqGraph,
  thresholds: GateThresholds = DEFAULT_THRESHOLDS,
): GatedGraph {
  const slugs = new Set<string>();
  for (const node of graph.nodes) {
    if (slugs.has(node.slug)) {
      throw new Error(`coverage-gate: duplicate node slug "${node.slug}"`);
    }
    slugs.add(node.slug);
  }
  for (const edge of graph.edges) {
    if (!slugs.has(edge.from) || !slugs.has(edge.to)) {
      throw new Error(`coverage-gate: edge references an unknown node (${edge.from} -> ${edge.to})`);
    }
  }

  const topoOrder = topoSort(graph); // throws on a cycle
  const nodes: GatedNode[] = graph.nodes.map((node) => ({
    ...node,
    route: routeFor(node.coverageConfidence, thresholds),
  }));
  return { nodes, edges: graph.edges, topoOrder };
}

/** Kahn's algorithm; throws if the prerequisite graph is not a DAG. */
function topoSort(graph: PrereqGraph): string[] {
  const indegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const node of graph.nodes) {
    indegree.set(node.slug, 0);
    adjacency.set(node.slug, []);
  }
  for (const edge of graph.edges) {
    adjacency.get(edge.from)?.push(edge.to);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }

  const ready = graph.nodes.filter((n) => indegree.get(n.slug) === 0).map((n) => n.slug);
  const order: string[] = [];
  while (ready.length > 0) {
    const slug = ready.shift() as string;
    order.push(slug);
    for (const next of adjacency.get(slug) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) ready.push(next);
    }
  }
  if (order.length !== graph.nodes.length) {
    throw new Error('coverage-gate: prerequisite graph has a cycle');
  }
  return order;
}
