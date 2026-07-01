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
  DeferredDeleteController,
  emptySnapshot,
  type DeleteSnapshot,
} from './library-delete';
import { clampSelection, MAX_SELECTION, reconcileBulk } from './library-selection';
import { LibrarySnackbar } from './library-snackbar';

/**
 * The library home's shared selection / pending-delete context + the ONE standing ARIA live region — the
 * seam the lesson-deletion epic hangs its interactive pieces on (scaffolded in #200, given single-delete
 * behavior in #201, given the bulk multi-select behavior here in #203).
 *
 * #201 kept this a THIN React wrapper over the pure, node-tested {@link DeferredDeleteController} for the
 * single-card deferred-commit flow (schedule → 6s client timer → Undo cancels with NO network, or dwell
 * expiry fires the ONE soft-delete). #203's bulk flow is architecturally DIFFERENT (AC22: the client AWAITS
 * the batch commit before reconciling — "committed-then-restore, not a client timer") so it is NOT routed
 * through that controller; it is a second, simpler state machine live here (a single optimistic collapse →
 * await → {@link reconcileBulk} → a single ~9s Undo-via-restore window), reusing the deferred-delete
 * controller's `pendingDeleted` SHAPE (a plain id `Set`) so `PosterCard` (untouched) keeps working for
 * both single AND bulk collapses without caring which flow is driving it.
 *
 * SELECTABLE-ID REGISTRATION (binding amendment AC43-46): the selectable set backing `masterState`/
 * `selectAll` is populated ONLY by `PosterCard` registering its OWN lesson id via `registerSelectable` in
 * a mount effect — never a DOM query over `.library-poster`/`.library-poster__card` (a class an in-flight
 * `<InFlightCard>` tile shares). `inflight-card.tsx` deliberately never calls `useLibrary()`, so an
 * in-flight run can never register and is therefore structurally excluded from the selectable set, the
 * "Select all" target, and the master tri-state count — by construction, not by convention.
 */
interface LibraryContextValue {
  /** Ids of the cards currently selected (bulk multi-select — #203), capped at {@link MAX_SELECTION}. */
  selection: Set<string>;
  /** Ids in a collapse window — the UNION of the single-delete controller's pending set AND the bulk
   *  flow's optimistically-collapsed set. `PosterCard` reads this ONE set for both flows. */
  pendingDeleted: Set<string>;
  /** Whether the grid is in multi-select mode (#203) — the header "Select"/"Done" toggle. */
  selectionMode: boolean;
  /** Write a message into the ONE standing polite live region (the sole announcement channel). */
  announce: (message: string) => void;
  /** Start a deferred delete for a card (the chip handler): collapse + 6s Undo, no network at t=0. */
  scheduleDelete: (id: string, title: string) => void;
  /** Cancel a pending delete (Undo) — cancels the client timer, re-expands the card, sends no `DELETE`. */
  undoDelete: (id: string) => void;

  // ── Bulk multi-select (#203) ──────────────────────────────────────────────────────────────────────
  /** The count of REGISTERED selectable (persisted, non-in-flight) card ids — the denominator
   *  `masterState`/`selectAll` read. Registration-based (AC43-46), never a DOM count. */
  selectableCount: number;
  /** A `PosterCard` registers its own lesson id as selectable on mount (paired with
   *  {@link unregisterSelectable} on unmount). */
  registerSelectable: (id: string) => void;
  unregisterSelectable: (id: string) => void;
  enterSelectionMode: () => void;
  /** "Done" — exits selection mode AND empties the selection set (AC2). */
  exitSelectionMode: () => void;
  /** Toggle one card's selection; a no-op past the {@link MAX_SELECTION} cap for a not-yet-selected id
   *  (AC7 — further per-card attempts at the cap add nothing). */
  toggleSelected: (id: string) => void;
  /** Select every registered selectable id, capped at {@link MAX_SELECTION} (AC8). */
  selectAll: () => void;
  /** Empty the selection without leaving selection mode (the action bar's "Clear", AC13). */
  clearSelection: () => void;
  /** The bulk-collapse stagger index for `id` (its position in the current bulk batch), or `-1` when `id`
   *  is not part of an active bulk collapse — `PosterCard` reads this for the per-card `--bulk-i` stagger
   *  delay (AC23). */
  bulkIndexOf: (id: string) => number;
  /** Ids to play the reverse-collapse error-state-shake on (a failed bulk commit, AC28) — cleared shortly
   *  after the shake plays. */
  bulkShaking: Set<string>;
  /** Confirm-modal-driven bulk delete (AC22): AWAITS `POST /api/lessons/bulk-delete`, then reconciles the
   *  optimistic collapse against the server's `{ deleted }` reply, then surfaces the batch Undo snackbar. */
  bulkDelete: () => Promise<void>;
}

