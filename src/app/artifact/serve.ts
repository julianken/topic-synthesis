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
 * (`DESIGN.md ## 0. Token Manifest` — the single source of truth, materialized in `globals.css`
 * by TS-18). This is NOT a second source of truth: it is the artifact-injected copy of the §0
 * manifest (a reconciled value, not a fork — DESIGN.md wins on any design conflict). Every name
 * here is RESOLVED to its final literal (no `var()` indirection), because the artifact runs in an
 * opaque-origin sandbox with no cascade from the parent app's `globals.css`, so the injected block
 * must self-resolve. The set is a SUPERSET of the `var(--token, <fallback>)` names `code.ts` pins
 * as inline fallbacks (asserted in `serve.test.ts`), so a future §0 rename that touches only
 * `globals.css` cannot silently no-op serve-time re-theming.
 *
 * THREE copies of the §0 manifest exist — `globals.css` (the source of truth), `code.ts`'s inline
 * `var()` fallbacks, and this block. A §0 retoken MUST edit all three. `serve.test.ts` guards both
 * failure modes: the NAME-superset (a rename) and a VALUE-drift check that asserts each value here
 * equals the resolved `globals.css` value, so forgetting this copy is a CI failure, not a silent
 * old-theme serve. (DESIGN.md §0 / the Update-Triggers table also flags the all-three-copies rule.)
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
  // geometry (lesson-workspace spine/panel/frame metrics)
  '--measure': '33rem',
  '--panel-w': '23rem',
  '--col-gap': 'clamp(1.6rem, 2.6vw, 3.4rem)',
  '--edge-gap': 'clamp(1.6rem, 2.4vw, 3.2rem)',
  '--scrub-w': '1.1rem',
  '--frame-max': '1640px',
  // type families (bind the roles correctly — sans body/chrome, serif headings, mono code)
  '--sans': 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  '--serif': '"Iowan Old Style", "Charter", "Georgia", serif',
  '--mono': 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace',
};

/**
 * The canonical `:root` token block injected into EVERY served artifact at serve time (TS-19).
 * A single FIXED server-side constant — identical bytes for every page, NO interpolation of any
 * `StoredPage`/user field, so nothing attacker-controlled flows into the unescaped `<style>` that
 * runs under `style-src 'unsafe-inline'` (the opaque-origin sandbox is the only backstop — there is
 * no DOMPurify; R12 / revision-8 injection-safety made concrete). Injecting the canonical `:root`
 * at serve time (rather than baking it into each stored artifact) is what lets a future re-theme
 * reach ALREADY-GENERATED lessons: re-theming is a one-place edit here that every served lesson,
 * old and new, picks up on its next load. The artifact itself stays `:root`-free (forbidden by
 * `code.ts`) and keeps its §0-faithful inline `var()` fallbacks for the no-injection path.
 */
export const ARTIFACT_ROOT_STYLE = `<style>:root{${Object.entries(ARTIFACT_ROOT_TOKENS)
  .map(([name, value]) => `${name}:${value};`)
  .join('')}}</style>`;

/**
 * The custom-property names the injected `:root` block defines — exported so a unit test can
 * statically assert this set is a SUPERSET of the `var(--token, …)` names `code.ts` references
 * (AC10). If a future §0 rename adds a token the artifact references but injection doesn't define,
 * that test fails — serve-time re-theming would otherwise silently no-op for the new token.
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
