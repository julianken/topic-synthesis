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
 * graph. It THROWS only on a duplicate slug; it DROPS edges referencing an unknown node
 * and BREAKS cycles (dropping the back-edges), because LLM graph output isn't a guaranteed
 * DAG and a quirk shouldn't crash the run. It routes each node to built | text | soon by
 * coverage confidence — thin coverage degrades to text/soon; the gate never invents a page.
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
  // Drop edges referencing an unknown node (LLM slug noise — e.g. an abbreviated slug in an
  // edge — shouldn't crash the whole curriculum).
  const knownEdges = graph.edges.filter((edge) => slugs.has(edge.from) && slugs.has(edge.to));

  // Order all nodes, breaking any cycle deterministically (a cyclic prerequisite graph is an
  // LLM contradiction, not a reason to crash), then keep only forward edges: a back-edge —
  // `from` after `to` in the order — is the cycle edge we drop, so the result is a valid DAG.
  const topoOrder = topoSort(graph.nodes, knownEdges);
  const position = new Map(topoOrder.map((slug, i) => [slug, i] as const));
  const edges = knownEdges.filter((e) => (position.get(e.from) ?? 0) < (position.get(e.to) ?? 0));

  const nodes: GatedNode[] = graph.nodes.map((node) => ({
    ...node,
    route: routeFor(node.coverageConfidence, thresholds),
  }));
  return { nodes, edges, topoOrder };
}

/**
 * Kahn's topological sort that BREAKS cycles instead of failing: when no node has all its
 * prerequisites satisfied but nodes remain (a cycle), it forces the earliest-declared
 * unprocessed node ready — deterministically cutting one cycle edge. Returns a complete
 * order over every node; the caller drops the back-edges this order implies.
 */
function topoSort(nodes: PrereqGraph['nodes'], edges: PrereqGraph['edges']): string[] {
  const indegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) {
    indegree.set(node.slug, 0);
    adjacency.set(node.slug, []);
  }
  for (const edge of edges) {
    adjacency.get(edge.from)?.push(edge.to);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }

  const order: string[] = [];
  const done = new Set<string>();
  while (order.length < nodes.length) {
    // Prefer a node whose prerequisites are all placed; if none (a cycle), force the
    // earliest-declared unprocessed node — deterministic, and cuts the cycle there.
    const next =
      nodes.find((n) => !done.has(n.slug) && (indegree.get(n.slug) ?? 0) === 0) ??
      nodes.find((n) => !done.has(n.slug));
    if (!next) break; // unreachable while order.length < nodes.length
    order.push(next.slug);
    done.add(next.slug);
    for (const target of adjacency.get(next.slug) ?? []) {
      indegree.set(target, (indegree.get(target) ?? 0) - 1);
    }
  }
  return order;
}
