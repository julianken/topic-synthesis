import { describe, expect, it, vi } from 'vitest';
import {
  NEW_SURFACE_NAME,
  prefersReducedMotion,
  runViewTransition,
  SPECIMEN_TOPIC_NAME,
  supportsViewTransitions,
  vtOff,
  type ViewTransitionCapability,
} from './library-morph';

// ── The create-form flow's pure motion gate (mirrors reader-morph-guard.test.ts conventions) ─────────
// The `+New` card ↔ form open/close morphs are SCRIPTED same-document View-Transitions, so unlike the
// CSS-driven card→reader morph they must be gated in JS before the call. The gate (vtOff) + the
// instant-swap floor (runViewTransition) are the node-testable core; the .tsx island wires them. The
// submit handoff is now a CROSS-document route navigation (run-lifecycle #225), gated by the same vtOff.

/** A `win`-shaped capability stub matching the two gate inputs (VT API present, reduced-motion). */
function fakeWin({
  supported,
  reducedMotion,
}: {
  supported: boolean;
  reducedMotion: boolean;
}): ViewTransitionCapability {
  return {
    document: supported ? { startViewTransition: () => {} } : {},
    matchMedia: (_q: string) => ({ matches: reducedMotion }),
  };
}

describe('the value-locked shared view-transition-name constants (no static CSS leak)', () => {
  it('pins the morph endpoint names', () => {
    // The names are JS constants set inline on both endpoints — NEVER a static CSS rule (a single global
    // `view-transition-name` could never pair two per-flow endpoints). page.test.ts guards the CSS leak;
    // these pin the literal values both endpoints share so origin and destination can't silently drift.
    // `specimen-topic` now bridges the CROSS-document create-form → generating morph (run-lifecycle #225):
    // the form's topic text-twin (OLD doc) pairs with the generating view's `#genTopic` header (NEW doc).
    expect(NEW_SURFACE_NAME).toBe('new-surface');
    expect(SPECIMEN_TOPIC_NAME).toBe('specimen-topic');
  });
});

describe('supportsViewTransitions — the capability gate', () => {
  it('reports SUPPORTED when document.startViewTransition is a function', () => {
    expect(supportsViewTransitions({ document: { startViewTransition: () => {} } })).toBe(true);
  });

  it('reports UNSUPPORTED when the View-Transition API is absent', () => {
    expect(supportsViewTransitions({ document: {} })).toBe(false);
  });

  it('reports UNSUPPORTED in a bare environment (no document — the node default)', () => {
    expect(supportsViewTransitions({})).toBe(false);
  });
});

describe('prefersReducedMotion — the preference gate', () => {
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

describe('vtOff — the single scripted-VT gate (capability OR preference → instant-swap)', () => {
  it('runs the morph ONLY when the API exists AND reduced-motion is off', () => {
    expect(vtOff(fakeWin({ supported: true, reducedMotion: false }))).toBe(false);
  });

  it('skips (instant-swap) under prefers-reduced-motion even with the API present', () => {
    expect(vtOff(fakeWin({ supported: true, reducedMotion: true }))).toBe(true);
  });

  it('skips (instant-swap) when the View-Transition API is absent', () => {
    expect(vtOff(fakeWin({ supported: false, reducedMotion: false }))).toBe(true);
  });

  it('skips (instant-swap) when BOTH gates fail', () => {
    expect(vtOff(fakeWin({ supported: false, reducedMotion: true }))).toBe(true);
  });
});

describe('runViewTransition — the instant-swap floor + the morph call path', () => {
  it('REDUCED MOTION: mutates synchronously (instant swap), never calling startViewTransition', async () => {
    // The spec's reduced-motion floor: the swap is INSTANT, no morph, no recede. The update runs
    // synchronously and startViewTransition is never invoked — proving the floor is a real synchronous
    // state mutation, not a zero-duration transition.
    const startViewTransition = vi.fn();
    const update = vi.fn();
    let resolved = false;
    const win = {
      document: { startViewTransition },
      matchMedia: () => ({ matches: true }), // reduced motion ON
    };
    const p = runViewTransition(update, ['open-form'], win).then(() => {
      resolved = true;
    });
    // Synchronous: the update has ALREADY run by the time runViewTransition returned (before the await).
    expect(update).toHaveBeenCalledTimes(1);
    expect(startViewTransition).not.toHaveBeenCalled();
    await p;
    expect(resolved).toBe(true);
  });

  it('NO VT API: mutates synchronously (instant swap) — the capability floor', async () => {
    const update = vi.fn();
    const win = { document: {}, matchMedia: () => ({ matches: false }) };
    await runViewTransition(update, ['open-form'], win);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('MORPH PATH: calls startViewTransition with the typed { update, types } and awaits finished', async () => {
    let captured: { update: () => void; types: string[] } | null = null;
    const startViewTransition = vi.fn((arg: unknown) => {
      captured = arg as { update: () => void; types: string[] };
      captured.update(); // the real API invokes the update callback during the transition
      return { finished: Promise.resolve() };
    });
    const update = vi.fn();
    const win = {
      document: { startViewTransition },
      matchMedia: () => ({ matches: false }), // motion allowed
    };
    await runViewTransition(update, ['open-form'], win);
    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1); // invoked by the API, not synchronously by the floor
    expect(captured!.types).toEqual(['open-form']);
  });

  it('swallows the AbortError a superseded transition rejects with (rapid open→close never throws)', async () => {
    const startViewTransition = vi.fn(() => ({
      finished: Promise.reject(new Error('AbortError: transition was skipped')),
    }));
    const win = {
      document: { startViewTransition },
      matchMedia: () => ({ matches: false }),
    };
    // Must resolve, not reject — a superseded transition is normal, not an error to surface.
    await expect(runViewTransition(() => {}, ['close-form'], win)).resolves.toBeUndefined();
  });

  it('falls back to the positional callback form on an engine without the typed-object overload', async () => {
    // Some engines only accept startViewTransition(updateCallback). The first (object) call throws; the
    // wrapper retries with the positional callback and still runs the update.
    const update = vi.fn();
    let positionalUsed = false;
    const startViewTransition = vi.fn((arg: unknown) => {
      if (typeof arg !== 'function') throw new TypeError('expects a callback');
      positionalUsed = true;
      (arg as () => void)();
      return { finished: Promise.resolve() };
    });
    const win = { document: { startViewTransition }, matchMedia: () => ({ matches: false }) };
    await runViewTransition(update, ['open-form'], win);
    expect(positionalUsed).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
  });
});
