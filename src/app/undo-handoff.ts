/**
 * The reader→library read-once undo handoff (issue #202). A reader delete confirms via `router.push('/')`
 * — a client SOFT navigation (never a full-document reload, so the card→reader morph never pairs against
 * a now-missing card, see `reader-delete.ts`) — so React state can't carry "a lesson was just deleted"
 * across the boundary. sessionStorage does, but content read back from it is UNTRUSTED (another tab, a
 * disabled/full store, or a stale/foreign-shaped leftover from an older build) — so this module treats it
 * exactly like the `lesson-message.ts` / `library-delete.ts` untrusted-input discipline: a malformed or
 * absent payload degrades to `null`, it never throws.
 *
 * Read-once by construction: `readUndoHandoffOnce` removes the key the instant it reads it (successful
 * parse or not), so a page refresh — or a second consumer — never re-shows the library's Undo snackbar.
 * `scrollProgress` is validated + clamped to [0, 1] here as FORWARD-LOOKING plumbing (issue #202 ships no
 * scroll-restore consumer yet) — carried through so a future PR can wire it without touching this contract.
 *
 * Pure functions over an injectable `Storage`-shaped surface (the `library-delete.ts` / `library-morph.ts`
 * precedent: I/O is a parameter, not a module-level global), so the read-once + validation/clamping
 * decisions are node-testable with a Map-backed fake — no real `sessionStorage`, no DOM.
 */

/** The ONE known sessionStorage key the writer/reader agree on. */
const HANDOFF_KEY = 'ts:undo-handoff';

/** The handoff payload: the deleted lesson's id + the reader's posted scroll position at delete time. */
export interface UndoHandoff {
  id: string;
  scrollProgress: number;
}

/** The minimal `Storage`-shaped surface these functions need, so a test can inject a fake with no DOM. */
export interface HandoffStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The live browser `sessionStorage`, or `null` off a browser (SSR / a non-browser test). */
function liveSessionStorage(): HandoffStorage | null {
  return typeof globalThis.sessionStorage === 'object' ? globalThis.sessionStorage : null;
}

/**
 * Write the handoff — called by the reader right before its soft-nav to the library (once the DELETE has
 * already resolved 2xx; see `reader-delete.ts`). Best-effort: a storage fault (quota, disabled storage, a
 * non-browser environment) never throws into the delete flow — losing the handoff only costs the Undo
 * snackbar, never the delete itself, which has already committed by the time this is called.
 */
export function writeUndoHandoff(
  handoff: UndoHandoff,
  storage: HandoffStorage | null = liveSessionStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(HANDOFF_KEY, JSON.stringify({ id: handoff.id, scrollProgress: handoff.scrollProgress }));
  } catch {
    // Quota / disabled storage — best-effort, never surfaces to the caller.
  }
}

/**
 * Read the handoff EXACTLY ONCE: removes the key the instant it is read (whether or not the content
 * parses), so a page refresh never re-shows the library's Undo snackbar. Treats the stored string as
 * UNTRUSTED — see {@link parseHandoff} for the validation contract. Never throws: an unavailable or
 * faulting storage backend degrades to `null`, same as a genuinely absent handoff.
 */
export function readUndoHandoffOnce(storage: HandoffStorage | null = liveSessionStorage()): UndoHandoff | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(HANDOFF_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    storage.removeItem(HANDOFF_KEY);
  } catch {
    // Best-effort removal — a fault here still lets the (already-read) payload through this once.
  }
  return parseHandoff(raw);
}

/**
 * Parse + validate a stored handoff string as UNTRUSTED data (mirrors `lesson-message.ts`'s
 * `validateMessage` discipline): invalid JSON, a non-object, a missing/non-string `id`, or a missing/
 * non-finite `scrollProgress` all degrade to `null` — never a throw. A valid payload's `scrollProgress` is
 * clamped into `[0, 1]`; any extra/foreign fields are stripped (the return value carries only the two
 * contract fields). Exported so the untrusted-shape decision is directly unit-tested.
 */
export function parseHandoff(raw: string): UndoHandoff | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (data === null || typeof data !== 'object') return null;
  const id = (data as { id?: unknown }).id;
  const scrollProgress = (data as { scrollProgress?: unknown }).scrollProgress;
  if (typeof id !== 'string' || id.length === 0) return null;
  if (typeof scrollProgress !== 'number' || !Number.isFinite(scrollProgress)) return null;
  return { id, scrollProgress: Math.min(1, Math.max(0, scrollProgress)) };
}
