import { describe, expect, it } from 'vitest';
import type { SitemapPage } from '../../domain/sitemap';
import { tileView } from './view';

const mk = (over: Partial<SitemapPage>): SitemapPage => ({
  slug: 's',
  title: 'T',
  built: false,
  status: 'soon',
  href: '/artifact/enc',
  ...over,
});

describe('tileView', () => {
  it('links a built tile to its detail view by slug (URL-safe, not the #-laden pageId)', () => {
    const t = tileView(mk({ slug: 'sine', title: 'Sine', built: true, status: 'built' }), 'cur1');
    expect(t.href).toBe('/curriculum/cur1/sine');
    expect(t.statusLabel).toBe('Built');
  });

  it('does not link a soon or text tile (no page to view)', () => {
    expect(tileView(mk({ status: 'soon' }), 'cur1').href).toBeNull();
    const text = tileView(mk({ status: 'text' }), 'cur1');
    expect(text.href).toBeNull();
    expect(text.statusLabel).toBe('Text');
  });
});
