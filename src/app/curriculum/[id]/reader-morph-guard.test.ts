import { describe, expect, it } from 'vitest';
import {
  decideMorph,
  prefersReducedMotion,
  supportsCrossDocumentViewTransitions,
  type MorphGuardInputs,
} from './reader-morph-guard';

// ── TS-22: the card→reader morph robustness gate ───────────────────────────────────────────────────
// The cross-document View-Transition transport is CSS-driven and the browser runs it automatically;
// there is no `startViewTransition` JS call to gate. The robustness lives in (1) a capability gate,
// (2) a receiver-guarantee (the destination box must be present), and (3) a reduced-motion path — all
// resolving to ONE clean outcome: morph, or a no-animation instant-swap. This is the node-testable core
// (pure logic in a `.ts` module, mirroring reader-message.test.ts / reader-morph.test.ts conventions).

// The all-confirmed baseline (the only `'morph'` case): API present, no reduced motion, box ready.
const MORPH_READY: MorphGuardInputs = {
  crossDocViewTransitionsSupported: true,
  reducedMotionPreferred: false,
  destinationBoxPresent: true,
};

describe('decideMorph — the three-way robustness gate (AC1/AC3/AC4/AC5)', () => {
  it('morphs ONLY when the API exists, reduced-motion is off, and the destination box is present (AC3)', () => {
    expect(decideMorph(MORPH_READY)).toBe('morph');
  });

  it('AC1/AC2 — no cross-document View-Transition API → instant-swap (a clean navigation)', () => {
    expect(decideMorph({ ...MORPH_READY, crossDocViewTransitionsSupported: false })).toBe('instant-swap');
  });

  it('AC4 — destination box absent (a degraded soon/text lesson) → instant-swap (no missing-endpoint pair)', () => {
    expect(decideMorph({ ...MORPH_READY, destinationBoxPresent: false })).toBe('instant-swap');
  });

  it('AC5 — prefers-reduced-motion → instant-swap (no morph)', () => {
    expect(decideMorph({ ...MORPH_READY, reducedMotionPreferred: true })).toBe('instant-swap');
  });

  it('any single falsy capability degrades — the morph is gated on ALL three holding', () => {
    // Exhaust the three single-falsy permutations; each must instant-swap, none may morph.
    const singleFalsy: MorphGuardInputs[] = [
      { ...MORPH_READY, crossDocViewTransitionsSupported: false },
      { ...MORPH_READY, reducedMotionPreferred: true },
      { ...MORPH_READY, destinationBoxPresent: false },
    ];
    for (const inputs of singleFalsy) expect(decideMorph(inputs)).toBe('instant-swap');
    // and the all-false floor also instant-swaps (never a half-applied transition)
    expect(
      decideMorph({
        crossDocViewTransitionsSupported: false,
        reducedMotionPreferred: true,
        destinationBoxPresent: false,
      }),
    ).toBe('instant-swap');
  });
});

describe('supportsCrossDocumentViewTransitions — the capability gate (AC1)', () => {
  it('reports SUPPORTED when both the VT API and view-transition-name property exist', () => {
    const win = {
      document: { startViewTransition: () => {} },
      CSS: { supports: (prop: string) => prop === 'view-transition-name' },
    };
    expect(supportsCrossDocumentViewTransitions(win)).toBe(true);
  });

  it('reports UNSUPPORTED when the View-Transition API is absent (→ instant-swap)', () => {
    const win = { document: {}, CSS: { supports: () => true } };
    expect(supportsCrossDocumentViewTransitions(win)).toBe(false);
  });

  it('reports UNSUPPORTED when the engine does not recognize view-transition-name (same-doc-only / no VT)', () => {
    const win = { document: { startViewTransition: () => {} }, CSS: { supports: () => false } };
    expect(supportsCrossDocumentViewTransitions(win)).toBe(false);
  });

  it('reports UNSUPPORTED in a bare environment (no document, no CSS — the node default)', () => {
    expect(supportsCrossDocumentViewTransitions({})).toBe(false);
  });
});

describe('prefersReducedMotion — the preference gate (AC5)', () => {
  it('is TRUE when matchMedia reports the reduce preference matches', () => {
    expect(prefersReducedMotion(() => ({ matches: true }))).toBe(true);
  });

  it('is FALSE when matchMedia reports no match', () => {
    expect(prefersReducedMotion(() => ({ matches: false }))).toBe(false);
  });

  it('queries the canonical prefers-reduced-motion: reduce media feature', () => {
    let asked = '';
    prefersReducedMotion((query) => {
      asked = query;
      return { matches: false };
    });
    expect(asked).toBe('(prefers-reduced-motion: reduce)');
  });

  it('defaults to FALSE (no preference set) when matchMedia is unavailable', () => {
    expect(prefersReducedMotion(undefined)).toBe(false);
  });
});
