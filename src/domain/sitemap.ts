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
  /**
   * True when the persisted page row carries a non-empty HTML artifact — PRESENCE ONLY (the blob is
   * never read here). Set authoritatively by the READ path (`rebuildHub`, `src/store/repo.ts`) from
   * `p.html IS NOT NULL AND p.html <> ''`; pipeline-side constructors (`assembleHub`) set the structural
   * default (a built page carries html). It is what lets the reader distinguish a reviewer-HELD lesson
   * (status `soon` WITH html present) from one that FAILED to produce an artifact (status `soon`, html
   * null) — the honest `built | held | failed` disposition, issue #215.
   */
  hasHtml: boolean;
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