const LibraryContext = createContext<LibraryContextValue | null>(null);

/** Read the library selection / pending-delete / announce context. Throws outside a `LibraryProvider`. */
export function useLibrary(): LibraryContextValue {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error('useLibrary must be used within a LibraryProvider');
  return ctx;
}

/** The batch Undo dwell (#203) — LONGER than #201's 6s single-item dwell: a batch is a bigger, harder to
 *  reverse-by-hand mistake, so the owner gets more time to notice and reconsider. */
const BULK_DWELL_MS = 9000;

export function LibraryProvider({ children }: { children: ReactNode }) {
  const router = useRouter();

  // ── Selectable-id registration (AC43-46) — a Set PosterCard mounts/unmounts itself into. Insertion
  // order (server render order, newest-first) is what selectAll()/bulkIndexOf naturally iterate.
  const [registeredIds, setRegisteredIds] = useState<Set<string>>(() => new Set());
  const registerSelectable = useCallback((id: string) => {
    setRegisteredIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);
  const unregisterSelectable = useCallback((id: string) => {
    setRegisteredIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // ── Selection mode + the selected-id set ──────────────────────────────────────────────────────────
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const [selectionMode, setSelectionMode] = useState(false);

  const enterSelectionMode = useCallback(() => setSelectionMode(true), []);
  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelection(new Set());
  }, []);
  const toggleSelected = useCallback((id: string) => {
    setSelection((prev) => {
      if (prev.has(id)) {
        const next = new Set(prev);
        next.delete(id);
        return next;
      }
      if (prev.size >= MAX_SELECTION) return prev; // at cap — AC7, no-op
      return new Set(prev).add(id);
    });
  }, []);
  const selectAll = useCallback(() => {
    setSelection(new Set(clampSelection([...registeredIds], MAX_SELECTION)));
  }, [registeredIds]);
  const clearSelection = useCallback(() => setSelection(new Set()), []);

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

  const scheduleDelete = useCallback(
    (id: string, title: string) => controller.schedule(id, title),
    [controller],
  );
  const undoDelete = useCallback((id: string) => controller.undo(id), [controller]);

  // ── Bulk delete (#203) — a SEPARATE, simpler machine from the single-delete controller above: the
  // commit is a REAL awaited network call (AC22), not a client timer, so Undo here means "restore what
  // was already deleted" rather than "cancel before it happens". `bulkPendingOrder` is BOTH the ordered
  // stagger-index source (AC23) during the initial optimistic collapse AND, once the commit resolves, the
  // exact set of server-confirmed-removed ids the ~9s Undo window can restore. ──────────────────────────
  const [bulkPendingOrder, setBulkPendingOrder] = useState<string[]>([]);
  const [bulkShaking, setBulkShaking] = useState<Set<string>>(new Set());
  const [bulkSnackbar, setBulkSnackbar] = useState<{ id: string; count: number } | null>(null);
  const [bulkPaused, setBulkPaused] = useState(false);
  const [bulkFailed, setBulkFailed] = useState(false);

  const bulkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bulkDwellRemainingRef = useRef(BULK_DWELL_MS);
  const bulkDwellStartedAtRef = useRef(0);
  const bulkSeqRef = useRef(0);

  const clearBulkTimer = useCallback(() => {
    if (bulkTimerRef.current != null) {
      clearTimeout(bulkTimerRef.current);
      bulkTimerRef.current = null;
    }
  }, []);
  useEffect(() => () => clearBulkTimer(), [clearBulkTimer]);

  const startBulkDwell = useCallback(
    (ms: number) => {
      clearBulkTimer();
      bulkDwellRemainingRef.current = ms;
      bulkDwellStartedAtRef.current = Date.now();
      bulkTimerRef.current = setTimeout(() => {
        bulkTimerRef.current = null;
        setBulkSnackbar(null);
      }, ms);
    },
    [clearBulkTimer],
  );

  const onBulkPauseChange = useCallback(
    (paused: boolean) => {
      setBulkPaused(paused);
      if (paused) {
        const elapsed = Date.now() - bulkDwellStartedAtRef.current;
        bulkDwellRemainingRef.current = Math.max(0, bulkDwellRemainingRef.current - elapsed);
        clearBulkTimer();
      } else {
        startBulkDwell(bulkDwellRemainingRef.current);
      }
    },
    [clearBulkTimer, startBulkDwell],
  );

  const onBulkDismiss = useCallback(() => {
    // Dismiss hides the toast only — the delete already committed (AC26), unlike the single-delete
    // snackbar's dismiss (which still lets an UNCOMMITTED dwell run to its eventual commit).
    clearBulkTimer();
    setBulkSnackbar(null);
  }, [clearBulkTimer]);

  const bulkIndexOf = useCallback((id: string) => bulkPendingOrder.indexOf(id), [bulkPendingOrder]);

  const bulkDelete = useCallback(async () => {
    const ids = clampSelection([...selection], MAX_SELECTION);
    if (ids.length === 0) return;
    // The confirm already happened (the caller's modal) — retire the transient selection UI now, and
    // start the optimistic collapse immediately (AC23's stagger reads this ordered set).
    setSelectionMode(false);
    setSelection(new Set());
    setBulkFailed(false);
    setBulkPendingOrder(ids);

    let deleted: string[];
    try {
      const res = await fetch('/api/lessons/bulk-delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error(`bulk-delete failed (${res.status})`);
      const body = (await res.json()) as { deleted?: unknown };
      deleted = Array.isArray(body.deleted) ? body.deleted.filter((d): d is string => typeof d === 'string') : [];
    } catch {
      // Total commit failure: every optimistically-collapsed card re-expands (AC28 — PosterCard's own
      // pending→false transition already replays the reverse card-resize via its existing rail-reveal
      // restore) plus a brief error-state-shake, and the shared errchip surfaces (AC29).
      setBulkPendingOrder([]);
      setBulkShaking(new Set(ids));
      setBulkFailed(true);
      setTimeout(() => setBulkShaking(new Set()), 260);
      return;
    }

    const { removed, reexpand } = reconcileBulk(ids, deleted);
    void reexpand; // only informative here — clearing bulkPendingOrder to `removed` IS the re-expand.
    setBulkPendingOrder(removed);
    reconcileRef.current();

    if (removed.length === 0) {
      // Nothing was actually deleted (every id was a stale/foreign race) — no snackbar, no announcement.
      return;
    }

    const seq = ++bulkSeqRef.current;
    setBulkSnackbar({ id: `bulk-${seq}`, count: removed.length });
    setBulkPaused(false);
    startBulkDwell(BULK_DWELL_MS);
    // AFTER the caller's modal has already closed (Confirm closes it synchronously before this async
    // function's network call even starts) — never combine a live-region announcement with an active
    // focus trap.
    announceRef.current(`${removed.length} ${removed.length === 1 ? 'lesson' : 'lessons'} deleted, Undo available`);
  }, [selection, startBulkDwell]);

  const undoBulk = useCallback(async () => {
    clearBulkTimer();
    const ids = [...bulkPendingOrder];
    setBulkSnackbar(null);
    if (ids.length === 0) return;
    try {
      const res = await fetch('/api/lessons/restore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error(`restore failed (${res.status})`);
      const body = (await res.json()) as { restored?: unknown };
      const restored = Array.isArray(body.restored)
        ? body.restored.filter((d): d is string => typeof d === 'string')
        : [];
      const restoredSet = new Set(restored);
      setBulkPendingOrder((prev) => prev.filter((id) => !restoredSet.has(id)));
      reconcileRef.current();
      if (restored.length > 0) {
        announceRef.current(`${restored.length} ${restored.length === 1 ? 'lesson' : 'lessons'} restored`);
      }
    } catch {
      // A failed restore leaves the cards deleted — no further recoverable affordance for this rare
      // secondary failure (mirrors the single-delete flow's own no-retry-on-restore-failure scope).
    }
  }, [bulkPendingOrder, clearBulkTimer]);

  // `PosterCard` reads ONE merged pending set for both the single-delete controller's collapse AND the
  // bulk flow's optimistic collapse — it never has to know which flow put a given id there.
  const pendingDeleted = useMemo(
    () => new Set([...snapshot.pending.map((p) => p.id), ...bulkPendingOrder]),
    [snapshot.pending, bulkPendingOrder],
  );

  const value = useMemo<LibraryContextValue>(
    () => ({
      selection,
      pendingDeleted,
      selectionMode,
      announce,
      scheduleDelete,
      undoDelete,
      selectableCount: registeredIds.size,
      registerSelectable,
      unregisterSelectable,
      enterSelectionMode,
      exitSelectionMode,
      toggleSelected,
      selectAll,
      clearSelection,
      bulkIndexOf,
      bulkShaking,
      bulkDelete,
    }),
    [
      selection,
      pendingDeleted,
      selectionMode,
      announce,
      scheduleDelete,
      undoDelete,
      registeredIds,
      registerSelectable,
      unregisterSelectable,
      enterSelectionMode,
      exitSelectionMode,
      toggleSelected,
      selectAll,
      clearSelection,
      bulkIndexOf,
      bulkShaking,
      bulkDelete,
    ],
  );

  return (
    <LibraryContext.Provider value={value}>
      {children}

      {/* The single bottom Undo snackbar — mounts only while a SINGLE-card delete is undoable
          (panel-reveal in). It carries NO aria-live of its own (the standing region below is the sole
          announcement channel). */}
      <LibrarySnackbar
        surfaced={snapshot.surfaced}
        paused={snapshot.paused}
        dwellMs={6000}
        onUndo={() => controller.undoMostRecent()}
        onDismiss={() => controller.dismissSurfaced()}
        onPauseChange={(paused) => controller.setSurfacedPaused(paused)}
      />

      {/* The BATCH Undo snackbar (#203) — the SAME panel-reveal component, a longer ~9s dwell, and
          batch-worded copy. Mounts only while a bulk delete's Undo window is open. */}
      <LibrarySnackbar
        surfaced={bulkSnackbar}
        paused={bulkPaused}
        dwellMs={BULK_DWELL_MS}
        label={bulkSnackbar ? `${bulkSnackbar.count} ${bulkSnackbar.count === 1 ? 'lesson' : 'lessons'} deleted` : ''}
        hint="Find them in Recently deleted"
        variant="batch"
        onUndo={() => void undoBulk()}
        onDismiss={onBulkDismiss}
        onPauseChange={onBulkPauseChange}
      />

      {/* The recoverable failure surface — a scoped role="alert" error chip (status by `!` icon + --err
          text/outline, never a fill). Shows after EITHER a single-card commit fails OR a bulk commit
          fails (AC29) — same exact copy either way, so no branching text is needed. */}
      {snapshot.failed || bulkFailed ? (
        <div className="library-errchip" role="alert" aria-live="assertive">
          <span className="library-errchip__icon" aria-hidden="true">
            !
          </span>
          <span className="library-errchip__text">Couldn&rsquo;t delete — try again</span>
          <button
            type="button"
            className="library-errchip__dismiss"
            aria-label="Dismiss"
            onClick={() => {
              controller.dismissFailed();
              setBulkFailed(false);
            }}
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
