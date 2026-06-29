/**
 * The decision-12 cross-iframe `postMessage` contract (TS-13, path a) — the PARENT RECEIVE SIDE.
 *
 * The generated lesson runs in an OPAQUE-ORIGIN sandbox (`sandbox="allow-scripts"` WITHOUT
 * `allow-same-origin`, served under `default-src 'none'` — `src/app/artifact/serve.ts`), so the
 * parent (`src/app/curriculum/[id]/page.tsx`, and TS-20's reader shell that wraps it) CANNOT read the
 * iframe DOM. A small `postMessage` channel — the in-iframe sender emits it (instructed by the
 * `code` stage, `src/pipeline/code.ts`); this is the receive side — is the only mechanism for the
 * later reading-progress bar / ⌘K section-jump / in-iframe dot-scrubber coordination (TS-20).
 *
 * RECEIVE-SIDE DISCIPLINE (program doc revision 9 + R12 — the load-bearing trust contract):
 *   1. IDENTITY, not origin. The receiver validates `event.source === readerIframe.contentWindow`
 *      (a Window reference, NEVER a string compare). Across the opaque boundary `event.origin` is
 *      the literal string `"null"`, so an origin allowlist is meaningless — only Window identity is
 *      a real trust check.
 *   2. UNTRUSTED coordinate-only DATA. The payload is parsed as untrusted data — a section list
 *      (`{id, title}[]`) + a scroll-progress scalar (`0..1`). The validator returns the parsed,
 *      bounds-checked data; the CALLER must use it WITHOUT reflecting it into DOM / `innerHTML` /
 *      navigation / `eval`. The validator itself performs NO such side effect — it is a pure
 *      function: input → `{ ok }` result, nothing else.
 *   3. The two cross-boundary SENDERS target origins DIFFERENTLY — keep them distinct:
 *      • The iframe→parent OUTWARD sender (THIS `lesson:progress` channel — the in-iframe sender posts
 *        to `window.parent`) targets the parent's KNOWN app origin, NEVER `'*'`: the parent has a real
 *        URL origin, so a precise targetOrigin is both possible and required (no `'*'` leak).
 *      • The parent→child INWARD sender (`lesson:scrollTo`, `lesson-scroll-sender.ts`, shipped PR-C)
 *        CANNOT target a known origin — the child is OPAQUE-ORIGIN (`sandbox="allow-scripts"` with NO
 *        `allow-same-origin`), which has no URL representation, so the engine rejects the documented
 *        `'null'` token and the post ships on a `'*'` FALLBACK. That `'*'` is SOUND here: the target is
 *        our own non-navigable sandbox under a strict CSP, with no foreign-origin frame for `'*'` to
 *        leak to (see `PARENT_TO_CHILD_TARGET_ORIGIN` below + `lesson-scroll-sender.ts`'s WIRE REALITY).
 *
 * This is a PURE, framework-free function (no React/Next/DOM import) so it unit-tests under
 * `vitest`'s `environment: 'node'` with hand-built fake `Window` sentinels — object identity is all
 * the `===` check needs — and adversarial payloads, with NO renderer / DOM test env / new dependency
 * (Key-decision 5 / R2 forbid a headless renderer). TS-20's production parent IMPORTS and CALLS this
 * same `validateMessage` inside its real `message` handler; TS-13 ships the validator + its node unit
 * tests, NOT a parent consumer (that is TS-20, Phase 3).
 */

/**
 * The message discriminant. The in-iframe sender stamps `type: LESSON_MESSAGE_TYPE` and the
 * validator only accepts a payload carrying it — a cheap shape gate BEFORE the identity check is
 * what makes the channel ignore unrelated `postMessage` traffic. The `code`-stage prompt emits this
 * exact literal into the sender (asserted by a static test), so this constant is the canonical
 * source for both sides of the contract.
 */
export const LESSON_MESSAGE_TYPE = 'lesson:progress' as const;

/** One section entry in the coordinate-only payload — an id + a human title, both plain strings. */
export interface LessonSection {
  id: string;
  title: string;
}

/**
 * The coordinate-only payload the in-iframe sender posts to `window.parent`: the section list + a
 * normalized scroll-progress scalar in `0..1`. NO HTML, NO URLs, NO executable content — purely the
 * coordinates TS-20's reading-progress bar / section-jump need.
 */
export interface LessonMessage {
  type: typeof LESSON_MESSAGE_TYPE;
  sections: LessonSection[];
  scrollProgress: number;
}

/** A trusted, parsed message, or a typed rejection with a machine-readable reason. */
export type ValidateResult =
  | { ok: true; data: LessonMessage }
  | { ok: false; reason: ValidateReason };

export type ValidateReason =
  | 'untrusted-source' // event.source is not the reader iframe's contentWindow (identity check failed)
  | 'not-an-object' // the payload is null / a primitive — not a structured message
  | 'wrong-type' // the discriminant `type` is missing or not LESSON_MESSAGE_TYPE
  | 'bad-progress' // scrollProgress is not a finite number in [0, 1]
  | 'bad-sections'; // sections is not an array of {id, title} string pairs

