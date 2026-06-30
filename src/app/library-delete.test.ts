import { describe, expect, it, vi } from 'vitest';
import {
  ANNOUNCE_DELETED,
  ANNOUNCE_RESTORED,
  DeferredDeleteController,
  deleteLabel,
  emptySnapshot,
  type DeleteClock,
  type DeleteSnapshot,
} from './library-delete';

// ── The card single-delete deferred-commit state machine (issue #201) ────────────────────────────────
// The race-prone concurrency (schedule / cancel / commit / pagehide-flush / failure-rollback / reconcile)
// is factored into this PURE module with an INJECTABLE clock + commit fn (the library-morph.ts /
// lesson-message.ts precedent), so the three guarantees the plan review required are proven HERE — not
// punted to #206's browser specs: (a) the commit fires EXACTLY ONCE across the timer-expiry-vs-pagehide
// race; (b) Undo within the dwell sends ZERO network; (c) a failed commit rolls the card back.

/** A controllable fake clock — no real timers, so the 6s dwell + pause/resume are deterministic. */
function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { fn: () => void; at: number }>();
  return {
    setTimeout(fn: () => void, ms: number) {
      const id = nextId++;
      timers.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimeout(handle: unknown) {
      timers.delete(handle as number);
    },
    now() {
      return now;
    },
    /** Advance the clock, firing every timer whose deadline has passed (earliest first). */
    advance(ms: number) {
      now += ms;
      const due = [...timers.entries()]
        .filter(([, t]) => t.at <= now)
        .sort((a, b) => a[1].at - b[1].at);
      for (const [id, t] of due) {
        timers.delete(id);
        t.fn();
      }
    },
    pending() {
      return timers.size;
    },
  } satisfies DeleteClock & { advance(ms: number): void; pending(): number };
}

/** Flush the microtask queue so a resolved commit's `.then` handler runs (uses the REAL event loop — the
 *  fake clock only governs the dwell timers). */
const flush = () => new Promise((r) => setTimeout(r, 0));

/** A controller wired to a fake clock + a spy commit, capturing the latest emitted snapshot. */
function makeController(commit = vi.fn(async () => true)) {
  const clock = fakeClock();
  const onChange = vi.fn();
  const announce = vi.fn();
  const onReconcile = vi.fn();
  let latest: DeleteSnapshot = emptySnapshot();
  onChange.mockImplementation((s: DeleteSnapshot) => {
    latest = s;
  });
  const controller = new DeferredDeleteController({
    clock,
    commit,
    onChange,
    announce,
    onReconcile,
    dwellMs: 6000,
  });
  return {
    controller,
    clock,
    commit,
    announce,
    onReconcile,
    snapshot: () => latest,
  };
}

describe('deleteLabel — the chip accessible name (no internals; degrades for runaway titles)', () => {
  it('is "Delete {title}" for a clean title', () => {
    expect(deleteLabel('Photosynthesis')).toBe('Delete Photosynthesis');
  });
  it('degrades to "Delete this lesson" for a blank title', () => {
    expect(deleteLabel('   ')).toBe('Delete this lesson');
    expect(deleteLabel('')).toBe('Delete this lesson');
    expect(deleteLabel(null)).toBe('Delete this lesson');
  });
  it('degrades to "Delete this lesson" for a title too long for clean copy', () => {
    expect(deleteLabel('x'.repeat(200))).toBe('Delete this lesson');
  });
});

describe('schedule — zero network at t=0, card collapses, snackbar + announce', () => {
  it('marks the id pending and surfaces the snackbar WITHOUT any network call', () => {
    const { controller, commit, snapshot, announce } = makeController();
    controller.schedule('a', 'Alpha');
    expect(commit).not.toHaveBeenCalled(); // NO network at t=0
    expect(snapshot().pending.map((p) => p.id)).toEqual(['a']);
    expect(snapshot().surfaced).toEqual({ id: 'a', title: 'Alpha' });
    expect(announce).toHaveBeenCalledWith(ANNOUNCE_DELETED);
  });

  it('is a no-op for an already-pending id (no duplicate timer / re-announce)', () => {
    const { controller, snapshot, announce } = makeController();
    controller.schedule('a', 'Alpha');
    controller.schedule('a', 'Alpha again');
    expect(snapshot().pending).toHaveLength(1);
    expect(announce).toHaveBeenCalledTimes(1);
  });
});

describe('(b) Undo within the dwell sends ZERO network and re-expands the card', () => {
  it('cancels the pending timer, un-marks the id, announces restored, never commits', async () => {
    const { controller, clock, commit, snapshot, announce } = makeController();
    controller.schedule('a', 'Alpha');
    clock.advance(3000); // mid-dwell
    controller.undo('a');
    expect(snapshot().pending).toEqual([]); // re-expanded
    expect(snapshot().surfaced).toBeNull(); // snackbar gone
    expect(announce).toHaveBeenLastCalledWith(ANNOUNCE_RESTORED);
    // Even after the original deadline passes + a pagehide flush, the commit fn is NEVER invoked.
    clock.advance(6000);
    controller.flushPending();
    await flush();
    expect(commit).not.toHaveBeenCalled();
  });

  it('undoMostRecent targets the most-recent pending delete (Ctrl/Cmd+Z + snackbar Undo)', () => {
    const { controller, snapshot } = makeController();
    controller.schedule('a', 'Alpha');
    controller.schedule('b', 'Bravo');
    controller.undoMostRecent(); // undoes 'b' (newest)
    expect(snapshot().pending.map((p) => p.id)).toEqual(['a']);
    expect(snapshot().surfaced).toEqual({ id: 'a', title: 'Alpha' });
  });
});

