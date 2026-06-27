import type { StoredPage } from '../../store/repo';

/**
 * CSP for a generated artifact page. The page may run its OWN inline scripts/styles (that is
 * the interactivity — canvas/SVG/sliders) but can load nothing external and exfiltrate nothing
 * (`default-src 'none'`). Paired with the hub's iframe `sandbox="allow-scripts"` WITHOUT
 * `allow-same-origin` (so the page runs in an opaque origin), an XSS in untrusted generated
 * HTML cannot reach the app's origin, cookies, or storage. `frame-ancestors 'self'` lets only
 * our own hub frame it. This is the sandbox boundary — NOT DOMPurify, which would strip the
 * very scripts that make the page interactive.
 */
export const ARTIFACT_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  "frame-ancestors 'self'",
  // form-action and base-uri do NOT fall back to default-src, so set them explicitly:
  // form-action 'none' blocks a generated page auto-submitting a <form> to an external URL
  // (the one POST-exfiltration vector that survives default-src 'none'); base-uri 'none'
  // forbids a <base> tag from re-pointing relative URLs. Together the no-fallback set is complete.
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

/**
 * The canonical DESIGN.md §0 token values, transcribed VERBATIM from the locked OKLCH manifest
 * (`DESIGN.md ## 0. Token Manifest` — the single source of truth, materialized in `globals.css`).
 * This is NOT a second source of truth: it is the artifact-injected copy of the §0 manifest (a
 * reconciled value, not a fork — DESIGN.md wins on any design conflict). Every name here is RESOLVED
 * to its final literal (no `var()` indirection), because the artifact runs in an opaque-origin
 * sandbox with no cascade from the parent app's `globals.css`, so the injected block must
 * self-resolve. Color values are OKLCH only — no sRGB hex (the serve.test guard forbids hex here).
 *
 * TWO copies of the §0 manifest exist after the v11 pipeline revert dropped the third (`code.ts`'s
 * inline `var()` fallbacks): `globals.css` (the source of truth) and this block. A §0 retoken MUST
 * edit BOTH in the same PR. `serve.test.ts` is the CI guard: a NAME check (every injected token
 * exists in `globals.css`) plus a VALUE-drift check that asserts each value here equals the resolved
 * `globals.css` value — so forgetting this copy is a CI failure, not a silent old-theme serve. The
 * one allowed divergence is the chrome font stacks (`--sans`/`--mono`), which globals.css leads with
 * a next/font CSS var (`--font-inter`/`--font-jetbrains-mono`) the sandbox can't see; the artifact
 * drops that loaded-font prefix and the test normalizes it away before comparing (the rest of each
 * stack still locks). (DESIGN.md §0 "Two-copies invariant" / the Update-Triggers table flag this.)
 * Exported so the value-drift test can compare each literal against `globals.css`.
 */
export const ARTIFACT_ROOT_TOKENS: Readonly<Record<string, string>> = {
  // color (OKLCH — dark instrument aesthetic, never light)
  '--bg-app': 'oklch(0.165 0.018 250)',
  '--bg-surface': 'oklch(0.205 0.020 250)',
  '--bg-raised': 'oklch(0.215 0.018 250)',
  '--border': 'oklch(0.32 0.020 250)',
  '--text': 'oklch(0.95 0.008 250)',
  '--text-muted': 'oklch(0.74 0.015 250)',
  '--text-faint': 'oklch(0.65 0.016 250)',
  '--accent': 'oklch(0.82 0.145 215)',
  '--accent-dim': 'oklch(0.70 0.11 215)',
  '--ok': 'oklch(0.78 0.15 152)',
  '--warn': 'oklch(0.82 0.13 80)',
  '--err': 'oklch(0.66 0.17 25)',
  '--kind-svg': 'oklch(0.80 0.13 295)',
  '--kind-canvas': 'oklch(0.82 0.13 50)',
  '--kind-html': 'oklch(0.80 0.12 175)',
  // additional color primitives (Figma 1:2/6:2 frames — generated lessons cite sources + may render a
  // pipeline-green accent; the badge-border tints back any in-artifact status chip). OKLCH only — the
  // serve.test sRGB-hex guard forbids hex in the injected block. (The translucent/gradient SURFACE
  // tokens are chrome-only and deliberately NOT injected — the artifact has no app cascade to float over.)
  '--pipeline': 'oklch(0.762 0.154 159)',
  '--source-link': 'oklch(0.697 0.160 258)',
  '--faint': 'oklch(0.568 0.029 254)',
  '--badge-border-ok': 'oklch(0.499 0.080 152)',
  '--badge-border-warn': 'oklch(0.549 0.090 80)',
  '--badge-border-neutral': 'oklch(0.401 0.019 248)',
  // type scale + per-role line-heights + letter-spacing + radii (so a generated lesson can speak the
  // §0 reading/heading/gloss type system; unitless/rem/em values carry no hex).
  '--fs-hero': '2.5rem',
  '--fs-h1': '1.875rem',
  '--fs-title': '1.59375rem',
  '--fs-h2': '1.5rem',
  '--fs-card-title': '1.15625rem',
  '--fs-lede': '1.1875rem',
  '--fs-body': '1.0625rem',
  '--fs-small': '0.875rem',
  '--fs-mono': '0.9375rem',
  '--fs-caption': '0.78125rem',
  '--fs-micro': '0.625rem',
  '--ls-display-tight': '-0.015em',
  '--ls-display': '-0.01em',
  '--ls-snug': '-0.005em',
  '--ls-meta': '0.02em',
  '--ls-eyebrow': '0.16em',
  '--ls-eyebrow-wide': '0.2em',
  '--lh-reading': '1.7',
  '--lh-display': '1.06',
  '--lh-heading': '1.18',
  '--lh-gloss': '1.55',
  '--r-sm': '6px',
  '--r-md': '10px',
  '--r-card': '12px',
  '--r-card-lg': '14px',
  '--r-lg': '16px',
  '--r-pill': '999px',
  '--r-kbd': '4px',
  // geometry (lesson-workspace spine/panel/frame metrics)
  '--measure': '33rem',
  '--panel-w': '23rem',
  '--col-gap': 'clamp(1.6rem, 2.6vw, 3.4rem)',
  '--edge-gap': 'clamp(1.6rem, 2.4vw, 3.2rem)',
  '--scrub-w': '1.1rem',
  '--frame-max': '1640px',
  // type families (bind the roles correctly — sans body/chrome, serif headings, mono code).
  // These are deliberately the SELF-CONTAINED stacks: the opaque-origin artifact cannot reference the
  // app's next/font CSS vars (`--font-inter` / `--font-jetbrains-mono` live on the app <html>, outside
  // the sandbox), so the injected `--sans` / `--mono` drop the loaded-font prefix that globals.css
  // leads with and fall straight to the system faces. The value-drift guard in serve.test.ts compares
  // these against globals.css with that loaded-font prefix stripped, so the rest of each stack still
  // stays in lockstep. (`--serif` carries no font var on either side, so it matches verbatim.)
  '--sans': 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  '--serif': '"Iowan Old Style", "Charter", Georgia, "Times New Roman", Times, serif',
  '--mono': '"SF Mono", ui-monospace, "JetBrains Mono", Menlo, monospace',
};