/** The arguments a receiver passes to {@link validateMessage}: the event's `source` Window, the
 *  reader iframe's `contentWindow` (the ONLY trusted sender), and the raw, untrusted `data`. */
export interface ValidateArgs {
  /** `MessageEvent.source` — a `Window` reference (NOT an origin string). May be null/foreign. */
  source: unknown;
  /** The reader iframe's `contentWindow` — the one trusted sender. Identity-compared, never read. */
  expectedWindow: unknown;
  /** `MessageEvent.data` — UNTRUSTED. Parsed as coordinate-only data, never reflected anywhere. */
  payload: unknown;
}

/**
 * The parent→child target-origin token. The parent→child sender SHIPPED in `lesson-scroll-sender.ts`
 * (PR-C's `postScrollTo`, reused by PR-E's mobile TOC + the topbar ⌘K jumper): when the chrome posts a
 * `lesson:scrollTo` BACK into the iframe it tries to target the child's opaque origin by this documented
 * `'null'` token FIRST. In practice the opaque origin has NO URL representation, so Chromium REJECTS
 * `'null'` as a targetOrigin (`SyntaxError: Invalid target origin 'null'`) and the post falls back to
 * `'*'` — which is SOUND for THIS sandbox: an opaque-origin, NON-NAVIGABLE `sandbox="allow-scripts"`
 * (no `allow-same-origin`) frame under a strict CSP has no foreign-origin frame for `'*'` to leak to.
 * The `'null'` attempt is kept as forward-compat (honored the moment any engine accepts it), not a
 * runtime guarantee. This is the parent→child direction ONLY; the OUTWARD `lesson:progress` sender
 * targets the parent's KNOWN origin and never `'*'` (RECEIVE-SIDE discipline item 3 above). See
 * `lesson-scroll-sender.ts`'s WIRE REALITY note for the full target-origin model.
 */
export const PARENT_TO_CHILD_TARGET_ORIGIN = 'null' as const;

/**
 * Validate one received `postMessage` from the lesson iframe. PURE: it reads only its three args,
 * performs the identity trust check + an untrusted-data parse, and returns a typed result — it
 * NEVER touches the DOM, navigates, writes `innerHTML`, or `eval`s. The caller is expected to use
 * `result.data` as inert coordinates (drive a progress bar / a section list), never reflect it.
 */
export function validateMessage({ source, expectedWindow, payload }: ValidateArgs): ValidateResult {
  // (1) IDENTITY trust check — Window reference equality, NOT an origin string compare. A foreign
  // frame (or a null source) is rejected before the payload is even inspected. `expectedWindow`
  // must be a real object reference; a null/undefined expected window can never match a real source.
  if (expectedWindow == null || source !== expectedWindow) {
    return { ok: false, reason: 'untrusted-source' };
  }

  // (2) UNTRUSTED-DATA parse. From here the source is trusted-by-identity, but the DATA is still
  // untrusted — a compromised lesson script could post a hostile shape. Parse defensively into the
  // coordinate-only contract; anything off-contract is rejected (no coercion of HTML/URLs through).
  if (typeof payload !== 'object' || payload === null) {
    return { ok: false, reason: 'not-an-object' };
  }
  const raw = payload as Record<string, unknown>;

  if (raw.type !== LESSON_MESSAGE_TYPE) {
    return { ok: false, reason: 'wrong-type' };
  }

  // scrollProgress: a finite number, bounds-checked to [0, 1]. NaN / Infinity / a string / an
  // out-of-range number is a rejection (not a silent clamp) — the contract is `0..1` and a sender
  // emitting otherwise is off-contract.
  const progress = raw.scrollProgress;
  if (typeof progress !== 'number' || !Number.isFinite(progress) || progress < 0 || progress > 1) {
    return { ok: false, reason: 'bad-progress' };
  }

  // sections: an array of `{id, title}` where BOTH are strings. A non-array, or any entry that is
  // not a plain {string,string} pair, is rejected. We rebuild each entry as a fresh `{id, title}`
  // object carrying ONLY those two string fields, so no extra attacker-controlled property rides
  // along into `data` for a careless caller to reflect.
  const rawSections = raw.sections;
  if (!Array.isArray(rawSections)) {
    return { ok: false, reason: 'bad-sections' };
  }
  const sections: LessonSection[] = [];
  for (const entry of rawSections) {
    if (typeof entry !== 'object' || entry === null) {
      return { ok: false, reason: 'bad-sections' };
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.id !== 'string' || typeof e.title !== 'string') {
      return { ok: false, reason: 'bad-sections' };
    }
    sections.push({ id: e.id, title: e.title });
  }

  return { ok: true, data: { type: LESSON_MESSAGE_TYPE, sections, scrollProgress: progress } };
}
