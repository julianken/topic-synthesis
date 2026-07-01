/**
 * The reader delete flow's pure orchestration core (issue #202). Mirrors the `library-delete.ts` /
 * `library-morph.ts` discipline: every effect (the same-origin DELETE, the same-document recede, the
 * read-once handoff write, the soft-nav) is INJECTED, so the flow's SEQUENCING is node-testable with no
 * DOM, no network, and no router.
 *
 * Why this order — delete THEN recede THEN write-handoff THEN navigate: the reader is committed-then-
 * restore (the opposite of the library card's deferred-commit), because there is no card left to
 * optimistically collapse and the user is about to leave the document — so the soft-delete is `await`ed
 * FIRST, and only on a confirmed 2xx does the UI recede + hand off + soft-nav. A failed delete performs
 * NONE of the follow-on effects: the popover stays open, no navigation happens, and the caller (the
 * `reader-delete-pill.tsx` component) surfaces the retry alert.
 */

/** The reader delete flow's injected effects — the wiring layer (`reader-delete-pill.tsx`) supplies the
 *  real fetch / `runViewTransition` / `writeUndoHandoff` / `router.push` implementations; tests inject
 *  spies. */
export interface ReaderDeleteDeps {
  /** The same-origin `DELETE /api/lesson/[id]` — resolves `true` on a 2xx response, `false` on any
   *  non-2xx status. Must never reject (the same "commit fn never rejects" contract as `library-delete.ts`'s
   *  `DeleteCommit`) — the wiring layer wraps its real `fetch` in try/catch. */
  deleteLesson: (id: string) => Promise<boolean>;
  /** The same-document recede (already `vtOff()`/`runViewTransition`-gated by the caller — AC20): resolves
   *  once the recede has applied, instantly under reduced motion / no View-Transition API. */
  recede: () => Promise<void>;
  /** Write the read-once cross-navigation handoff (`undo-handoff.ts`) — called AFTER the recede resolves,
   *  BEFORE the soft-nav. */
  writeHandoff: (id: string, scrollProgress: number) => void;
  /** The client soft-navigation to the library home (`router.push('/')`) — never a full-document nav, so
   *  the card→reader morph never pairs against a now-missing card. */
  navigate: () => void;
}

/**
 * Run the reader delete flow for `id` (the lesson being deleted) with the reader's currently-posted
 * `scrollProgress` (the forward-looking handoff plumbing — AC28). Returns `true` on success (the caller
 * has already navigated away by the time this resolves); `false` on failure, having performed none of the
 * recede/handoff/navigate effects — the caller is responsible for surfacing the retry UI.
 */
export async function performReaderDelete(
  id: string,
  scrollProgress: number,
  deps: ReaderDeleteDeps,
): Promise<boolean> {
  const ok = await deps.deleteLesson(id);
  if (!ok) return false;
  await deps.recede();
  deps.writeHandoff(id, scrollProgress);
  deps.navigate();
  return true;
}
