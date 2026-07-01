/**
 * The library card single-delete DEFERRED-COMMIT state machine (issue #201) — the pure, node-testable
 * core of the zero-confirm delete + Undo flow. It mirrors the discipline of the shipped
 * `src/app/library-morph.ts` / `src/app/lesson/[id]/lesson-message.ts`: a pure `.ts` core with an
 * INJECTABLE clock + an INJECTABLE commit fn, so the race-prone concurrency (schedule / cancel / commit /
 * pagehide-flush / failure-rollback / reconcile) unit-tests directly under vitest's `environment: 'node'`
 * with no DOM, no real timers, and no network. `LibraryProvider` stays a THIN wrapper that wires this
 * module to React state, real `setTimeout` timers, the real keepalive `fetch`, and `router.refresh()`.
 *
 * Why a deferred commit (owner-locked decision, not optimistic-then-rollback): the card path fires NO
 * network at t=0. A delete is a pending CLIENT timer; Undo simply cancels it, so a delete can never
 * overtake a restore and there is no rollback race. The soft-delete `DELETE /api/lesson/[id]` (#199)
 * fires EXACTLY ONCE — only at ~6s expiry OR on `pagehide` — and the grid reconciles (`router.refresh()`)
 * ONLY after that request resolves. The happy path (Undo within the dwell) never touches the network.
 *
 * THE EXACTLY-ONCE GUARANTEE. The single source of truth is the per-entry `committed` flag. Both commit
 * call sites — the dwell-timer expiry AND the `pagehide` flush — check-and-set it before invoking the
 * injected commit fn, so the timer-expiry-vs-`pagehide` race resolves to ONE commit (JS is
 * single-threaded; whichever runs first sets `committed`, the other sees it and skips). The `pagehide`
 * flush routes through the SAME `commitEntry` bookkeeping (`keepalive` is just a fetch flag the wrapper
 * passes through) — it is NOT a second, unguarded commit path.
 *
 * N>1 PRESENTATION (the single snackbar over a pending SET). The module operates over a set of pending
 * deletes; the wrapper renders ONE bottom snackbar. Resolution: the snackbar always reflects the
 * MOST-RECENT undoable pending delete (`surfaced`); each id's 6s dwell runs INDEPENDENTLY on its own
 * timer; pausing (snackbar hover/focus) pauses ONLY the surfaced id's dwell. This gives #203's batch
 * extension a defined base.
 */

/** The minimal clock surface the dwell timers ride — injectable so the 6s window + pause/resume unit-test
 *  with no real timers. The wrapper passes the live `setTimeout`/`clearTimeout`/`Date.now`. */
export interface DeleteClock {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
}

/**
 * The commit transport — the wrapper passes a real same-origin credentialed keepalive `fetch`; tests pass
 * a spy. Resolves `true` on a successful soft-delete (a 2xx), `false` on ANY failure (network throw or a
 * non-ok status). It must NEVER reject — the wrapper wraps `fetch` in try/catch — so the state machine's
 * `.then` handler always runs (a failure rolls the card back rather than dropping it silently).
 */
export type DeleteCommit = (id: string, opts: { keepalive: boolean }) => Promise<boolean>;

/**
 * Whether a `DELETE /api/lesson/[id]` response CONFIRMS `id` was actually removed, per the route's
 * documented contract (`{ deleted: string[] }`, ALWAYS 200 — empty on a no-op: already-deleted or
 * not-owned, #199's no-existence-oracle design). Pure + exported so the confirmed-vs-no-op distinction the
 * wrapper's `commit` reads off the parsed response body is unit-tested here (the pure core) rather than
 * left covered only by a network-dependent integration test. A malformed/absent body reads as `false` (not
 * confirmed) — the same conservative default a genuine no-op produces.
 */
export function isConfirmedDelete(id: string, body: unknown): boolean {
  if (body === null || typeof body !== 'object') return false;
  const deleted = (body as { deleted?: unknown }).deleted;
  return Array.isArray(deleted) && deleted.includes(id);
}

