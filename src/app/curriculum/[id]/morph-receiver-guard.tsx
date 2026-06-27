'use client';

import { useEffect } from 'react';
import { decideMorph, prefersReducedMotion, supportsCrossDocumentViewTransitions } from './reader-morph-guard';

/**
 * The card→reader morph RECEIVER-GUARANTEE (TS-22, Phase 4 — MOTION).
 *
 * The cross-document View-Transition transport TS-21 declared (`@view-transition { navigation: auto }`)
 * runs automatically on the new (reader) document. The new document fires a `pagereveal` event whose
 * `event.viewTransition` is the active transition BEFORE its snapshot is painted — the one hook a
 * destination route has to confirm it's ready to receive the morph or to cancel it cleanly. This island
 * mounts on the reader route in BOTH branches (the `built` reader shell AND the `soon`/`text` degraded
 * state) and, on `pagereveal`, runs the pure {@link decideMorph} gate:
 *
 *   - The destination box (`#readerPanel.morph-box`) is absent on the degraded branch (this component is
 *     told so by `destinationBoxPresent={false}`), so the morph would try to pair a missing endpoint —
 *     the guard calls `viewTransition.skipTransition()` to INSTANT-SWAP instead (AC4).
 *   - The browser lacks the cross-document VT API, or the user prefers reduced motion → instant-swap
 *     (AC1/AC2/AC5). These are ALSO degraded declaratively in `globals.css` (the transport is scoped to
 *     `prefers-reduced-motion: no-preference`, and an unknown at-rule is a no-op without the API); this
 *     guard is the belt-and-suspenders JS confirmation that the receiver decided the SAME way.
 *
 * On the `built` branch (`destinationBoxPresent={true}`) with the API present and no reduced-motion
 * preference, the guard lets the morph run untouched (it does NOT call `skipTransition`).
 *
 * TRUST BOUNDARY (unchanged — decision 2 / TS-5b): the guard decides over the CONTAINER box's presence
 * and the browser's capability/preference only. It NEVER reads or mutates the opaque-origin lesson
 * iframe, its sandbox, or the served artifact CSP; an instant-swap removes the box's morph
 * participation, never the iframe contents. It renders nothing (a behavior-only island).
 */
export function MorphReceiverGuard({ destinationBoxPresent }: { destinationBoxPresent: boolean }) {
  useEffect(() => {
    // `pagereveal` is the new-document hook the cross-document VT exposes; `event.viewTransition` is the
    // active transition (or null when none is running). Typed locally — the DOM lib may not yet ship it.
    function onPageReveal(event: Event) {
      const viewTransition = (event as { viewTransition?: { skipTransition?: () => void } }).viewTransition;
      if (!viewTransition || typeof viewTransition.skipTransition !== 'function') return; // no VT → nothing to skip.

      const decision = decideMorph({
        crossDocViewTransitionsSupported: supportsCrossDocumentViewTransitions(),
        reducedMotionPreferred: prefersReducedMotion(),
        // The receiver confirms its box is actually in the DOM, not just that the branch claims it: the
        // prop says which branch rendered, and we re-check the live DOM so a guarantee, not an assumption.
        destinationBoxPresent: destinationBoxPresent && document.getElementById('readerPanel') !== null,
      });

      // INSTANT-SWAP: cancel the morph's box pairing so the navigation is a clean no-animation swap.
      // The page is already the destination — skipping the transition just drops the geometry tween.
      if (decision === 'instant-swap') viewTransition.skipTransition();
    }

    window.addEventListener('pagereveal', onPageReveal);
    return () => window.removeEventListener('pagereveal', onPageReveal);
  }, [destinationBoxPresent]);

  return null;
}
