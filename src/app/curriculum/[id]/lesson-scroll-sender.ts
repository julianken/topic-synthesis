/**
 * The PARENT→CHILD coordinate-only SENDER (lesson-workspace PR-C — the scrub-rail section jump).
 *
 * This is the OUTBOUND counterpart to `lesson-message.ts` (the parent RECEIVE side for the child→parent
 * `lesson:progress` channel). When the reader chrome's scrubber dot is activated, the chrome must ask the
 * lesson to scroll to a section. Because the lesson runs in an OPAQUE-ORIGIN sandbox (`sandbox=
 * "allow-scripts"` WITHOUT `allow-same-origin`), the chrome CANNOT reach into the iframe DOM to scroll it
 * — the ONLY legal channel is a coordinate-only `postMessage` INTO the frame.
 *
 * WIRE REALITY (the honest target-origin model — do NOT read this as "never `'*'`"): on Chromium EVERY real
 * jump crosses the boundary with targetOrigin `'*'`. The documented intent is to target the iframe's opaque
 * origin by its literal `"null"` token, but Chromium REJECTS `'null'` as a target origin for an opaque-
 * origin frame (`SyntaxError: Invalid target origin 'null'` — an opaque origin has no URL representation),
 * so the first attempt ALWAYS throws and the `catch` falls back to `'*'`. The `'null'` attempt is kept as
 * forward-compat (it would be honored the moment any engine accepts it), NOT a runtime guarantee. The `'*'`
 * that actually ships is SAFE here: the target is our own non-navigable `sandbox="allow-scripts"` artifact
 * (NO `allow-same-origin`, NO top/frame navigation) under a strict CSP, so there is no foreign-origin frame
 * for `'*'` to leak to — the leak `'*'` normally guards against (a frame that became someone else's origin)
 * cannot arise.
 *
 * COORDINATE-ONLY (the non-negotiable trust boundary): the payload is `{ type: 'lesson:scrollTo', id }`
 * — a discriminant + a section id string the chrome already holds (it was posted OUT by the lesson over
 * the validated `lesson:progress` channel, rebuilt as a plain string by `validateMessage`). NO HTML, NO
 * URL, NO executable content, NO DOM reach. This helper posts the message and returns — it never reads a
 * reply, never touches `contentDocument`.
 *
 * BEST-EFFORT (PR-C is the SENDER, PR-F is the receiver): the message is posted whether or not the lesson
 * yet knows how to ACT on it. A lesson whose in-iframe script does not (yet) listen for `lesson:scrollTo`
 * simply ignores it — no error, no scroll. The scroll LANDS once PR-F teaches the generated lesson to
 * receive this verb. Until then, posting is harmless and inert (the iframe's sandbox + CSP are unchanged).
 *
 * TARGET ORIGIN — the documented opaque token first, then the platform-forced `'*'` that actually ships.
 * The intent (pinned in `lesson-message.ts` `PARENT_TO_CHILD_TARGET_ORIGIN = 'null'`) is to target the
 * iframe's opaque origin by its literal `"null"` token. In practice the browser's `postMessage` REJECTS
 * the literal string `'null'` as a target origin (`SyntaxError: Invalid target origin 'null'` — it parses
 * targetOrigin as a URL, and an opaque origin has NO URL representation), so a specific-origin post to an
 * opaque-origin sandbox is IMPOSSIBLE at the platform level — the first attempt always throws on Chromium
 * and the message ships on the `'*'` fallback. We TRY the documented token first as forward-compat (the
 * code honors the intent the moment any engine accepts it) and FALL BACK to `'*'` on that SyntaxError. The
 * `'*'` is safe HERE (see WIRE REALITY above): the target is our own non-navigable `sandbox="allow-scripts"`
 * artifact under a strict CSP — there is no foreign-origin frame for `'*'` to leak to.
 *
 * PURE-ish + node-testable: the message-BUILDING is a pure function (`buildScrollToMessage`) so the exact
 * payload shape can be unit-tested without a DOM; `postScrollTo` is the thin DOM-edge wrapper that targets
 * a contentWindow (guarded for a null window — a not-yet-loaded iframe). It imports the target-origin
 * constant from `lesson-message.ts` so the single rule lives in one place; it does NOT modify that file
 * (the RECEIVER for the inbound `lesson:progress` shape stays byte-unchanged).
 */

import { PARENT_TO_CHILD_TARGET_ORIGIN } from './lesson-message';

/** The parent→child section-jump discriminant. The lesson's PR-F receiver matches this exact literal. */
export const LESSON_SCROLL_TO_TYPE = 'lesson:scrollTo' as const;

/** The coordinate-only parent→child message: a discriminant + the target section's posted id. */
export interface LessonScrollToMessage {
  type: typeof LESSON_SCROLL_TO_TYPE;
  /** The destination section's id — a plain string the chrome already holds from the inbound channel. */
  id: string;
}

/**
 * Build the coordinate-only `lesson:scrollTo` payload. PURE: returns a fresh object carrying ONLY the
 * discriminant + the id string — never any extra field, never anything executable. Unit-testable with no
 * DOM (the exact payload shape is the contract PR-F's receiver matches).
 */
export function buildScrollToMessage(id: string): LessonScrollToMessage {
  return { type: LESSON_SCROLL_TO_TYPE, id };
}

/**
 * Post the coordinate-only section-jump message INTO the lesson iframe. TRIES the documented opaque-origin
 * token `PARENT_TO_CHILD_TARGET_ORIGIN` (`'null'`) first; if the browser rejects it (`SyntaxError` — it
 * cannot be a target origin for an opaque-origin frame, see the file header), falls back to `'*'`, which is
 * safe for THIS sandbox (it cannot navigate to a foreign origin). Guards a null `contentWindow` (a not-yet-
 * loaded iframe): a missing window is a no-op (returns false), never a throw. Returns true when the message
 * was posted. Best-effort: the lesson acts on it only once PR-F teaches it to receive the verb.
 */
export function postScrollTo(contentWindow: Window | null, id: string): boolean {
  if (!contentWindow) return false;
  const message = buildScrollToMessage(id);
  try {
    contentWindow.postMessage(message, PARENT_TO_CHILD_TARGET_ORIGIN);
  } catch {
    // The literal 'null' token is not an accepted target origin for an opaque-origin frame on this engine;
    // '*' is the only reachable target, and is safe for our non-navigable sandboxed artifact (file header).
    contentWindow.postMessage(message, '*');
  }
  return true;
}
