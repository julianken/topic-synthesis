/** The hub model, matching ai-concept-viz's window.SITEMAP shape. */

/**
 * The single source of truth for page statuses. The Postgres CHECK constraint in
 * `src/store/schema.sql` is held in sync with this list by a guard test
 * (`sitemap.test.ts`), so the SQL and the TS type can't silently diverge.
 */
export const PAGE_STATUSES = ['built', 'soon', 'text'] as const;
export type PageStatus = (typeof PAGE_STATUSES)[number];

export interface SitemapPage {
  slug: string;
  title: string;
  /** True only when status === 'built' (a real interactive page exists). */
  built: boolean;
  status: PageStatus;
  href: string;
}

export interface SitemapCategory {
  name: string;
  pages: SitemapPage[];
}

export interface SitemapTier {
  tier: string;
  categories: SitemapCategory[];
}

export interface SitemapHub {
  tiers: SitemapTier[];
}
