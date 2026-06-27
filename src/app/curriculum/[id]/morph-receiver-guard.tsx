import { MORPH_RECEIVER_SCRIPT } from './reader-morph-guard';

/**
 * The card→reader morph RECEIVER-GUARANTEE (TS-22, Phase 4 — MOTION).
 *
 * The cross-document View-Transition transport TS-21 declared (`@view-transition { navigation: auto }`)
 * runs automatically on the new (reader) document. The new document fires a `pagereveal` event whose
 * `event.viewTransition` is the active transition BEFORE its snapshot is painted — the one hook a
 * destination route has to confirm it's ready to receive the morph or to cancel it cleanly.
 *
 * REGISTRATION TIMING (fixed per PR #143 review). `pagereveal` fires on the new document BEFORE its
 * first rendering opportunity (spec-equivalent to a `requestAnimationFrame` queued from the document
 * `<head>`), so a listener must be attached during HTML PARSE to catch it. A `'use client'` `useEffect`
 * runs only AFTER hydration — after the reader document's own `pagereveal` has already fired — so it
 * would deterministically MISS the navigation that loaded the page and never call `skipTransition()` in
 * time. So this island is a SERVER component that emits a parser-time inline `<script>`
 * ({@link MORPH_RECEIVER_SCRIPT}): it registers the listener synchronously as the reader document
 * parses, before hydration, so the active receiver-guarantee actually fires for THIS navigation.
 *
 * The handler ({@link handleReaderPageReveal}, inlined into that script) runs the morph gate on
 * `pagereveal`, reading the destination box from the LIVE DOM (`document.getElementById('readerPanel')`)
 * — so it is a genuine guarantee on either reader branch, not a branch's claim:
 *
 *   - The destination box (`#readerPanel.morph-box`) is absent on the degraded `soon`/`text` branch, so
 *     the morph would try to pair a missing endpoint — the handler calls `viewTransition.skipTransition()`
 *     to INSTANT-SWAP instead (AC4).
 *   - The browser lacks the cross-document VT API, or the user prefers reduced motion → instant-swap
 *     (AC1/AC2/AC5). These are ALSO degraded declaratively in `globals.css` (the transport is scoped to
 *     `prefers-reduced-motion: no-preference`, and an unknown at-rule is a no-op without the API); this
 *     script is the belt-and-suspenders JS confirmation that the receiver decided the SAME way.
 *
 * On the `built` branch (box present) with the API present and no reduced-motion preference, the handler
 * lets the morph run untouched (it does NOT call `skipTransition`).
 *
 * This component is mounted ONCE on the reader route (not per branch): box presence is read live, so it
 * needs no per-branch prop — the same script makes the correct decision on whichever branch rendered.
 *
 * TRUST BOUNDARY (unchanged — decision 2 / TS-5b): the guard decides over the CONTAINER box's presence
 * and the browser's capability/preference only. It NEVER reads or mutates the opaque-origin lesson
 * iframe, its sandbox, or the served artifact CSP; an instant-swap removes the box's morph
 * participation, never the iframe contents. It renders only a behavior-only inline script.
 *
 * The inline script's source is a compile-time constant built from a stringified local function — it
 * contains NO request data and never reflects untrusted input, so `dangerouslySetInnerHTML` here is the
 * standard safe parser-time-script pattern, not an injection surface.
 */
export function MorphReceiverGuard() {
  return <script dangerouslySetInnerHTML={{ __html: MORPH_RECEIVER_SCRIPT }} />;
}
