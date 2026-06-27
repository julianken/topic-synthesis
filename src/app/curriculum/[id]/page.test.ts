import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// ── TS-13 AC8 / TS-20 AC2 trust-boundary regression pin: the iframe sandbox is unchanged ────────────
// The sandbox attribute is the PRIMARY trust boundary for the generated lesson (more load-bearing than
// the strict CSP `serve.test.ts` already byte-pins): `allow-scripts` WITHOUT `allow-same-origin` gives
// the framed lesson an opaque origin, so it runs its own canvas/SVG scripts but can't reach this app's
// origin/cookies/storage. TS-20 MOVED the iframe element out of `page.tsx`'s `built` branch and into
// the `reader-shell.tsx` client component (the v11 reader shell wraps it in `#readerPanel.morph-box`),
// so the pin now reads the shell — the iframe's new home — keeping the boundary byte-checked on the
// SOURCE the way `run-job.test.ts` pins the Job's no-telemetry contract: a future PR that adds
// `allow-same-origin` (collapsing the sandbox isolation) trips this test. The `.tsx` shell can't mount
// in vitest's `environment: 'node'` (no DOM — the constraint `lesson-message.test.ts` notes), so this
// is a source byte-pin. It mirrors the CSP byte-pin's `.not.toContain('allow-same-origin')` so BOTH
// halves — CSP and sandbox — are pinned.
describe('TS-13 AC8 / TS-20 AC2 — the lesson iframe sandbox stays opaque-origin (no allow-same-origin)', () => {
  const SHELL = readFileSync(fileURLToPath(new URL('./reader-shell.tsx', import.meta.url)), 'utf8');
  const PAGE = readFileSync(fileURLToPath(new URL('./page.tsx', import.meta.url)), 'utf8');

  it('renders the artifact iframe with sandbox="allow-scripts"', () => {
    expect(SHELL).toContain('sandbox="allow-scripts"');
  });

  it('NEVER widens the sandbox with allow-same-origin (the boundary stays opaque-origin)', () => {
    // allow-same-origin would give the framed lesson THIS app's origin — cookies/storage/DOM access —
    // defeating the isolation. The only `allow-same-origin` mentions in these files are the comments
    // that explain its ABSENCE, so the literal that grants it (inside the sandbox attribute) must not
    // appear in either the shell (the iframe's home) or the page (which no longer renders the iframe).
    expect(SHELL).not.toMatch(/sandbox="[^"]*allow-same-origin/);
    expect(PAGE).not.toMatch(/sandbox="[^"]*allow-same-origin/);
  });

  it('wraps the iframe in the #readerPanel.morph-box FLIP destination (TS-20 AC1/AC7)', () => {
    // The card→reader morph's destination box (TS-21 animates it) — id readerPanel + class morph-box.
    expect(SHELL).toContain('id="readerPanel"');
    expect(SHELL).toContain('className="morph-box"');
  });

  it('adds NO @view-transition rule or startViewTransition call here (that is TS-21) (AC7)', () => {
    // TS-20 builds ONLY the FLIP destination box + its view-transition-name anchor; the morph
    // animation lands in TS-21. A stray startViewTransition / @view-transition here would be the
    // animation leaking into the static-shell PR.
    expect(SHELL).not.toContain('startViewTransition');
    expect(SHELL).not.toContain('@view-transition');
  });
});
