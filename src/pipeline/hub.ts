// DORMANT(curriculum-wrapper — ADR-0003 / epic #52): `assembleHub` builds the tiered sitemap for the
// curriculum path (`runPipeline`) ONLY — the live single-lesson path (`runLesson`) assembles a trivial
// one-page hub inline and never calls this. RETAINED for the wrapper milestone; unit-tested. See ADR-0003.
import type { GatedGraph, GatedNode } from '../domain/stages';
import type { PageStatus, SitemapHub, SitemapPage, SitemapTier } from '../domain/sitemap';

/**
 * Assemble the final tiered SITEMAP from the gated graph plus the set of slugs whose
 * 'built'-routed page passed the critic. Pure and total: it always returns a hub, so
 * a degraded curriculum (some nodes 'soon'/'text') ships rather than failing. Tiers
 * come from prerequisite depth (foundational concepts first). `built` is true only
 * when the node routed 'built' AND its page passed the critic — a 'built'-routed node
 * that failed degrades to 'soon', never a broken interactive page.
 */
export function assembleHub(gated: GatedGraph, passedSlugs: ReadonlySet<string>): SitemapHub {
  const depth = prerequisiteDepth(gated);
  const byLevel = new Map<number, SitemapPage[]>();

  for (const node of gated.nodes) {
    const status = finalStatus(node, passedSlugs.has(node.slug));
    const page: SitemapPage = {
      slug: node.slug,
      title: node.title,
      built: status === 'built',
      // Structural default on the pipeline-assembled hub (DORMANT curriculum path): a built page carries
      // html. The AUTHORITATIVE read-path value comes from rebuildHub (src/store/repo.ts) off the
      // persisted row — this pipeline hub is rebuilt from the DB on read, so this field is never the
      // disposition source (issue #215; mirrors the `href` placeholder note below).
      hasHtml: status === 'built',
      status,
      // Placeholder: the read path (rebuildHub in src/store/repo.ts) sets the real owner-scoped
      // /curriculum/<id>/artifact/<slug> href; this pipeline-built href is never consumed (the hub is
      // always rebuilt from the DB on read), so it must not point at a route.
      href: '',
    };
    const level = depth.get(node.slug) ?? 0;
    const pages = byLevel.get(level) ?? [];
    pages.push(page);
    byLevel.set(level, pages);
  }

  const tiers: SitemapTier[] = [...byLevel.keys()]
    .sort((a, b) => a - b)
    .map((level) => ({
      tier: `Tier ${level + 1}`,
      categories: [{ name: 'Core concepts', pages: byLevel.get(level) ?? [] }],
    }));
  return { tiers };
}

function finalStatus(node: GatedNode, passed: boolean): PageStatus {
  if (node.route === 'built') return passed ? 'built' : 'soon';
  return node.route; // 'text' | 'soon'
}

/** Longest prerequisite chain ending at each node (0 = a root with no prerequisites). */
function prerequisiteDepth(gated: GatedGraph): Map<string, number> {
  const prerequisites = new Map<string, string[]>();
  for (const node of gated.nodes) prerequisites.set(node.slug, []);
  for (const edge of gated.edges) prerequisites.get(edge.to)?.push(edge.from);

  // topoOrder lists every node after all its prerequisites, so a single forward pass
  // computes each node's longest prerequisite chain — no recursion (can't stack-overflow
  // on a malformed graph) and no Math.max(...spread) (safe for arbitrarily wide nodes).
  const depth = new Map<string, number>();
  for (const slug of gated.topoOrder) {
    let value = 0;
    for (const prereq of prerequisites.get(slug) ?? []) {
      value = Math.max(value, (depth.get(prereq) ?? 0) + 1);
    }
    depth.set(slug, value);
  }
  return depth;
}
