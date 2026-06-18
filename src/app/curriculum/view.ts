import type { PageStatus, SitemapPage } from '../../domain/sitemap';

export interface TileView {
  title: string;
  status: PageStatus;
  statusLabel: string;
  /** Decorative glyph paired with the label — DESIGN.md asks for status by label + icon, never
   *  color alone. Rendered `aria-hidden`; the label carries the meaning for assistive tech. */
  icon: string;
  /** Detail-view link (the sandboxed iframe) for a built page; null for a soon/text tile. */
  href: string | null;
}

const STATUS_LABEL: Record<PageStatus, string> = { built: 'Built', soon: 'Soon', text: 'Text' };
const STATUS_ICON: Record<PageStatus, string> = { built: '✓', soon: '◷', text: '≡' };

/**
 * Presentational props for one hub tile. Pure. A built tile links to its detail view keyed by
 * the URL-safe **slug** (`/curriculum/<id>/<slug>`) — NOT the content-identity pageId, which
 * contains `#`/`@`/`:` and breaks Next's nested page-route matching even URL-encoded. The slug
 * is curriculum-unique (the gate rejects duplicate slugs); the detail page resolves it to the
 * page's `/artifact/<encoded pageId>` href for the iframe.
 */
export function tileView(page: SitemapPage, curriculumId: string): TileView {
  return {
    title: page.title,
    status: page.status,
    statusLabel: STATUS_LABEL[page.status],
    icon: STATUS_ICON[page.status],
    href: page.built ? `/curriculum/${curriculumId}/${encodeURIComponent(page.slug)}` : null,
  };
}