/**
 * Whether a `POST /api/lessons/restore` response CONFIRMS `id` was actually restored, per the route's
 * documented contract (`{ restored: string[] }`, ALWAYS 200 — empty on a no-op: already-restored,
 * foreign-owner, or not-currently-deleted id; `restore()` in `src/store/repo.ts`). MIRRORS
 * `isConfirmedDelete` above (same shape, same conservative false-on-malformed default) so the
 * Recently-deleted shelf's `RestoreCard` (`src/app/recently-deleted/restore-controls.tsx`) can tell a
 * genuine restore from a no-op it should reconcile against server truth, rather than trusting a bare
 * `res.ok` (a 200 no-op is NOT a confirmed restore).
 */
export function isConfirmedRestore(id: string, body: unknown): boolean {
  if (body === null || typeof body !== 'object') return false;
  const restored = (body as { restored?: unknown }).restored;
  return Array.isArray(restored) && restored.includes(id);
}

/** One card the user can still Undo (collapsed but recoverable). */
export interface PendingDelete {
  id: string;
  title: string;
}

/** The immutable snapshot the wrapper renders React state from (emitted on every state change). */
export interface DeleteSnapshot {
  /** Every id with a tracked dwell (collapsed, incl. a commit in flight), oldest→newest — the card
   *  collapse/`inert` set. */
  pending: PendingDelete[];
  /** The most-recent UNDOABLE pending delete — what the single bottom snackbar reflects (null = no
   *  snackbar). Excludes a committing entry (its undo window is over) and a dismissed one. */
  surfaced: PendingDelete | null;
  /** Whether the surfaced dwell is paused (the snackbar is hovered or keyboard-focused). */
  paused: boolean;
  /** The card whose commit just FAILED and must show the recoverable error chip (null = none). */
  failed: PendingDelete | null;
}

export interface DeferredDeleteOptions {
  clock: DeleteClock;
  commit: DeleteCommit;
  /** Re-render hook — called with a fresh snapshot on every state change. */
  onChange: (snapshot: DeleteSnapshot) => void;
  /** The standing-live-region writer (the wrapper makes it re-announce-safe). Optional so the module
   *  unit-tests without it. */
  announce?: (message: string) => void;
  /** The wrapper's `router.refresh()` — called ONLY after a commit RESOLVES ok, never on the timer alone. */
  onReconcile?: () => void;
  /** The undo dwell, ms (default 6000 — the owner-locked single-delete dwell). */
  dwellMs?: number;
}

/** The standing-region announcement copy (user-facing — no internals). */
export const ANNOUNCE_DELETED = 'Lesson deleted, Undo available';
export const ANNOUNCE_RESTORED = 'Lesson restored';

const DEFAULT_DWELL_MS = 6000;

/** The longest title that still makes a clean `Delete {title}` accessible name; past it (or when blank)
 *  the label degrades to the generic copy. Pure + exported so the chip's aria-label unit-tests. */
const DELETE_LABEL_MAX = 80;

/**
 * The delete chip's accessible name: `Delete {title}`, degrading to `Delete this lesson` when the title is
 * blank or too long for clean copy (a runaway title makes a clumsy label). No internals ever leak. Pure.
 */
export function deleteLabel(title: string | null | undefined): string {
  const trimmed = (title ?? '').trim();
  if (trimmed.length === 0 || trimmed.length > DELETE_LABEL_MAX) return 'Delete this lesson';
  return `Delete ${trimmed}`;
}

/** Internal per-card bookkeeping. */
interface Entry {
  id: string;
  title: string;
  /** Monotonic insertion order — `surfaced` is the max-`seq` undoable entry. */
  seq: number;
  /** The live dwell-timer handle (null while paused or after it has fired). */
  timer: unknown;
  /** Dwell remaining when (re)started, ms — recomputed on pause so resume restarts the remainder. */
  remainingMs: number;
  /** `clock.now()` when the current timer leg started (for the pause-elapsed math). */
  startedAt: number;
  /** EXACTLY-ONCE guard: set the instant a commit is invoked (timer OR pagehide), checked by both. */
  committed: boolean;
  /** The surfaced dwell is paused (snackbar hovered/focused) — only the surfaced id is ever paused. */
  paused: boolean;
  /** The snackbar was dismissed for this entry: it leaves `surfaced` but the dwell keeps running to its
   *  commit (Undo cancels a delete; Dismiss only hides the toast). */
  dismissed: boolean;
}

