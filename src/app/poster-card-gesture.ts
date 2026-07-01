/**
 * Pure, I/O-free decision logic for the poster card's `<li onClick>` handler (issue #203 review fix) —
 * mirrors the `library-selection.ts` convention of keeping easy-to-get-wrong interaction logic in a plain
 * `.ts` module so it unit-tests under vitest's `environment: 'node'` with no DOM, no timers, no pointer
 * events (`poster-card-gesture.test.ts`).
 *
 * The bug this guards against: touch long-press-to-select (`poster-card.tsx`'s 500ms `onPointerDown`
 * timer) fires `enterSelectionMode()` + `toggleSelected(lessonId)` — but the browser STILL dispatches a
 * synthetic `click` on the matching `pointerup` (a stationary tap-and-hold-then-release still yields a
 * click; long press duration alone doesn't suppress it). That trailing click re-enters `<li onClick>` —
 * now that `selectionMode` is true — and takes the pointer whole-card-toggle branch, immediately
 * DESELECTING the card the long-press just selected. `decideCardClick` centralizes the click decision so
 * the fix is exercised by a plain unit test instead of only eyeballed pointer-event flow.
 */

export type CardClickAction = 'toggle' | 'ignore';

export interface CardClickInput {
  /** Whether the library is currently in selection mode. */
  selectionMode: boolean;
  /** Whether the click originated on the per-card checkbox (`.library-poster__select`). */
  fromCheckbox: boolean;
  /** The native click event's `detail` — 0 for a non-pointer (keyboard) activation. */
  detail: number;
  /** Whether a long-press fired on this card since the last click was decided (`poster-card.tsx`'s
   *  `longPressFiredRef`) — the browser's trailing synthetic click after that fire must be swallowed. */
  longPressFired: boolean;
}

/**
 * Decide what a poster card's `<li onClick>` should do with a click event.
 *
 * A fired long-press ALWAYS swallows the click — checked FIRST, ahead of the pre-existing
 * selection-mode/checkbox/detail branches — because the long-press itself already performed the toggle;
 * this click is the browser's own trailing follow-up, not a second user gesture, regardless of how
 * selection mode was entered or where on the card the pointer happened to land.
 */
export function decideCardClick(input: CardClickInput): CardClickAction {
  if (input.longPressFired) return 'ignore';
  if (!input.selectionMode) return 'ignore';
  // A click that ORIGINATED on the checkbox — mouse OR keyboard Space/Enter on the focused
  // `role="checkbox"` button — always toggles (AC4): the checkbox itself carries no onClick, so its click
  // bubbles here, and Space/Enter activation also yields `detail === 0` (same as the anchor's own keyboard
  // activation below), so it must be distinguished by TARGET, not detail.
  if (input.fromCheckbox) return 'toggle';
  // Whole-card click-to-toggle (AC5) is POINTER-only: a keyboard-activated click on the anchor itself
  // (Enter) carries `detail === 0` and is left alone so the anchor's own keyboard behavior (Enter
  // navigates) never changes — the binding constraint on the inner `<a>`.
  if (input.detail !== 0) return 'toggle';
  return 'ignore';
}
