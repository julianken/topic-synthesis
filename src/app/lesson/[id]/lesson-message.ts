/**
 * The decision-12 cross-iframe `postMessage` contract (TS-13, path a) — the PARENT RECEIVE SIDE.
 *
 * The generated lesson runs in an OPAQUE-ORIGIN sandbox (`sandbox="allow-scripts"` WITHOUT
 * `allow-same-origin`, served under `default-src 'none'` — `src/app/artifact/serve.ts`), so the
 * parent (`src/app/lesson/[id]/page.tsx`, and TS-20's reader shell that wraps it) CANNOT read the
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
 * The OPTIONAL apparatus extension (PR-F) — the panel's richer cards (key-term glosses, figure
 * captions, cited sources, self-check Q/A, takeaways) as STRUCTURED COORDINATE-ONLY DATA, NOT DOM
 * node refs and NOT HTML. The in-iframe sender serializes values the lesson already contains (its
 * rendered glosses/figures/sources/checks/takeaways) into plain strings; the panel renders every
 * field as TEXT (a source's `url` becomes a validated `rel=noopener` link, never `innerHTML`). It is
 * a CONTENT-INTERNAL extension to the sandboxed doc — the trust boundary / CSP / iframe attrs are
 * byte-unchanged. Every field is optional and INDEPENDENTLY sanitized on receive (bounded counts +
 * string lengths, http(s)-only URLs); a missing / partial / malformed field falls back to the card's
 * placeholder (decision-13 best-effort — a lesson posting only the old `{sections, scrollProgress}`
 * shape still works). See {@link sanitizeApparatus}.
 */
export interface LessonGloss {
  term: string;
  definition: string;
}
export interface LessonFigure {
  caption: string;
}
export interface LessonSource {
  title: string;
  /** A validated absolute http/https URL (the only protocols the sanitizer admits). */
  url: string;
}
export interface LessonCheck {
  prompt: string;
  answer: string;
}
export interface LessonApparatus {
  glosses?: LessonGloss[];
  figures?: LessonFigure[];
  sources?: LessonSource[];
  checks?: LessonCheck[];
  takeaways?: string[];
}

/**
 * The coordinate-only payload the in-iframe sender posts to `window.parent`: the section list + a
 * normalized scroll-progress scalar in `0..1`, plus the OPTIONAL {@link LessonApparatus} extension
 * (PR-F). NO HTML, NO executable content, NO DOM refs — purely the coordinates + serialized text the
 * reading-progress bar / section-jump / apparatus panel need. `apparatus` is absent on the old
 * `{sections, scrollProgress}` shape (backward-compatible — the panel shows placeholders then).
 */
export interface LessonMessage {
  type: typeof LESSON_MESSAGE_TYPE;
  sections: LessonSection[];
  scrollProgress: number;
  apparatus?: LessonApparatus;
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
 * Bounded caps on the OPTIONAL apparatus payload (PR-F). The apparatus is UNTRUSTED data from the
 * sandboxed lesson, so it is bounded both ways: a per-array COUNT cap (a flood of entries beyond the
 * cap is dropped, not rendered) and a per-string LENGTH cap (an over-long string drops that entry —
 * never truncates, which would fabricate a half-value). The ceilings are generous-but-finite: the
 * panel renders these as plain text, so they only have to be large enough for real lesson copy and
 * small enough that a hostile sender can't flood the panel DOM.
 */
const APPARATUS_COUNT_CAP = {
  glosses: 24,
  figures: 12,
  sources: 24,
  checks: 12,
  takeaways: 16,
} as const;
const STRLEN = {
  term: 160,
  definition: 600,
  caption: 400,
  sourceTitle: 240,
  url: 2048,
  prompt: 600,
  answer: 800,
  takeaway: 600,
} as const;

/** A non-empty string within `max` chars, else null (an over-long / non-string value is rejected). */
function boundedString(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;
}

/**
 * An absolute http/https URL within the length cap, else null. Uses `URL` (available in both the
 * browser and `environment: 'node'`) to reject `javascript:` / `data:` / relative / malformed URLs —
 * only `http:`/`https:` are admitted, so a source href the panel renders can never be a script URL.
 */
function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > STRLEN.url) return null;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

