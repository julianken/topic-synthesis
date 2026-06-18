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
].join('; ');

/**
 * Build the sandboxed HTML response for a stored page. 404 when the page is absent or has no
 * HTML (a `soon`/`text` node was never synthesized) — never serve an empty body as a page.
 * Pure (takes the already-read page), so it unit-tests with no DB.
 */
export function artifactResponse(page: StoredPage | null): Response {
  if (!page || page.html === null) {
    return new Response('Artifact not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  return new Response(page.html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': ARTIFACT_CSP,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
