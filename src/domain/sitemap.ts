/** The hub model, matching ai-concept-viz's window.SITEMAP shape. */
export type PageStatus = 'built' | 'soon' | 'text';

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
