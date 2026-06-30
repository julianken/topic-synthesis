'use client';

import { useCallback, useRef, type CSSProperties } from 'react';
import type { PendingDelete } from './library-delete';

/**
 * The library's bottom Undo snackbar (issue #201) — the panel-reveal toast for a deferred card delete.
 * Derived from the transitions-dev **panel-reveal** recipe (NOT a toast library, no new keyframe family):
 * it enters via a translateY from a COMPONENT-SCOPED `--panel-translate-y` custom property → 0 at
 * `--dur-base`/`--ease`, and a depleting hairline on `--brand-gradient` tracks the 6s dwell via the §0
 * catalog `--tr-progress` tier — all reduced-motion-zeroed by the global guard.
 *
 * It carries NO `aria-live`/`role="status"` of its own — the provider's ONE standing live region is the
 * sole announcement channel (a freshly-mounted live region is not reliably announced). The dwell PAUSES
 * while the snackbar is hovered or keyboard-focused (the controller owns the timer; this only reports the
 * hover/focus edges). Focus is NOT force-moved here — the Undo button is simply the next focus stop.
 *
 * The single snackbar reflects the MOST-RECENT undoable pending delete (`surfaced`); keying the root on
 * its id restarts the panel-reveal + the depleting hairline when a newer delete supersedes it.
 */
export function LibrarySnackbar({
  surfaced,
  paused,
  dwellMs,
  onUndo,
  onDismiss,
  onPauseChange,
}: {
  surfaced: PendingDelete | null;
  paused: boolean;
  dwellMs: number;
  onUndo: () => void;
  onDismiss: () => void;
  onPauseChange: (paused: boolean) => void;
}) {
  // Track hover + focus independently; the dwell pauses while EITHER holds, resumes only when both clear.
  const hovered = useRef(false);
  const focused = useRef(false);
  const lastPaused = useRef(false);
  const syncPause = useCallback(() => {
    const next = hovered.current || focused.current;
    if (next !== lastPaused.current) {
      lastPaused.current = next;
      onPauseChange(next);
    }
  }, [onPauseChange]);

  if (!surfaced) return null;

  return (
    <div
      key={surfaced.id}
      className="library-snackbar"
      data-paused={paused ? '' : undefined}
      style={{ '--snackbar-dwell': `${dwellMs}ms` } as CSSProperties}
      onMouseEnter={() => {
        hovered.current = true;
        syncPause();
      }}
      onMouseLeave={() => {
        hovered.current = false;
        syncPause();
      }}
      onFocus={() => {
        focused.current = true;
        syncPause();
      }}
      onBlur={(e) => {
        // Only clear when focus leaves the snackbar entirely (not while tabbing Undo → Dismiss).
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          focused.current = false;
          syncPause();
        }
      }}
    >
      {/* The depleting dwell hairline — decorative (aria-hidden); the controller's timer is authoritative.
          It animates over --snackbar-dwell and pauses with the snackbar via [data-paused]; reduced motion
          zeroes the animation (the affordance + timer stay intact). */}
      <span className="library-snackbar__progress" aria-hidden="true" />

      <span className="library-snackbar__label">Lesson deleted</span>
      <button type="button" className="library-snackbar__undo" onClick={onUndo}>
        Undo
      </button>
      <span className="library-snackbar__hint">Find it in Recently deleted</span>
      <button
        type="button"
        className="library-snackbar__dismiss"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}
