import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { runViewTransition } from './library-morph';

// ── The create-form flow's contract + no-leak guards (the library `/` create flow) ───────────────────
// The library home was rebuilt into a LIBRARY + CREATE island: the four intake fields + the POST contract
// are PRESERVED verbatim from the prior intake-form.tsx; only the framing + motion changed. These guards
// pin the three load-bearing invariants the spec calls out:
//   (a) the four fields + the EXACT POST /api/generate body shape are unchanged;
//   (b) no static `view-transition-name` leaks into globals.css (the morph names are inline/JS);
//   (c) the reduced-motion / no-VT path mutates state SYNCHRONOUSLY (an instant swap, no morph).
// The .tsx island can't mount under vitest's `environment: 'node'` (no DOM — the constraint
// library-card.test.ts / lesson-message.test.ts note), so (a)/(b) are source byte-pins and (c) exercises
// the pure motion helper the island calls.

const ISLAND = readFileSync(fileURLToPath(new URL('./library-create.tsx', import.meta.url)), 'utf8');
const CSS = readFileSync(fileURLToPath(new URL('./globals.css', import.meta.url)), 'utf8');

describe('create-form flow — the four fields + the POST contract are UNCHANGED', () => {
  it('keeps all four controlled fields: topic, level, depth (1..5 slider), optional audience', () => {
    // Topic input + its placeholder.
    expect(ISLAND).toContain('placeholder="e.g. Fourier transforms"');
    // Level select with the three canonical options.
    expect(ISLAND).toContain('<option value="intro">Intro</option>');
    expect(ISLAND).toContain('<option value="intermediate">Intermediate</option>');
    expect(ISLAND).toContain('<option value="advanced">Advanced</option>');
    // Depth range slider 1..5.
    expect(ISLAND).toMatch(/type="range"\s+min=\{1\}\s+max=\{5\}/);
    // Optional audience input + its placeholder.
    expect(ISLAND).toContain('placeholder="e.g. self-taught dev"');
  });

  it('defaults level to "intermediate" and depth to 3 (unchanged)', () => {
    expect(ISLAND).toContain("useState('intermediate')");
    expect(ISLAND).toContain('useState(3)');
  });

  it('POSTs /api/generate with the EXACT four-key trimmed body shape, surfacing the status on !ok', () => {
    // The submit contract — byte-identical to the prior intake-form.tsx: POST /api/generate with
    // { topic: topic.trim(), level, depth, audience: audience.trim() }; !ok → the `(status)` error text.
    expect(ISLAND).toContain("fetch('/api/generate'");
    expect(ISLAND).toContain("method: 'POST'");
    expect(ISLAND).toContain(
      'JSON.stringify({ topic: topic.trim(), level, depth, audience: audience.trim() })',
    );
    expect(ISLAND).toContain('`Generation request failed (${res.status}).`');
  });

  it('reads the 202 body as { id } and NAVIGATES cross-document to /lesson/[id] (run-lifecycle #225)', () => {
    expect(ISLAND).toContain('as { id: string }');
    // The consolidated flow NAVIGATES to the single generating screen with a FULL cross-document
    // navigation (`window.location.assign`, NOT router.push — a soft client-side nav would never fire the
    // cross-doc `@view-transition` transport or the pagereveal receiver guard; the same reason the
    // card→reader link is a plain <a>).
    expect(ISLAND).toContain('window.location.assign');
    expect(ISLAND).toContain('/lesson/${encodeURIComponent(id)}');
  });

  it('consolidates to ONE generating screen — the in-place shell is GONE (AC1/AC2)', () => {
    // AC2: the in-place `<GeneratingView>` consumer is removed from this island — exactly one consumer
    // remains, the /lesson/[id] route's generating.tsx. AC1: no runId state, no status poll, no
    // router.replace-on-ready. These source byte-pins keep the divergence class from creeping back.
    expect(ISLAND).not.toContain('GeneratingView');
    expect(ISLAND).not.toContain('setRunId');
    expect(ISLAND).not.toContain('router.replace');
    expect(ISLAND).not.toContain('useRouter');
    expect(ISLAND).not.toContain('/status'); // no in-place status poll
  });

  it('guards submit on a non-empty topic + not-already-submitting (unchanged validation)', () => {
    expect(ISLAND).toContain('if (!topic.trim() || submitting) return;');
    // The Generate button is disabled while submitting or the topic is blank, label toggles Generating….
    expect(ISLAND).toContain('disabled={submitting || !topic.trim()}');
    expect(ISLAND).toContain("submitting ? 'Generating…' : 'Generate'");
  });
});