/** Sanitize one array field: keep at most `cap` entries; DROP any entry the mapper rejects. Returns
 *  undefined for a non-array or an all-dropped field, so an absent/empty field omits cleanly. */
function sanitizeList<T>(
  raw: unknown,
  cap: number,
  map: (entry: Record<string, unknown>) => T | null,
): T[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: T[] = [];
  for (const entry of raw) {
    if (out.length >= cap) break; // count cap — drop the overflow, never render an unbounded list
    if (typeof entry !== 'object' || entry === null) continue; // drop a malformed entry
    const mapped = map(entry as Record<string, unknown>);
    if (mapped) out.push(mapped); // drop an entry that failed field validation
  }
  return out.length > 0 ? out : undefined;
}

/** Sanitize a plain string[] field (takeaways): at most `cap` non-empty strings within `max` chars. */
function sanitizeStringList(raw: unknown, cap: number, max: number): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  for (const entry of raw) {
    if (out.length >= cap) break;
    const s = boundedString(entry, max);
    if (s) out.push(s);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Parse the UNTRUSTED, OPTIONAL apparatus payload into a bounded {@link LessonApparatus}, or
 * undefined (PR-F). FAIL-SAFE BY DESIGN: unlike the core contract (bad sections/progress hard-reject
 * the whole message), a malformed/oversized apparatus is NEVER a whole-message rejection — it is
 * sanitized down to the valid subset (or undefined), so the panel falls back to placeholders for the
 * affected cards and the reading-progress/section data still flows. Every entry is rebuilt as a fresh
 * object carrying ONLY its contract fields, so no extra attacker-controlled property rides into the
 * rendered panel; URLs are http(s)-validated; strings are length-bounded. Returns undefined when the
 * input is not a plain object or nothing valid survives, so an empty apparatus omits cleanly.
 */
export function sanitizeApparatus(raw: unknown): LessonApparatus | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const a = raw as Record<string, unknown>;
  const out: LessonApparatus = {};

  const glosses = sanitizeList<LessonGloss>(a.glosses, APPARATUS_COUNT_CAP.glosses, (e) => {
    const term = boundedString(e.term, STRLEN.term);
    const definition = boundedString(e.definition, STRLEN.definition);
    return term && definition ? { term, definition } : null;
  });
  if (glosses) out.glosses = glosses;

  const figures = sanitizeList<LessonFigure>(a.figures, APPARATUS_COUNT_CAP.figures, (e) => {
    const caption = boundedString(e.caption, STRLEN.caption);
    return caption ? { caption } : null;
  });
  if (figures) out.figures = figures;

  const sources = sanitizeList<LessonSource>(a.sources, APPARATUS_COUNT_CAP.sources, (e) => {
    const title = boundedString(e.title, STRLEN.sourceTitle);
    const url = safeHttpUrl(e.url);
    return title && url ? { title, url } : null;
  });
  if (sources) out.sources = sources;

  const checks = sanitizeList<LessonCheck>(a.checks, APPARATUS_COUNT_CAP.checks, (e) => {
    const prompt = boundedString(e.prompt, STRLEN.prompt);
    const answer = boundedString(e.answer, STRLEN.answer);
    return prompt && answer ? { prompt, answer } : null;
  });
  if (checks) out.checks = checks;

  const takeaways = sanitizeStringList(a.takeaways, APPARATUS_COUNT_CAP.takeaways, STRLEN.takeaway);
  if (takeaways) out.takeaways = takeaways;

  return Object.keys(out).length > 0 ? out : undefined;
}

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

  // apparatus (PR-F): OPTIONAL + FAIL-SAFE. Absent on the old shape → omitted (backward compatible).
  // Present but malformed/oversized → sanitized to the valid subset (or dropped), NEVER a whole-
  // message rejection — so progress/sections still flow and the panel falls back to placeholders.
  const data: LessonMessage = { type: LESSON_MESSAGE_TYPE, sections, scrollProgress: progress };
  if (raw.apparatus !== undefined) {
    const apparatus = sanitizeApparatus(raw.apparatus);
    if (apparatus) data.apparatus = apparatus;
  }

  return { ok: true, data };
}