/**
 * The deferred-commit controller. Holds the pending-delete set + their independent dwell timers, owns the
 * exactly-once commit bookkeeping, and emits an immutable {@link DeleteSnapshot} on every change. All I/O
 * (timers, network, reconcile, announce) is injected, so the whole lifecycle is node-testable.
 */
export class DeferredDeleteController {
  private readonly clock: DeleteClock;
  private readonly commit: DeleteCommit;
  private readonly onChange: (snapshot: DeleteSnapshot) => void;
  private readonly announceFn: ((message: string) => void) | undefined;
  private readonly onReconcile: (() => void) | undefined;
  private readonly dwellMs: number;

  private readonly entries = new Map<string, Entry>();
  private failed: PendingDelete | null = null;
  private seqCounter = 0;

  constructor(opts: DeferredDeleteOptions) {
    this.clock = opts.clock;
    this.commit = opts.commit;
    this.onChange = opts.onChange;
    this.announceFn = opts.announce;
    this.onReconcile = opts.onReconcile;
    this.dwellMs = opts.dwellMs ?? DEFAULT_DWELL_MS;
  }

  /** Schedule a deferred delete: mark the id pending, start its independent 6s dwell, surface the
   *  snackbar, and announce. Sends NO network. Re-scheduling an already-pending id is a no-op. */
  schedule(id: string, title: string): void {
    if (this.entries.has(id)) return;
    // A fresh delete supersedes a stale failure chip.
    this.failed = null;
    const entry: Entry = {
      id,
      title,
      seq: ++this.seqCounter,
      timer: null,
      remainingMs: this.dwellMs,
      startedAt: this.clock.now(),
      committed: false,
      paused: false,
      dismissed: false,
    };
    this.entries.set(id, entry);
    this.startTimer(entry);
    this.announceFn?.(ANNOUNCE_DELETED);
    this.emit();
  }

  /** Undo a specific pending delete: cancel its dwell, un-mark the id, announce restored — the injected
   *  commit fn is NEVER called, so no `DELETE` is ever sent for it. No-op if not pending or already
   *  committing (the undo window has closed). */
  undo(id: string): void {
    const entry = this.entries.get(id);
    if (!entry || entry.committed) return;
    this.clearTimer(entry);
    this.entries.delete(id);
    this.announceFn?.(ANNOUNCE_RESTORED);
    this.emit();
  }

  /** Undo the most-recent UNDOABLE pending delete (the `Ctrl/Cmd+Z` + snackbar-Undo target). */
  undoMostRecent(): void {
    const entry = this.mostRecentUndoable();
    if (entry) this.undo(entry.id);
  }

  /** Whether any delete is still pending (incl. a commit in flight) — the `Ctrl/Cmd+Z` guard so the
   *  chord is only swallowed when there is something to undo. */
  hasPending(): boolean {
    for (const e of this.entries.values()) if (!e.committed) return true;
    return false;
  }

  /** Dismiss the surfaced snackbar WITHOUT undoing: hide the toast but let the dwell run to its commit.
   *  (Undo cancels a delete; Dismiss only hides the affordance.) */
  dismissSurfaced(): void {
    const entry = this.surfacedEntry();
    if (!entry) return;
    entry.dismissed = true;
    this.emit();
  }

  /** Clear the recoverable error chip (the wrapper's Dismiss on the failure surface). */
  dismissFailed(): void {
    if (!this.failed) return;
    this.failed = null;
    this.emit();
  }