describe('create-form flow — no static view-transition-name leaks into CSS (names are inline/JS)', () => {
  it('globals.css declares NO `view-transition-name:` property (every name is inline in the TSX)', () => {
    // A static global name could never pair the per-flow endpoints (the +New card ↔ form, the topic
    // text ↔ the generating header) — those names are set inline in library-create.tsx + are the
    // value-locked constants in library-morph.ts. The CSS keys only the typed groups by pseudo-element.
    expect(CSS).not.toMatch(/^\s*view-transition-name\s*:/m);
  });

  it('the morph names live as JS constants in library-morph.ts, set inline in the island', () => {
    // The island imports the constants + sets them via `viewTransitionName: NEW_SURFACE_NAME` /
    // `SPECIMEN_TOPIC_NAME` inline styles — never a CSS rule.
    expect(ISLAND).toContain("from './library-morph'");
    expect(ISLAND).toContain('viewTransitionName: NEW_SURFACE_NAME');
    expect(ISLAND).toContain('viewTransitionName: SPECIMEN_TOPIC_NAME');
  });

  it('the VT choreography is keyed by pseudo-element group, not a static name (additive)', () => {
    // The CSS keys the morphs by `::view-transition-group(.morph-box)` (the +New card ↔ form box) +
    // `(specimen-topic)` (the cross-document create-form → generating topic morph, run-lifecycle #225) —
    // declarative selectors over the inline names, NO `view-transition-name:` property and NO new §0 token.
    expect(CSS).toContain('::view-transition-group(.morph-box)');
    expect(CSS).toContain('::view-transition-group(specimen-topic)');
    // The prior same-document submit recede (`begin-generate` type + `vt-recede` keyframe) is RETIRED with
    // the in-place shell — the submit handoff is now a cross-document route change, so no orphaned rule.
    expect(CSS).not.toContain('begin-generate');
    expect(CSS).not.toContain('vt-recede');
  });
});

describe('create-form flow — the reduced-motion / no-VT path mutates state SYNCHRONOUSLY (instant swap)', () => {
  it('runs the update synchronously and never starts a View-Transition under prefers-reduced-motion', async () => {
    // The reduced-motion floor the spec requires: every scripted startViewTransition is gated by vtOff
    // (reduced motion OR no VT API), and on a fail the swap is an instant SYNCHRONOUS state mutation —
    // no morph, no recede. This exercises the exact helper the island's openForm/closeForm/submit call.
    const startViewTransition = vi.fn();
    const update = vi.fn();
    const win = {
      document: { startViewTransition },
      matchMedia: () => ({ matches: true }), // prefers-reduced-motion: reduce
    };
    runViewTransition(update, ['open-form'], win);
    // Synchronous: the state mutation ran during the call, BEFORE any await — and the morph never started.
    expect(update).toHaveBeenCalledTimes(1);
    expect(startViewTransition).not.toHaveBeenCalled();
  });

  it('also mutates synchronously when the browser has no View-Transition API (capability floor)', () => {
    const update = vi.fn();
    const win = { document: {}, matchMedia: () => ({ matches: false }) };
    runViewTransition(update, ['open-form'], win);
    expect(update).toHaveBeenCalledTimes(1);
  });
});
