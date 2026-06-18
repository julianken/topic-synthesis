import { describe, expect, it } from 'vitest';
import type { GatedGraph } from '../domain/stages';
import type { PageStatus } from '../domain/sitemap';
import { assembleHub } from './hub';

function gnode(slug: string, route: PageStatus) {
  return { slug, title: slug.toUpperCase(), summary: `${slug} summary`, coverageConfidence: 0.8, route };
}

describe('assembleHub', () => {
  it('marks a page built only when routed built AND it passed the critic', () => {
    const gated: GatedGraph = {
      nodes: [gnode('a', 'built'), gnode('b', 'built'), gnode('c', 'text'), gnode('d', 'soon')],
      edges: [],
      topoOrder: ['a', 'b', 'c', 'd'],
    };
    const hub = assembleHub(gated, new Set(['a'])); // only 'a' passed the critic
    const pages = hub.tiers.flatMap((t) => t.categories.flatMap((c) => c.pages));
    const status = (s: string) => pages.find((p) => p.slug === s)?.status;
    expect(status('a')).toBe('built'); // built route + passed
    expect(status('b')).toBe('soon'); // built route + NOT passed → degrade
    expect(status('c')).toBe('text'); // text route stays text
    expect(status('d')).toBe('soon'); // soon stays soon
    expect(pages.find((p) => p.slug === 'a')?.built).toBe(true);
    expect(pages.find((p) => p.slug === 'b')?.built).toBe(false);
  });

  it('tiers nodes by prerequisite depth (foundational first)', () => {
    const gated: GatedGraph = {
      nodes: [gnode('a', 'built'), gnode('b', 'built'), gnode('c', 'built')],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
      ],
      topoOrder: ['a', 'b', 'c'],
    };
    const hub = assembleHub(gated, new Set(['a', 'b', 'c']));
    expect(hub.tiers).toHaveLength(3);
    expect(hub.tiers[0]?.tier).toBe('Tier 1');
    expect(hub.tiers[0]?.categories[0]?.pages[0]?.slug).toBe('a');
    expect(hub.tiers[2]?.categories[0]?.pages[0]?.slug).toBe('c');
  });

  it('always returns a hub even when every node degraded (a curriculum still ships)', () => {
    const gated: GatedGraph = {
      nodes: [gnode('a', 'soon'), gnode('b', 'text')],
      edges: [],
      topoOrder: ['a', 'b'],
    };
    const hub = assembleHub(gated, new Set()); // nothing passed
    const pages = hub.tiers.flatMap((t) => t.categories.flatMap((c) => c.pages));
    expect(pages).toHaveLength(2);
    expect(pages.every((p) => !p.built)).toBe(true);
    expect(pages.find((p) => p.slug === 'a')?.href).toBe('/artifact/a');
  });
});