/**
 * The canonical `:root` token block injected into EVERY served artifact at serve time (TS-19).
 * A single FIXED server-side constant — identical bytes for every page, NO interpolation of any
 * `StoredPage`/user field, so nothing attacker-controlled flows into the unescaped `<style>` that
 * runs under `style-src 'unsafe-inline'` (the opaque-origin sandbox is the only backstop — there is
 * no DOMPurify; R12 / revision-8 injection-safety made concrete). Injecting the canonical `:root`
 * at serve time (rather than baking it into each stored artifact) is what lets a future re-theme
 * reach ALREADY-GENERATED lessons: re-theming is a one-place edit here that every served lesson,
 * old and new, picks up on its next load. The artifact itself carries no `:root` block of its own —
 * it references the §0 tokens by name and relies entirely on this serve-time injection to define
 * them (the v11 revert dropped the artifact's inline `var(--token, …)` fallback copy, so this block
 * is now the sole definition site the sandboxed page sees).
 */
export const ARTIFACT_ROOT_STYLE = `<style>:root{${Object.entries(ARTIFACT_ROOT_TOKENS)
  .map(([name, value]) => `${name}:${value};`)
  .join('')}}</style>`;

/**
 * The custom-property names the injected `:root` block defines — exported so `serve.test.ts`'s
 * value-drift guard can iterate them and assert, for the FULL injected set against the resolved
 * `globals.css` `:root` (the §0 source of truth): (a) every injected token NAME exists in
 * `globals.css` (a §0-rename catch) and (b) each value matches the resolved `globals.css` value
 * value-for-value (the one allowed divergence — the `--sans`/`--mono` loaded-font prefix — is
 * normalized away). That guard is what keeps the §0 "two-copies invariant" honest: a retoken that
 * edits `globals.css` but forgets this block is a CI failure here, not a silent old-theme serve.
 */
export const ARTIFACT_ROOT_TOKEN_NAMES: readonly string[] = Object.keys(ARTIFACT_ROOT_TOKENS);

/**
 * Inject the fixed canonical `:root` block at a deterministic anchor in the served HTML. The
 * injection is a deterministic string-anchor transform (no HTML-parser dependency): insert the
 * constant `<style>` immediately after the first `<head …>` open tag; if there is no `<head>`,
 * after the first `<html …>` open tag; if neither exists, prepend it. The result is exactly ONE
 * canonical `:root` block at a single deterministic position, regardless of artifact shape.
 */
function injectRootStyle(html: string): string {
  const headMatch = /<head\b[^>]*>/i.exec(html);
  if (headMatch) {
    const at = headMatch.index + headMatch[0].length;
    return html.slice(0, at) + ARTIFACT_ROOT_STYLE + html.slice(at);
  }
  const htmlMatch = /<html\b[^>]*>/i.exec(html);
  if (htmlMatch) {
    const at = htmlMatch.index + htmlMatch[0].length;
    return html.slice(0, at) + ARTIFACT_ROOT_STYLE + html.slice(at);
  }
  return ARTIFACT_ROOT_STYLE + html;
}

/**
 * Build the sandboxed HTML response for a stored page. 404 when the page is absent or has no
 * HTML (a `soon`/`text` node was never synthesized) — never serve an empty body as a page (and no
 * injection on the not-found path). Pure (takes the already-read page), so it unit-tests with no DB.
 *
 * TS-19: the served HTML carries a serve-time-injected fixed canonical `:root` token block (see
 * `injectRootStyle`/`ARTIFACT_ROOT_STYLE`) so a future re-theme reaches already-generated lessons.
 * The injection is the only output delta — `ARTIFACT_CSP`, the `Content-Security-Policy` header,
 * `X-Content-Type-Options`, and the route's iframe `sandbox` attribute are all byte-unchanged
 * (the trust boundary is untouched — Key-decision 1).
 */
export function artifactResponse(page: StoredPage | null): Response {
  if (!page || page.html === null) {
    return new Response('Artifact not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  return new Response(injectRootStyle(page.html), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': ARTIFACT_CSP,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
