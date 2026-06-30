'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * The library home's shared selection / pending-delete context + the ONE standing ARIA live region — the
 * architecture-only seam the lesson-deletion epic hangs its interactive pieces on (issue #200).
 *
 * Three things the delete UI needs that `main` doesn't have:
 *   1. a client context the poster cards AND a future bottom action bar (#203 — NOT a card descendant)
 *      both read selection / pending-delete / selection-mode from, without prop-drilling through
 *      `LibraryCreate`. The undo window outlives a React transition (it's paused on focus), so
 *      `useOptimistic` is the wrong primitive — this is plain shared state instead.
 *   2. ONE pre-mounted, visually-hidden, polite live region `announce()` writes into. It must be STANDING
 *      (in the DOM on first render) — assistive tech does not reliably announce a region that mounts at
 *      the same time as its first message, which is exactly why the announcement channel is a single
 *      region here rather than a freshly-mounted snackbar region.
 *
 * #200 establishes the seam with ZERO user-facing behavior: the sets are empty, `selectionMode` is false,
 * and NO code path mutates them (the setters land with the behavior in #201 single-delete / #203 bulk).
 * `announce` is wired to the standing region but no handler calls it yet.
 */
interface LibraryContextValue {
  /** Ids of the cards currently selected (bulk multi-select — #203). Empty until a setter is wired. */
  selection: Set<string>;
  /** Ids in the deferred-commit "pending delete" collapse window (#201/#203). Empty until wired. */
  pendingDeleted: Set<string>;
  /** Whether the grid is in multi-select mode (#203). False until a setter is wired. */
  selectionMode: boolean;
  /** Write a message into the ONE standing polite live region (the sole announcement channel). */
  announce: (message: string) => void;
}

const LibraryContext = createContext<LibraryContextValue | null>(null);

/** Read the library selection / pending-delete / announce context. Throws outside a `LibraryProvider`. */
export function useLibrary(): LibraryContextValue {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error('useLibrary must be used within a LibraryProvider');
  return ctx;
}

export function LibraryProvider({ children }: { children: ReactNode }) {
  // The selection / pending-delete / selection-mode state. Held as React state so #201/#203 can add the
  // setters they need; #200 reads the values but wires NO setter, so they never change (sets stay empty,
  // mode stays false) — zero user-facing behavior, baselines byte-unchanged.
  const [selection] = useState<Set<string>>(() => new Set());
  const [pendingDeleted] = useState<Set<string>>(() => new Set());
  const [selectionMode] = useState(false);

  // The single standing live region's message. Updating it re-renders only the region's text content —
  // the region element itself never unmounts, so AT announces reliably. Deliberately NOT part of the
  // memoized context value, so an announcement never re-renders the card consumers.
  const [message, setMessage] = useState('');
  const announce = useCallback((msg: string) => setMessage(msg), []);

  const value = useMemo<LibraryContextValue>(
    () => ({ selection, pendingDeleted, selectionMode, announce }),
    [selection, pendingDeleted, selectionMode, announce],
  );

  return (
    <LibraryContext.Provider value={value}>
      {children}
      {/* The ONE standing, visually-hidden polite live region. Mounted unconditionally on first render
          (never lazily alongside its first message) and clipped to 1px so it occupies no layout space and
          cannot shift the card grid (mirrors `.gen-sr` / `.build-summary__sr`). */}
      <div className="library-live" role="status" aria-live="polite" aria-atomic="true">
        {message}
      </div>
    </LibraryContext.Provider>
  );
}
