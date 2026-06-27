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

  it('keeps the transport OUT of the shell — it lives in globals.css (TS-21 AC7)', () => {
    // The morph's cross-document transport + box-geometry animation belong at the route-level seam
    // (globals.css), NOT the shell. The shell carries ONLY the inline per-id view-transition-name
    // endpoint; a scripted startViewTransition or an inline `@view-transition` rule here would be the
    // transport leaking into the component (the box-only morph is pure route-boundary CSS).
    expect(SHELL).not.toContain('startViewTransition');
    expect(SHELL).not.toContain('@view-transition');
  });

  it('keeps the morph BOX-ONLY: the iframe element is untouched across TS-21 (AC3/AC4)', () => {
    // TS-21 animates ONLY the #readerPanel.morph-box CONTAINER box. The opaque-origin iframe — its
    // sandbox, src, and attributes — must be byte-unchanged; the lesson contents "jump in" at the final
    // frame (the VT spec can't snapshot the cross-origin sandboxed frame anyway). The iframe still
    // carries exactly the opaque-origin sandbox and is driven only by `src={href}` — no new attribute
    // (e.g. an `allow-same-origin`, a `view-transition-name` on the iframe itself) rode in with TS-21.
    expect(SHELL).toContain('sandbox="allow-scripts"');
    expect(SHELL).toContain('src={href}');
    expect(SHELL).not.toMatch(/sandbox="[^"]*allow-same-origin/);
  });

  it('sets the destination view-transition-name INLINE and id-scoped via morphName(id) (TS-20 ↔ TS-17)', () => {
    // The destination name must equal TS-17's per-card origin (`morphName(id)`), so it is set inline
    // from the lesson id — NOT a static `reader-panel` rule that could never pair with a per-card name.
    // (The exact morphName output is value-locked against the card side in reader-morph.test.ts.)
    expect(SHELL).toContain('viewTransitionName: morphName(id)');
  });
});

// The destination name is NOT a static rule in globals.css — it MUST be inline + id-scoped (above), so
// a regression that re-introduces a single global `view-transition-name` (which can't pair with TS-17's
// per-card origin) trips this byte-pin. We assert the prior static name (`reader-panel`) is gone.
//
// TS-21 update: the cross-document View-Transition TRANSPORT + the box-geometry animation are now LANDED
// in globals.css (their TS-21 home — the route-level seam, not the shell). The per-id name stays inline;
// only the route-level transport rule lives in the stylesheet. So this guard keeps forbidding a single
// global `view-transition-name` declaration while ASSERTING the transport rule now exists.
describe('TS-20/TS-21 — the morph transport lives in globals.css; the per-id name stays inline', () => {
  const CSS = readFileSync(fileURLToPath(new URL('../../globals.css', import.meta.url)), 'utf8');

  it('has no static view-transition-name declaration (the name is per-id inline in reader-shell.tsx)', () => {
    // A declaration (a `view-transition-name:` property) — not the explanatory comments — must be absent.
    // A single global name could never pair TS-17's per-card origin with TS-20's per-id destination.
    expect(CSS).not.toMatch(/^\s*view-transition-name\s*:/m);
    // and the specific prior global name must not return
    expect(CSS).not.toContain('reader-panel');
  });

  it('declares the cross-document View-Transition transport (TS-21 AC1)', () => {
    // `@view-transition { navigation: auto }` makes library `/` ↔ reader `/curriculum/[id]` navigations
    // run as a cross-document VT — the routes stay two independent App-Router routes (no SPA shell).
    expect(CSS).toMatch(/@view-transition\s*\{[^}]*navigation\s*:\s*auto/m);
  });

  it('tweens the morph box at the DESIGN.md §0 motion tokens, no literal duration (TS-21 AC5)', () => {
    // The box-geometry animation is keyed to the paired group and consumes `--dur-slow` (440ms) + the
    // single `--ease` — NO literal ms/cubic-bezier in the VT rules that would bypass the §0 tokens.
    const vtGroup = CSS.match(/::view-transition-group\(\*\)\s*\{[^}]*\}/m)?.[0] ?? '';
    expect(vtGroup).toContain('var(--dur-slow)');
    expect(vtGroup).toContain('var(--ease)');
    expect(vtGroup).not.toMatch(/\d+ms/);
    expect(vtGroup).not.toContain('cubic-bezier');
  });

  it('degrades the morph to an instant route change under prefers-reduced-motion (TS-21 AC6)', () => {
    // The VT pseudo-elements are on the `::view-transition` root tree, NOT descendants the universal
    // `*` reduced-motion rule reaches — so the reduced-motion block must zero them explicitly.
    const rm = CSS.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\}/m)?.[0] ?? '';
    expect(rm).toContain('::view-transition-group(*)');
    expect(rm).toMatch(/::view-transition-group\(\*\)[\s\S]*animation-duration:\s*0\.01ms\s*!important/m);
  });
});
