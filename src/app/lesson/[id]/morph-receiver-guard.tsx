import { MORPH_RECEIVER_SCRIPT } from './reader-morph-guard';

/**
 * The card→reader morph RECEIVER-GUARANTEE (TS-22, Phase 4 — MOTION).
 *
 * The cross-document View-Transition transport TS-21 declared (`@view-transition { navigation: auto }`)
 * runs automatically on the new (reader) document. The new document fires a `pagereveal` event whose
 * `event.viewTransition` is the active transition BEFORE its snapshot is painted — the one hook a
 * destination route has to confirm it's ready to receive the morph or to cancel it cleanly.
 *
 * REGISTRATION TIMING (fixed per PR #143 review — two passes). `pagereveal` fires on the new document
 * BEFORE its first rendering opportunity. Chrome's cross-document View-Transition guidance is explicit:
 * the listener "must execute before the first rendering opportunity … register the listener in a classic
 * parser-blocking script in the <head> (not a module, not async, not defer)". So this island is a SERVER
 * component that emits a parser-blocking inline `<script>` ({@link MORPH_RECEIVER_SCRIPT}), and it is
 * mounted as a child of the document `<head>` in the root layout (`src/app/layout.tsx`) — not (as the
 * first review-fix pass did) in the reader page's `<main>` body, where a body-positioned script can race
 * the first rendering opportunity and register too LATE to call `skipTransition()` on the box-absent
 * path. A `'use client'` `useEffect` would be later still (it runs only AFTER hydration, after the
 * reader document's own `pagereveal` has already fired); the head-level parser-blocking script registers
 * synchronously as the document parses, so the active receiver-guarantee actually fires for THIS
 * navigation.
 *
 * MOUNT SCOPE. App Router owns `<head>` only in the root layout, so this is mounted SITE-WIDE rather
 * than reader-route-scoped — which is also the correct surface: the `@view-transition` transport in
 * `globals.css` is declared globally, so a cross-doc `pagereveal` can fire on ANY destination route and
 * the handler must already be listening. The handler self-gates by reading the live `#readerPanel`
 * (present only on the built reader branch → morph; absent everywhere else → instant-swap, AC4), so a
 * single prop-less head mount decides correctly on every route.
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
 * This component is mounted ONCE, in the root layout's `<head>` (not per route, not per branch): box
 * presence is read live, so it needs no per-branch prop — the same script makes the correct decision on
 * whichever route/branch rendered.
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