  /** Pause/resume the SURFACED dwell only (the snackbar is hovered or keyboard-focused). Each non-surfaced
   *  id keeps counting down independently. */
  setSurfacedPaused(paused: boolean): void {
    const entry = this.surfacedEntry();
    if (!entry || entry.paused === paused) return;
    if (paused) {
      // Bank the remaining time and stop the clock.
      const elapsed = this.clock.now() - entry.startedAt;
      entry.remainingMs = Math.max(0, entry.remainingMs - elapsed);
      this.clearTimer(entry);
      entry.paused = true;
    } else {
      entry.paused = false;
      this.startTimer(entry);
    }
    this.emit();
  }

  /** The `pagehide` flush: commit EVERY still-pending (not-yet-committed) id exactly once via the SAME
   *  bookkeeping, with `keepalive: true` so the in-flight `DELETE` survives the unload. Does not reconcile
   *  (the document is going away). */
  flushPending(): void {
    for (const entry of this.entries.values()) {
      if (!entry.committed) this.commitEntry(entry, true);
    }
  }

  /** A fresh immutable snapshot (also the React initial-state shape via {@link emptySnapshot}). */
  snapshot(): DeleteSnapshot {
    const ordered = [...this.entries.values()].sort((a, b) => a.seq - b.seq);
    const surfaced = this.surfacedEntry();
    return {
      pending: ordered.map((e) => ({ id: e.id, title: e.title })),
      surfaced: surfaced ? { id: surfaced.id, title: surfaced.title } : null,
      paused: surfaced?.paused ?? false,
      failed: this.failed,
    };
  }

  // ── internals ────────────────────────────────────────────────────────────────────────────────────

  /** Commit an entry exactly once. The `committed` check-and-set is the single exactly-once gate both the
   *  timer expiry and the pagehide flush pass through. On resolve: ok → drop the card + reconcile; fail →
   *  re-expand the card + raise the error chip. */
  private commitEntry(entry: Entry, keepalive: boolean): void {
    if (entry.committed) return;
    entry.committed = true;
    this.clearTimer(entry);
    void this.commit(entry.id, { keepalive }).then((ok) => {
      // The entry may already be gone (a defensive guard against a stale resolve).
      if (this.entries.get(entry.id) !== entry) return;
      this.entries.delete(entry.id);
      if (ok) {
        this.onReconcile?.();
      } else {
        // Recoverable failure: the card re-expands (it left `entries`) and the error chip is raised.
        this.failed = { id: entry.id, title: entry.title };
      }
      this.emit();
    });
    // The card stays collapsed (still in `entries`) until the commit resolves; the snackbar drops now
    // (a committing entry is excluded from `surfaced`).
    this.emit();
  }

  private startTimer(entry: Entry): void {
    entry.startedAt = this.clock.now();
    entry.timer = this.clock.setTimeout(() => {
      entry.timer = null;
      this.commitEntry(entry, false);
    }, entry.remainingMs);
  }

  private clearTimer(entry: Entry): void {
    if (entry.timer != null) {
      this.clock.clearTimeout(entry.timer);
      entry.timer = null;
    }
  }

  /** The most-recent entry whose undo window is still open (not committing) — the snackbar/`Ctrl+Z`
   *  target, regardless of dismiss. */
  private mostRecentUndoable(): Entry | null {
    let best: Entry | null = null;
    for (const e of this.entries.values()) {
      if (e.committed) continue;
      if (!best || e.seq > best.seq) best = e;
    }
    return best;
  }

  /** The entry the single snackbar reflects: most-recent, not committing, not dismissed. */
  private surfacedEntry(): Entry | null {
    let best: Entry | null = null;
    for (const e of this.entries.values()) {
      if (e.committed || e.dismissed) continue;
      if (!best || e.seq > best.seq) best = e;
    }
    return best;
  }

  private emit(): void {
    this.onChange(this.snapshot());
  }
}

/** The empty snapshot — the wrapper's React initial state. */
export function emptySnapshot(): DeleteSnapshot {
  return { pending: [], surfaced: null, paused: false, failed: null };
}
