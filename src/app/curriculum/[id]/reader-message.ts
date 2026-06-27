/**
 * The reader shell's PURE message reducer (TS-20, Phase 3) — the node-testable core of the reader's
 * `message` handler. The client reader shell (`reader-shell.tsx`) registers a `window`
 * `message` listener; for each event it calls {@link reduceReaderMessage} with the event's `source`
 * Window, the lesson iframe's `contentWindow`, the raw `data`, and the current reader chrome state.
 * The reducer delegates the TRUST + UNTRUSTED-DATA decision entirely to TS-13's `validateMessage`
 * (it adds NO second copy of the trust contract — AC3) and returns:
 *
 *   - the NEXT reader-chrome state (`{ scrollProgress, sections }`) drawn ONLY from the validator's
 *     `{ ok: true }` parsed coordinates, when the message is trusted + on-contract; or
 *   - `null` — meaning "ignore this event" — for ANY `{ ok: false }` verdict (untrusted source,
 *     off-contract payload). On ignore the caller performs NO DOM write driven by the payload (AC5).
 *
 * Why a separate pure function (mirroring `lesson-message.ts`): the repo's vitest runs in
 * `environment: 'node'` with NO DOM (`vitest.config.ts`), and the `.tsx` shell can't mount there.
 * Pulling the decision out of React into a pure `state → state | null` reducer lets the handler's
 * contract (calls `validateMessage`, drives chrome ONLY on `ok`, ignores `ok:false`) be unit-tested
 * without a renderer — the same discipline `lesson-message.test.ts` uses for the validator itself.
 *
 * RECEIVE-SIDE DISCIPLINE (inherited from `lesson-message.ts`): the reducer NEVER compares
 * `event.origin` (it takes no origin arg — identity via `validateMessage` is the only trust check),
 * NEVER reads the iframe DOM, and treats the validated `data` as inert coordinates the caller binds
 * to a progress fill / a section list, never reflecting it into `innerHTML` / navigation / `eval`.
 */

import { validateMessage, type LessonSection } from './lesson-message';

/** The reader-chrome state the shell renders: the progress-fill scalar + the posted section list. */
export interface ReaderChromeState {
  /** Normalized reading progress in [0, 1], driving the progress fill. 0 before any valid message. */
  scrollProgress: number;
  /** The lesson's section list (id + title), driving the section list. Empty before any valid message. */
  sections: LessonSection[];
}

/** The starting chrome state — empty/zero, so the shell renders fully usable over a bare iframe (AC6). */
export const INITIAL_READER_CHROME: ReaderChromeState = { scrollProgress: 0, sections: [] };

/** The arguments the shell's `message` handler hands the reducer for one received event. */
export interface ReduceReaderArgs {
  /** `MessageEvent.source` — a Window reference (NOT an origin string). Identity-checked, never read. */
  source: unknown;
  /** The lesson iframe's `contentWindow` — the one trusted sender. May be null before the frame mounts. */
  expectedWindow: unknown;
  /** `MessageEvent.data` — UNTRUSTED. Parsed by `validateMessage` as coordinate-only data. */
  payload: unknown;
}

/**
 * Reduce one received `postMessage` into the next reader-chrome state, or `null` to ignore it.
 *
 * PURE: it reads only its args, calls `validateMessage` (the SOLE trust + parse authority — AC3),
 * and returns derived coordinates. It performs NO side effect — no DOM, no navigation, no `eval` —
 * so a `null` return is the caller's signal to leave the rendered chrome exactly as-is (AC5). On a
 * valid message it returns a FRESH state built ONLY from `result.data.scrollProgress` +
 * `result.data.sections` (the validator already stripped any extra attacker-controlled fields), so
 * nothing off-contract rides into the rendered chrome (AC6).
 */
export function reduceReaderMessage({
  source,
  expectedWindow,
  payload,
}: ReduceReaderArgs): ReaderChromeState | null {
  const result = validateMessage({ source, expectedWindow, payload });
  if (!result.ok) return null; // untrusted source OR off-contract payload → ignore, no DOM write (AC5).
  return { scrollProgress: result.data.scrollProgress, sections: result.data.sections };
}
