/**
 * tokens.ts — type-safe names for the design tokens declared in
 * `src/app/globals.css` `:root` (the DESIGN.md §0 manifest, materialized).
 *
 * This is a THIN NAME MAP, not a re-declaration of values: `globals.css` is the
 * single source of every token VALUE (DESIGN.md §0 is the source of truth above
 * it; `globals.css` and `src/app/artifact/serve.ts`'s `ARTIFACT_ROOT_TOKENS` are
 * the TWO materialized copies that must agree — DESIGN.md §0 "Two-copies
 * invariant"). This module exists so a consumer that references a token by name
 * gets a COMPILE-TIME error if the name is not declared — `cssVar('--no-such-token')`
 * does not type-check.
 *
 * Keeping the names here (rather than reading them off the stylesheet) means a
 * typo'd `var(--…)` is caught by `tsc`, not discovered as a silently-unresolved
 * custom property at runtime. When a token is added to / removed from the CSS,
 * update the matching tuple below in the same change — `tokens.test.ts` parses
 * the `globals.css` `:root` and asserts this map matches it name-for-name, so a
 * drift is a CI failure, not a silent gap.
 */

/** Color primitives — OKLCH ramps; the only place a raw OKLCH literal is written (DESIGN.md §0). */
export const colorPrimitiveTokens = [
  '--ink-950',
  '--ink-900',
  '--ink-850',
  '--ink-800',
  '--ink-700',
  '--fog-50',
  '--fog-100',
  '--fog-300',
  '--fog-450',
  '--fog-550',
  '--accent',
  '--accent-dim',
  '--ok',
  '--warn',
  '--err',
  '--kind-svg',
  '--kind-canvas',
  '--kind-html',
  '--pipeline',
  '--source-link',
  '--faint',
  '--badge-border-ok',
  '--badge-border-warn',
  '--badge-border-neutral',
] as const;

/** Semantic color tokens — alias a primitive, name its job (DESIGN.md §0). */
export const colorSemanticTokens = [
  '--bg-app',
  '--bg-surface',
  '--bg-raised',
  '--border',
  '--text',
  '--text-muted',
  '--text-faint',
  '--interactive',
  '--interactive-hover',
  '--status-built',
  '--status-soon',
  '--status-error',
] as const;

/**
 * Translucent / gradient SURFACE system — CHROME-ONLY frosted surfaces, the
 * radial app-bg, column dividers, and the brand mark gradient + glow (DESIGN.md
 * §0 — adopted from the Figma frames). Not injected into ARTIFACT_ROOT_TOKENS.
 */
export const surfaceTokens = [
  '--app-bg',
  '--surface-header',
  '--surface-panel',
  '--surface-panel-strong',
  '--surface-pill',
  '--surface-ledger',
  '--surface-divider',
  '--brand-gradient',
  '--brand-glow',
] as const;

/** Type scale — rem, fixed per role, non-modular (DESIGN.md §0 / §Typography). */
export const typeScaleTokens = [
  '--fs-hero',
  '--fs-h1',
  '--fs-title',
  '--fs-h2',
  '--fs-card-title',
  '--fs-lede',
  '--fs-body',
  '--fs-small',
  '--fs-mono',
  '--fs-caption',
  '--fs-micro',
] as const;

/** Letter-spacing scale — em (DESIGN.md §0 / §Typography). */
export const letterSpacingTokens = [
  '--ls-display-tight',
  '--ls-display',
  '--ls-snug',
  '--ls-meta',
  '--ls-eyebrow',
  '--ls-eyebrow-wide',
] as const;

/** Per-role line-heights — unitless (DESIGN.md §0 / §Typography). */
export const lineHeightTokens = [
  '--lh-reading',
  '--lh-display',
  '--lh-heading',
  '--lh-gloss',
  '--lh-card-desc',
] as const;

/** Spacing scale — rem (DESIGN.md §0). */
export const spaceTokens = [
  '--sp-1',
  '--sp-2',
  '--sp-3',
  '--sp-4',
  '--sp-5',
  '--sp-6',
  '--sp-7',
] as const;

/** Geometry — lesson-workspace spine/panel/frame metrics (DESIGN.md §0 / §Lesson layout). */
export const geometryTokens = [
  '--measure',
  '--panel-w',
  '--col-gap',
  '--edge-gap',
  '--scrub-w',
  '--frame-max',
] as const;

/** Radius scale (DESIGN.md §0). */
export const radiusTokens = [
  '--r-sm',
  '--r-md',
  '--r-card',
  '--r-card-lg',
  '--r-lg',
  '--r-pill',
  '--r-kbd',
] as const;

/** Motion durations + the single easing (DESIGN.md §0 / §Motion). */
export const motionTokens = ['--dur-fast', '--dur-base', '--dur-slow', '--ease'] as const;

/**
 * transitions-dev motion catalog primitives (DESIGN.md §Motion — TS-24): NAMED
 * transitions composing only `var(--dur-*)` + `var(--ease)`, so every animated
 * surface references a primitive by name and the value lives in one place.
 */
export const motionCatalogTokens = [
  '--tr-color',
  '--tr-bg',
  '--tr-hover',
  '--tr-progress',
  '--tr-state',
] as const;

/** Type families (DESIGN.md §0 / §Typography). */
export const typeFamilyTokens = ['--sans', '--mono', '--serif'] as const;

/** Every declared token name, one flat tuple. */
export const allTokens = [
  ...colorPrimitiveTokens,
  ...colorSemanticTokens,
  ...surfaceTokens,
  ...typeScaleTokens,
  ...letterSpacingTokens,
  ...lineHeightTokens,
  ...spaceTokens,
  ...geometryTokens,
  ...radiusTokens,
  ...motionTokens,
  ...motionCatalogTokens,
  ...typeFamilyTokens,
] as const;

/** A CSS custom-property name that is actually declared by the §0 token surface. */
export type TokenName = (typeof allTokens)[number];

/** Tier-scoped token-name unions, for consumers that want to constrain by tier. */
export type ColorPrimitiveToken = (typeof colorPrimitiveTokens)[number];
export type ColorSemanticToken = (typeof colorSemanticTokens)[number];
export type SurfaceToken = (typeof surfaceTokens)[number];
export type TypeScaleToken = (typeof typeScaleTokens)[number];
export type LetterSpacingToken = (typeof letterSpacingTokens)[number];
export type LineHeightToken = (typeof lineHeightTokens)[number];
export type SpaceToken = (typeof spaceTokens)[number];
export type GeometryToken = (typeof geometryTokens)[number];
export type RadiusToken = (typeof radiusTokens)[number];
export type MotionToken = (typeof motionTokens)[number];

/**
 * Build a `var(--token)` reference for a DECLARED token name. Referencing an
 * undeclared name is a compile-time error — that is the whole point of this
 * module. The value still resolves from `globals.css` at runtime; this only
 * types the name. An optional fallback is appended as the CSS `var()` second
 * argument.
 */
export function cssVar(name: TokenName, fallback?: string): string {
  return fallback === undefined ? `var(${name})` : `var(${name}, ${fallback})`;
}
