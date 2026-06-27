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

/**
 * The `pagereveal` HANDLER body (TS-22 — the ACTIVE receiver-guarantee, fixed per PR #143 review).
 *
 * WHY THIS IS NOT A `useEffect`. The cross-document View-Transition's `pagereveal` event fires on the
 * NEW (reader) document BEFORE its first rendering opportunity — per the spec it is equivalent to a
 * `requestAnimationFrame` queued from the document `<head>`, so a listener must be attached during HTML
 * PARSE to catch it. A `'use client'` `useEffect` runs only after the deferred hydration bundle loads
 * and React mounts — i.e. AFTER the reader document's own `pagereveal` has already fired — so an
 * effect-registered listener deterministically MISSES the navigation that loaded the page and never
 * calls `skipTransition()` in time. This handler is therefore registered SYNCHRONOUSLY from a
 * parser-time inline `<script>` (see {@link MORPH_RECEIVER_SCRIPT}), not an effect.
 *
 * It is a self-contained function (no closure over module scope) so its `.toString()` source can be
 * inlined verbatim into that script AND unit-tested directly — the test exercises the SAME function
 * whose source ships, so the wiring (not just the {@link decideMorph} decision) is pinned and the two
 * cannot drift. Its gate mirrors `decideMorph` (capability → reduced-motion → box presence; `reader-
 * morph-guard.test.ts` pins them identical), inlined because a head-time script cannot import modules.
 *
 * It reads the destination box from the LIVE DOM (`document.getElementById('readerPanel')`) rather than
 * a React-supplied branch claim, so it is a genuine receiver-guarantee on EITHER reader branch: the
 * `built` shell renders `#readerPanel` (→ morph), the degraded `soon`/`text` state does not (→ skip,
 * AC4). Box-only per the TS-5b verdict: it calls the VT's own `skipTransition()` to drop the geometry
 * tween; it NEVER reads or mutates the opaque-origin iframe, its sandbox, or `ARTIFACT_CSP`.
 */
export function handleReaderPageReveal(
  event: { viewTransition?: { skipTransition?: () => void } | null },
  win: {
    document?: { getElementById?: (id: string) => unknown; startViewTransition?: unknown } | undefined;
    CSS?: { supports?: (prop: string, value: string) => boolean };
    matchMedia?: (query: string) => { matches: boolean };
  },
): void {
  const viewTransition = event && event.viewTransition;
  if (!viewTransition || typeof viewTransition.skipTransition !== 'function') return; // no VT → nothing to skip.

  const doc = win.document;
  // Capability gate (AC1): the cross-document VT needs BOTH the VT API and view-transition-name support.
  const supported =
    typeof (doc as { startViewTransition?: unknown } | undefined)?.startViewTransition === 'function' &&
    typeof win.CSS?.supports === 'function' &&
    win.CSS.supports('view-transition-name', 'none');
  // Preference gate (AC5): honor prefers-reduced-motion: reduce (false when matchMedia is unavailable).
  const reducedMotion = typeof win.matchMedia === 'function' && win.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Receiver gate (AC4): the destination box must actually be in the LIVE DOM — not a branch's claim.
  const boxPresent = typeof doc?.getElementById === 'function' && doc.getElementById('readerPanel') !== null;

  // Same rule as decideMorph (pinned identical in the tests): morph only when ALL three hold; any falsy
  // input → instant-swap. INSTANT-SWAP cancels the morph's box pairing so the navigation is a clean
  // no-animation swap — the page is already the destination, we just drop the geometry tween (AC2/4/5).
  if (!supported || reducedMotion || !boxPresent) viewTransition.skipTransition();
}

/**
 * The parser-time inline-script SOURCE that registers {@link handleReaderPageReveal} for `pagereveal`.
 *
 * Rendered as `<script dangerouslySetInnerHTML={{ __html: MORPH_RECEIVER_SCRIPT }} />` as a child of the
 * document `<head>` in the root layout (a classic parser-blocking script, per Chrome's cross-document
 * View-Transition guidance), this executes during the document's HTML PARSE — before hydration and
 * before the first rendering opportunity — so the `pagereveal` listener is attached in time to actually
 * call `skipTransition()` on the box-absent degraded path (the active AC4 guarantee a `useEffect`, or a
 * body-positioned script, could never reliably deliver). The handler's source is interpolated via
 * `.toString()`, so the shipped script and the unit-tested function are byte-identical by construction.
 * The string contains only this code (no untrusted interpolation), so it is safe inline JS — it never
 * reflects request data into the page.
 */
export const MORPH_RECEIVER_SCRIPT = `(function(){var h=${handleReaderPageReveal.toString()};window.addEventListener('pagereveal',function(e){h(e,window);});})();`;
