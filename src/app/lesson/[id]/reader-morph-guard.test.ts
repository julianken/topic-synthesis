import { describe, expect, it, vi } from 'vitest';
import {
  decideMorph,
  handleReaderPageReveal,
  MORPH_RECEIVER_SCRIPT,
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

// ── TS-22 (PR #143 review fix): the ACTIVE pagereveal handler + its parser-time registration ──────────
// The first review caught that the receiver-guarantee deterministically never fired: the listener was
// registered in a `useEffect` (post-hydration), but `pagereveal` fires on the new document BEFORE the
// first rendering opportunity — so the effect attached too late and `skipTransition()` was never called
// for the navigation that loaded the page. The fix registers the handler synchronously from a parser-time
// inline script. These tests exercise the ACTUAL handler body (not just a source byte-pin): given a
// synthetic `pagereveal` event + DOM/capability/preference stubs, does it call `skipTransition`?

/** Build a `win`-shaped stub matching the three gate inputs (capability, reduced-motion, box presence). */
function fakeWin({
  supported,
  reducedMotion,
  boxPresent,
}: {
  supported: boolean;
  reducedMotion: boolean;
  boxPresent: boolean;
}) {
  return {
    document: {
      // capability: the VT API is present only when `supported`
      startViewTransition: supported ? () => {} : undefined,
      // receiver: getElementById returns a node only when the box is present
      getElementById: (id: string) => (id === 'readerPanel' && boxPresent ? {} : null),
    },
    // capability: view-transition-name support tracks `supported`
    CSS: { supports: (prop: string) => supported && prop === 'view-transition-name' },
    // preference: matchMedia reports the reduce match per `reducedMotion`
    matchMedia: (_q: string) => ({ matches: reducedMotion }),
  };
}

describe('handleReaderPageReveal — the ACTIVE receiver-guarantee fires on the real event (AC4)', () => {
  it('SKIPS the transition on the degraded box-absent path — the active AC4 guarantee that was the bug', () => {
    // The regression the review caught: a degraded `soon`/`text` reader (no `#readerPanel` box) must
    // instant-swap. With the handler now invoked at parse time, a real event with the box absent DOES
    // call skipTransition — the thing the useEffect-registered listener could never do in time.
    const skipTransition = vi.fn();
    handleReaderPageReveal(
      { viewTransition: { skipTransition } },
      fakeWin({ supported: true, reducedMotion: false, boxPresent: false }),
    );
    expect(skipTransition).toHaveBeenCalledTimes(1);
  });

  it('does NOT skip on the happy path (API present, no reduced motion, box live) → the morph runs (AC3)', () => {
    const skipTransition = vi.fn();
    handleReaderPageReveal(
      { viewTransition: { skipTransition } },
      fakeWin({ supported: true, reducedMotion: false, boxPresent: true }),
    );
    expect(skipTransition).not.toHaveBeenCalled();
  });

  it('SKIPS under prefers-reduced-motion even with the box present (AC5)', () => {
    const skipTransition = vi.fn();
    handleReaderPageReveal(
      { viewTransition: { skipTransition } },
      fakeWin({ supported: true, reducedMotion: true, boxPresent: true }),
    );
    expect(skipTransition).toHaveBeenCalledTimes(1);
  });

  it('SKIPS when the cross-doc VT API is unsupported (AC1/AC2)', () => {
    const skipTransition = vi.fn();
    handleReaderPageReveal(
      { viewTransition: { skipTransition } },
      fakeWin({ supported: false, reducedMotion: false, boxPresent: true }),
    );
    expect(skipTransition).toHaveBeenCalledTimes(1);
  });

  it('no-ops when there is no active viewTransition on the event (nothing to skip)', () => {
    // An event with no `viewTransition` (a plain navigation the engine ran without a VT) must not throw
    // and must not try to skip — there is no transition to cancel.
    expect(() =>
      handleReaderPageReveal({ viewTransition: null }, fakeWin({ supported: true, reducedMotion: false, boxPresent: false })),
    ).not.toThrow();
    expect(() =>
      handleReaderPageReveal({}, fakeWin({ supported: true, reducedMotion: false, boxPresent: false })),
    ).not.toThrow();
  });

  it('matches decideMorph across ALL eight gate permutations — the inlined logic cannot drift', () => {
    // The handler inlines decideMorph's rule (a head-time script can't import the module). Exhaust the
    // 2^3 input space and assert the handler skips IFF decideMorph says 'instant-swap' — so the shipped
    // active guarantee stays identical to the unit-tested pure core.
    for (const supported of [true, false]) {
      for (const reducedMotion of [true, false]) {
        for (const boxPresent of [true, false]) {
          const decision = decideMorph({
            crossDocViewTransitionsSupported: supported,
            reducedMotionPreferred: reducedMotion,
            destinationBoxPresent: boxPresent,
          });
          const skipTransition = vi.fn();
          handleReaderPageReveal(
            { viewTransition: { skipTransition } },
            fakeWin({ supported, reducedMotion, boxPresent }),
          );
          expect(skipTransition.mock.calls.length).toBe(decision === 'instant-swap' ? 1 : 0);
        }
      }
    }
  });
});

describe('MORPH_RECEIVER_SCRIPT — the parser-time registration the guard inlines', () => {
  it('registers the handler for `pagereveal` (the parse-time hook, NOT a post-hydration effect)', () => {
    expect(MORPH_RECEIVER_SCRIPT).toContain("addEventListener('pagereveal'");
  });

  it('serializes the SAME handler that the unit tests exercise (no string/function drift)', () => {
    // The script interpolates handleReaderPageReveal.toString(), so the shipped script body and the
    // tested function are byte-identical by construction — assert the serialized source is present.
    expect(MORPH_RECEIVER_SCRIPT).toContain(handleReaderPageReveal.toString());
  });

  it('calls skipTransition and never touches the iframe boundary (box-only; AC6/AC7)', () => {
    expect(MORPH_RECEIVER_SCRIPT).toContain('skipTransition');
    expect(MORPH_RECEIVER_SCRIPT).not.toContain('contentWindow');
    expect(MORPH_RECEIVER_SCRIPT).not.toContain('allow-same-origin');
  });
});
