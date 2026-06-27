/**
 * The card→reader morph ROBUSTNESS gate (TS-22, Phase 4 — MOTION).
 *
 * TS-21 declared the happy-path cross-document View-Transition transport (`@view-transition
 * { navigation: auto }` in `globals.css`) that box-FLIPs the `#readerPanel.morph-box` from the
 * library card. That transport is CSS-driven and the browser runs it automatically on a same-origin
 * full-document navigation — there is no `startViewTransition` JS call to gate. TS-22 hardens the
 * three ways that automatic morph can misfire against *this* receiver, each of which must degrade to
 * the SAME clean outcome: an ordinary cross-document navigation that lands on a fully-usable reader.
 *
 *   1. The browser has no cross-document View-Transition API at all      → instant-swap (AC1/AC2).
 *   2. The destination `#readerPanel.morph-box` isn't in the DOM (a       → instant-swap (AC4).
 *      `soon`/`text` degraded lesson renders `.lesson-degraded`, no box).
 *   3. The user prefers reduced motion                                    → instant-swap (AC5).
 *
 * This module is the NODE-TESTABLE decision core (mirroring `reader-message.ts` / `library-card.ts`:
 * pure logic in a `.ts` module, NOT the `.tsx` shell, so it unit-tests under vitest's
 * `environment: 'node'` with no DOM). The reduced-motion + no-API paths are ALSO enforced declaratively
 * in `globals.css` (the `@view-transition` transport is scoped to `prefers-reduced-motion:
 * no-preference`, and an absent at-rule is a no-op on a browser without the API) — that CSS is the
 * primary, JS-free degrade. This module is the reader shell's belt-and-suspenders RECEIVER side: it
 * lets the destination route ACTIVELY confirm its morph-box is ready (or suppress the morph if not),
 * and makes the whole decision a single asserted function rather than three implicit browser behaviors.
 *
 * TRUST BOUNDARY (unchanged — Key-decision 1 / decision 2 / TS-5b verdict): every branch here is a
 * pure decision over container-box readiness + capability + preference. NOTHING in this module reads
 * or mutates the opaque-origin iframe, its `sandbox`, or `ARTIFACT_CSP`; the morph is the
 * `#readerPanel.morph-box` CONTAINER box geometry only, and an instant-swap removes the box's morph
 * participation, never touches the iframe contents.
 */

/** The two clean outcomes every path resolves to: the box morphs, or it instant-swaps (no animation). */
export type MorphDecision = 'morph' | 'instant-swap';

/** The capability + preference + receiver inputs the gate decides over (all caller-supplied, so pure). */
export interface MorphGuardInputs {
  /** Whether the browser exposes the CROSS-DOCUMENT View-Transition API (capability gate — AC1). */
  crossDocViewTransitionsSupported: boolean;
  /** Whether the user prefers reduced motion (`prefers-reduced-motion: reduce` matched — AC5). */
  reducedMotionPreferred: boolean;
  /** Whether the destination `#readerPanel.morph-box` is present/ready in the DOM (receiver — AC3/AC4). */
  destinationBoxPresent: boolean;
}

/**
 * Decide whether the card→reader navigation should run the box-only morph or instant-swap.
 *
 * The morph runs ONLY when all three hold: the API exists, the user has not asked for reduced motion,
 * and the destination box is present. ANY falsy input degrades to a clean instant-swap (AC2/AC4/AC5) —
 * a plain cross-document navigation with no animation, landing on a fully-usable reader. Pure: it reads
 * only its args and returns a verdict; it performs no side effect and never touches the iframe.
 */
export function decideMorph({
  crossDocViewTransitionsSupported,
  reducedMotionPreferred,
  destinationBoxPresent,
}: MorphGuardInputs): MorphDecision {
  if (!crossDocViewTransitionsSupported) return 'instant-swap'; // no API → plain navigation (AC1/AC2).
  if (reducedMotionPreferred) return 'instant-swap'; // honor the preference → no morph (AC5).
  if (!destinationBoxPresent) return 'instant-swap'; // receiver-guarantee: don't pair a missing box (AC4).
  return 'morph'; // all confirmed → the box-only container-transform runs (AC3).
}

/**
 * CAPABILITY GATE (AC1): does this browser support a CROSS-DOCUMENT View-Transition?
 *
 * The cross-document VT is gated on BOTH `document.startViewTransition` existing (the View-Transition
 * API at all) AND the cross-document opt-in surface — the `CSSViewTransitionRule`/`@view-transition`
 * at-rule support, detected via `CSS.supports('view-transition-name', 'none')` (the property a
 * cross-doc-VT-capable engine recognizes). A same-document-only engine (no cross-doc) — or one with no
 * VT at all — reports unsupported, so the caller instant-swaps. Takes the global as an arg (default
 * `globalThis`) so it unit-tests with a stub in `environment: 'node'` where neither global exists.
 */
export function supportsCrossDocumentViewTransitions(
  win: { document?: unknown; CSS?: { supports?: (prop: string, value: string) => boolean } } = globalThis,
): boolean {
  const doc = win.document as { startViewTransition?: unknown } | undefined;
  const hasViewTransitionApi = typeof doc?.startViewTransition === 'function';
  const hasViewTransitionName =
    typeof win.CSS?.supports === 'function' && win.CSS.supports('view-transition-name', 'none');
  return hasViewTransitionApi && hasViewTransitionName;
}

/**
 * PREFERENCE GATE (AC5): does the user prefer reduced motion?
 *
 * `matchMedia('(prefers-reduced-motion: reduce)').matches`. Takes the matcher as an arg (default the
 * global `matchMedia`) so it unit-tests with a stub. Returns `false` when `matchMedia` is unavailable
 * (a non-browser / very old engine) — the conservative default is "no preference set", and the
 * capability gate will still instant-swap such an engine if it also lacks the VT API.
 */
export function prefersReducedMotion(
  matcher: ((query: string) => { matches: boolean }) | undefined = typeof globalThis.matchMedia === 'function'
    ? globalThis.matchMedia.bind(globalThis)
    : undefined,
): boolean {
  if (typeof matcher !== 'function') return false;
  return matcher('(prefers-reduced-motion: reduce)').matches;
}
