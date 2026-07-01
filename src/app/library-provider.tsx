'use client';

import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ANNOUNCE_RESTORED,
  DeferredDeleteController,
  emptySnapshot,
  type DeleteSnapshot,
} from './library-delete';
import { LibrarySnackbar } from './library-snackbar';
import { readUndoHandoffOnce } from './undo-handoff';

/**
 * The library home's shared selection / pending-delete context + the ONE standing ARIA live region — the
 * seam the lesson-deletion epic hangs its interactive pieces on (scaffolded in #200, given behavior here
 * in #201 single-delete, extended in #202 with the reader's committed-then-restore handoff).
 *
 * #201 keeps this a THIN React wrapper: the race-prone deferred-commit lifecycle lives in the pure,
 * node-tested {@link DeferredDeleteController} (`library-delete.ts`); this file only WIRES it to React
 * state, the real `setTimeout` clock, the real same-origin keepalive `fetch`, `router.refresh()`, the
 * `pagehide` flush, and the `Ctrl/Cmd+Z` chord — plus it renders the single bottom Undo snackbar + the
 * recoverable error chip and writes the standing live region. (Bulk multi-select state + the action bar
 * are #203.)
 *
 * #202 adds a SECOND, independent snackbar mode: the reader deletes COMMITTED-then-restore (there's no
 * card here to optimistically collapse, and the user is already mid-navigation by the time the library
 * mounts), so on mount this reads the read-once `undo-handoff.ts` payload a reader delete may have left
 * behind and, if present, offers an Undo whose action is a REAL `POST /api/lessons/restore` network call —
 * never a client-timer cancel (that's the #201 deferred-commit mode's Undo). It reuses the #201 snackbar's
 * exact CSS classes/copy voice (bottom-center panel-reveal, "Lesson deleted" + Undo + the Recently-deleted
 * hint) so the two mode read as ONE consistent undo affordance, but renders as its own small block (no
 * depleting dwell hairline — there's no client timer here to visualize) rather than reusing
 * `<LibrarySnackbar>` itself, which is wired specifically to the {@link DeferredDeleteController}
 * dwell/pause machinery. The two snackbars are not expected to co-occur (same rationale the #201 error
 * chip already documents for sharing its bottom-center seat).
 */
interface LibraryContextValue {
  /** Ids of the cards currently selected (bulk multi-select — #203). Empty until a setter is wired. */
  selection: Set<string>;
  /** Ids in the deferred-commit "pending delete" collapse window (#201) — drives the card collapse +
   *  `inert`. */
  pendingDeleted: Set<string>;
  /** Whether the grid is in multi-select mode (#203). False until a setter is wired. */
  selectionMode: boolean;
  /** Write a message into the ONE standing polite live region (the sole announcement channel). */
  announce: (message: string) => void;
  /** Start a deferred delete for a card (the chip handler): collapse + 6s Undo, no network at t=0. */
  scheduleDelete: (id: string, title: string) => void;
  /** Cancel a pending delete (Undo) — cancels the client timer, re-expands the card, sends no `DELETE`. */
  undoDelete: (id: string) => void;
}

const LibraryContext = createContext<LibraryContextValue | null>(null);

/** Read the library selection / pending-delete / announce context. Throws outside a `LibraryProvider`. */
export function useLibrary(): LibraryContextValue {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error('useLibrary must be used within a LibraryProvider');
  return ctx;
}