describe('(a) commit fires EXACTLY ONCE across the timer-expiry-vs-pagehide race', () => {
  it('timer expiry first, then pagehide flush → ONE commit (keepalive:false)', async () => {
    const { controller, clock, commit } = makeController();
    controller.schedule('a', 'Alpha');
    clock.advance(6000); // dwell expires → commit once
    controller.flushPending(); // 'a' already committed → no second commit
    await flush();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith('a', { keepalive: false });
  });

  it('pagehide flush first, then timer expiry → ONE commit (keepalive:true)', async () => {
    const { controller, clock, commit } = makeController();
    controller.schedule('a', 'Alpha');
    controller.flushPending(); // commits once via keepalive
    clock.advance(6000); // the timer is already cleared by the commit; no second call
    await flush();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith('a', { keepalive: true });
  });

  it('reconciles (router.refresh) ONLY after the commit resolves, never on the timer alone', async () => {
    const { controller, clock, onReconcile } = makeController();
    controller.schedule('a', 'Alpha');
    clock.advance(6000);
    expect(onReconcile).not.toHaveBeenCalled(); // timer fired, commit not yet resolved
    await flush();
    expect(onReconcile).toHaveBeenCalledTimes(1); // only after the DELETE resolved
  });

  it('on commit the snackbar drops immediately but the card stays collapsed until it resolves', async () => {
    let resolveCommit!: (ok: boolean) => void;
    const commit = vi.fn(
      () => new Promise<boolean>((res) => { resolveCommit = res; }),
    );
    const { controller, clock, snapshot } = makeController(commit);
    controller.schedule('a', 'Alpha');
    clock.advance(6000); // committing — undo window closed
    expect(snapshot().surfaced).toBeNull(); // snackbar gone the instant it commits
    expect(snapshot().pending.map((p) => p.id)).toEqual(['a']); // card still collapsed
    resolveCommit(true);
    await flush();
    expect(snapshot().pending).toEqual([]); // dropped after the DELETE resolved
  });
});

describe('(c) a failed commit rolls the card back to its expanded state + raises the error chip', () => {
  it('re-expands the card and surfaces the recoverable error chip on a failed DELETE', async () => {
    const commit = vi.fn(async () => false); // the DELETE fails
    const { controller, clock, snapshot } = makeController(commit);
    controller.schedule('a', 'Alpha');
    clock.advance(6000);
    await flush();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(snapshot().pending).toEqual([]); // card re-expanded (no longer collapsed)
    expect(snapshot().failed).toEqual({ id: 'a', title: 'Alpha' }); // error chip raised
  });

  it('a new schedule clears a stale failure chip; dismissFailed clears it too', async () => {
    const commit = vi.fn(async () => false);
    const { controller, clock, snapshot } = makeController(commit);
    controller.schedule('a', 'Alpha');
    clock.advance(6000);
    await flush();
    expect(snapshot().failed).not.toBeNull();
    controller.dismissFailed();
    expect(snapshot().failed).toBeNull();
  });
});

describe('pause/resume — only the surfaced dwell pauses; the commit then fires once on resume+expiry', () => {
  it('does not commit while paused, then commits once after resuming and expiring', async () => {
    const { controller, clock, commit, snapshot } = makeController();
    controller.schedule('a', 'Alpha');
    clock.advance(2000); // 4s left
    controller.setSurfacedPaused(true);
    expect(snapshot().paused).toBe(true);
    clock.advance(100000); // a long hover — paused, so NO commit
    expect(commit).not.toHaveBeenCalled();
    controller.setSurfacedPaused(false); // resume with ~4s remaining
    clock.advance(3999);
    expect(commit).not.toHaveBeenCalled();
    clock.advance(1); // remainder elapses
    await flush();
    expect(commit).toHaveBeenCalledTimes(1);
  });
});

describe('N>1 — independent dwells under one snackbar; pagehide commits every pending id once', () => {
  it('flushes every still-pending id exactly once (keepalive) and surfaces the newest', async () => {
    const { controller, clock, commit, snapshot } = makeController();
    controller.schedule('a', 'Alpha');
    controller.schedule('b', 'Bravo');
    expect(snapshot().surfaced).toEqual({ id: 'b', title: 'Bravo' }); // single snackbar = most recent
    controller.flushPending();
    clock.advance(6000); // both already committed by the flush
    await flush();
    expect(commit).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenCalledWith('a', { keepalive: true });
    expect(commit).toHaveBeenCalledWith('b', { keepalive: true });
  });

  it('dismiss hides the surfaced snackbar but lets the dwell run to its single commit', async () => {
    const { controller, clock, commit, snapshot } = makeController();
    controller.schedule('a', 'Alpha');
    controller.dismissSurfaced();
    expect(snapshot().surfaced).toBeNull(); // toast hidden
    expect(snapshot().pending.map((p) => p.id)).toEqual(['a']); // still collapsed/pending
    clock.advance(6000);
    await flush();
    expect(commit).toHaveBeenCalledTimes(1); // Dismiss ≠ Undo: the delete still commits
  });
});