export function LibraryProvider({ children }: { children: ReactNode }) {
  const router = useRouter();

  // Bulk-select state (#203): read but no setter wired here, so it never changes this issue.
  const [selection] = useState<Set<string>>(() => new Set());
  const [selectionMode] = useState(false);

  // The deferred-delete machine's view, mirrored into React state by the controller's onChange.
  const [snapshot, setSnapshot] = useState<DeleteSnapshot>(emptySnapshot);

  // The single standing live region. Re-announce-safe (CARRIED SUGGESTION from #200): a {message, nonce}
  // so an IDENTICAL consecutive message still re-renders the region — assistive tech only announces a
  // CONTENT CHANGE, so two deletes in a row would otherwise speak only once. The nonce keys an inner span
  // (reset-then-set via remount), guaranteeing a DOM change even when the text repeats.
  const [live, setLive] = useState<{ message: string; nonce: number }>({ message: '', nonce: 0 });
  const announce = useCallback((message: string) => {
    setLive((prev) => ({ message, nonce: prev.nonce + 1 }));
  }, []);

  // The controller — created ONCE, wired to the live clock + the real keepalive fetch + router.refresh.
  // `announce` is read through a ref so the controller never has to be recreated when its identity changes
  // (it never does — `useCallback([])` — but the ref keeps the wiring honest).
  const announceRef = useRef(announce);
  announceRef.current = announce;
  const reconcileRef = useRef<() => void>(() => router.refresh());
  reconcileRef.current = () => router.refresh();

  const controllerRef = useRef<DeferredDeleteController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new DeferredDeleteController({
      clock: {
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
        now: () => Date.now(),
      },
      // The same-origin, credentialed soft-delete (#199). A same-origin fetch carries the session cookie
      // and passes the route's same-origin check; `keepalive` lets the unload-time DELETE survive. Never
      // rejects — a thrown/non-ok result resolves `false` so the state machine rolls the card back.
      //
      // A non-ok status is a genuine failure → roll back. A 200 is a success, INCLUDING the route's
      // idempotent no-op (`{ deleted: [] }` for an already-deleted / absent id): the card correctly stays
      // collapsed, and the controller's single `onReconcile` (below) runs `router.refresh()` ONCE after
      // the commit resolves — re-syncing the grid to server truth for a confirmed delete AND a no-op
      // alike. We deliberately do NOT reconcile here as well: that double-fired `router.refresh()` on
      // every no-op (the controller already covers it). Per-id confirmation lives in the pure, tested
      // `isConfirmedDelete` (`library-delete.ts`) — the seam the BULK path (#203) needs to reconcile
      // WHICH of many ids the server actually deleted; the single-card path converges via the one
      // controller reconcile alone, so it doesn't parse the body.
      commit: async (id, { keepalive }) => {
        try {
          const res = await fetch(`/api/lesson/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            keepalive,
          });
          return res.ok;
        } catch {
          return false;
        }
      },
      onChange: setSnapshot,
      announce: (msg) => announceRef.current(msg),
      onReconcile: () => reconcileRef.current(),
      dwellMs: 6000,
    });
  }
  const controller = controllerRef.current;

  // pagehide → commit every still-pending id exactly once via the keepalive DELETE (routed through the
  // controller's once-guard, so the expiry-vs-pagehide race can never double-commit).
  useEffect(() => {
    const onPageHide = () => controller.flushPending();
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [controller]);

  // Ctrl/Cmd+Z → Undo the most recent pending delete (only swallowed when there is something to undo).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === 'z' || e.key === 'Z')) {
        if (controller.hasPending()) {
          e.preventDefault();
          controller.undoMostRecent();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controller]);

  // ── #202: the reader-delete restore-mode snackbar (committed-then-restore) ─────────────────────────
  // Read the read-once handoff on mount. Deliberately a plain effect with an empty dep array — this must
  // run exactly once per mount (the read-once contract lives in `undo-handoff.ts`; a re-run here would
  // just find the key already gone and no-op, but there's no reason to re-check).
  const [restoreOffer, setRestoreOffer] = useState<{ id: string } | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  useEffect(() => {
    const handoff = readUndoHandoffOnce();
    if (handoff) setRestoreOffer({ id: handoff.id });
  }, []);

  const undoRestore = useCallback(async () => {
    if (!restoreOffer || restoring) return;
    setRestoring(true);
    setRestoreFailed(false);
    try {
      const res = await fetch('/api/lessons/restore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: [restoreOffer.id] }),
      });
      if (!res.ok) throw new Error('restore failed');
      setRestoreOffer(null);
      announceRef.current(ANNOUNCE_RESTORED);
      reconcileRef.current();
    } catch {
      setRestoreFailed(true);
    } finally {
      setRestoring(false);
    }
  }, [restoreOffer, restoring]);

  const dismissRestoreOffer = useCallback(() => {
    setRestoreOffer(null);
    setRestoreFailed(false);
  }, []);

  const pendingDeleted = useMemo(
    () => new Set(snapshot.pending.map((p) => p.id)),
    [snapshot.pending],
  );

  const scheduleDelete = useCallback(
    (id: string, title: string) => controller.schedule(id, title),
    [controller],
  );
  const undoDelete = useCallback((id: string) => controller.undo(id), [controller]);

  const value = useMemo<LibraryContextValue>(
    () => ({ selection, pendingDeleted, selectionMode, announce, scheduleDelete, undoDelete }),
    [selection, pendingDeleted, selectionMode, announce, scheduleDelete, undoDelete],
  );

  return (
    <LibraryContext.Provider value={value}>
      {children}

      {/* The single bottom Undo snackbar — mounts only while a delete is undoable (panel-reveal in). It
          carries NO aria-live of its own (the standing region below is the sole announcement channel). */}
      <LibrarySnackbar
        surfaced={snapshot.surfaced}
        paused={snapshot.paused}
        dwellMs={6000}
        onUndo={() => controller.undoMostRecent()}
        onDismiss={() => controller.dismissSurfaced()}
        onPauseChange={(paused) => controller.setSurfacedPaused(paused)}
      />

      {/* The recoverable failure surface — a scoped role="alert" error chip (status by `!` icon + --err
          text/outline, never a fill). Shows only after a commit fails (the card has re-expanded). */}
      {snapshot.failed ? (
        <div className="library-errchip" role="alert" aria-live="assertive">
          <span className="library-errchip__icon" aria-hidden="true">
            !
          </span>
          <span className="library-errchip__text">Couldn&rsquo;t delete — try again</span>
          <button
            type="button"
            className="library-errchip__dismiss"
            aria-label="Dismiss"
            onClick={() => controller.dismissFailed()}
          >
            ×
          </button>
        </div>
      ) : null}

      {/* #202 restore-mode snackbar — a reader delete's committed-then-restore handoff. Same visual
          language + copy voice as the #201 deferred-commit snackbar above (bottom-center panel-reveal,
          "Lesson deleted" + Undo + the Recently-deleted hint), but its OWN small render (no depleting dwell
          hairline — Undo here fires a real network restore, not a client-timer cancel, AC30) so it never
          shares state with the `DeferredDeleteController`. Mounts only while a handoff is pending. */}
      {restoreOffer ? (
        <div className="library-snackbar">
          <span className="library-snackbar__label">Lesson deleted</span>
          <button
            type="button"
            className="library-snackbar__undo"
            disabled={restoring}
            onClick={() => void undoRestore()}
          >
            Undo
          </button>
          <span className="library-snackbar__hint">Find it in Recently deleted</span>
          <button
            type="button"
            className="library-snackbar__dismiss"
            aria-label="Dismiss"
            onClick={dismissRestoreOffer}
          >
            ×
          </button>
        </div>
      ) : null}

      {/* The restore failure surface — same recoverable-error voice as the #201 error chip (status by `!`
          icon + --err text/outline, never a fill), shown only after a failed restore POST. */}
      {restoreFailed ? (
        <div className="library-errchip" role="alert" aria-live="assertive">
          <span className="library-errchip__icon" aria-hidden="true">
            !
          </span>
          <span className="library-errchip__text">Couldn&rsquo;t restore — try again</span>
          <button
            type="button"
            className="library-errchip__dismiss"
            aria-label="Dismiss"
            onClick={() => setRestoreFailed(false)}
          >
            ×
          </button>
        </div>
      ) : null}

      {/* The ONE standing, visually-hidden polite live region (clipped to 1px, no layout footprint). The
          nonce-keyed inner span makes a repeated message a real DOM change so AT re-announces it. */}
      <div className="library-live" role="status" aria-live="polite" aria-atomic="true">
        <span key={live.nonce}>{live.message}</span>
      </div>
    </LibraryContext.Provider>
  );
}
