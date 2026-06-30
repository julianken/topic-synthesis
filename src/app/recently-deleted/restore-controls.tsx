'use client';

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

/**
 * The Recently-deleted shelf's CLIENT interaction layer (#204) — the ONLY `'use client'` code on the
 * surface; the `/recently-deleted` route component itself stays a server component (it owns the auth gate
 * + the owner-scoped `listDeletedLessons` read, off the client).
 *
 * Two pieces, co-located here:
 *   - `RestoreShelf` — wraps the SERVER-rendered card grid and pre-mounts the TWO standing live regions
 *     (a polite `role="status"` for "Lesson restored" and a `role="alert"` for failure). They are mounted
 *     ONCE on first render (never freshly per announce — assistive tech does not reliably announce a region
 *     that mounts together with its first message), and announcements clear-then-set so even a repeat of
 *     the same string re-triggers the region. It hands `announce`/`announceError` down via context.
 *   - `RestoreCard` — the per-card unit (the `<li>` + the "Deleted …" stamp + the Restore control). It
 *     receives the card's wash + head as SERVER-rendered `ReactNode` props (so the eyebrow/title/desc copy
 *     stays server-rendered), POSTs `{ ids:[id] }` to the #199 `POST /api/lessons/restore` route, and
 *     RECONCILES ITS OWN CARD: on success it collapses + unmounts and announces "Lesson restored"; on
 *     failure it surfaces "Couldn't restore — try again", runs the failure shake, and LEAVES the card.
 *
 * Restore is a POSITIVE, interactive affordance (never destructive): label + arrow glyph in `--accent`,
 * conveyed by BOTH the word and the icon (never color alone — DESIGN.md §Accessibility). The shelf cards
 * carry no view-transition morph name, so they never contend with the card→reader FLIP morph.
 */

interface RestoreAnnounce {
  /** Write into the standing polite `role="status"` region (a successful restore). */
  announce: (message: string) => void;
  /** Write into the standing `role="alert"` region (a failed restore). */
  announceError: (message: string) => void;
}

const RestoreContext = createContext<RestoreAnnounce | null>(null);

function useRestoreAnnounce(): RestoreAnnounce {
  const ctx = useContext(RestoreContext);
  if (!ctx) throw new Error('useRestoreAnnounce must be used within a RestoreShelf');
  return ctx;
}

export function RestoreShelf({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState('');
  const [alert, setAlert] = useState('');

  // Clear-then-set so a repeated identical message (e.g. two "Lesson restored" in a row) still mutates the
  // region's text and re-announces; the region element itself never unmounts (standing).
  const announce = useCallback((message: string) => {
    setStatus('');
    requestAnimationFrame(() => setStatus(message));
  }, []);
  const announceError = useCallback((message: string) => {
    setAlert('');
    requestAnimationFrame(() => setAlert(message));
  }, []);

  return (
    <RestoreContext.Provider value={{ announce, announceError }}>
      {children}
      {/* The TWO standing, visually-hidden live regions — pre-mounted ONCE (mirrors `.library-live` /
          `.gen-sr`): no layout space, so they can never shift the shelf grid. */}
      <div className="shelf-sr" role="status" aria-live="polite" aria-atomic="true">
        {status}
      </div>
      <div className="shelf-sr" role="alert" aria-atomic="true">
        {alert}
      </div>
    </RestoreContext.Provider>
  );
}

/** The undo / restore arrow glyph — a counter-clockwise curved arrow (decorative; the word "Restore" + the
 *  `aria-label` carry the meaning). Drawn in `currentColor` so the button's `--accent` color drives it. */
function UndoMark() {
  return (
    <svg
      className="shelf-restore__icon"
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      {/* a ¾ arc sweeping back to the start, with an arrowhead at the tail — the "undo" motif */}
      <path
        d="M4.6 6.0 A4.2 4.2 0 1 1 3.9 9.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M2.1 3.0 L4.7 6.2 L1.4 6.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function RestoreCard({
  id,
  title,
  index,
  deletedLabel,
  wash,
  head,
}: {
  id: string;
  title: string;
  index: number;
  deletedLabel: string;
  wash: ReactNode;
  head: ReactNode;
}) {
  const { announce, announceError } = useRestoreAnnounce();
  // idle → (success) restoring → gone ; (failure) idle (with a transient `error` flag for the shake).
  const [phase, setPhase] = useState<'idle' | 'restoring' | 'gone'>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const onRestore = useCallback(async () => {
    if (busy || phase !== 'idle') return;
    setBusy(true);
    setError(false);
    try {
      const res = await fetch('/api/lessons/restore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: [id] }),
      });
      if (!res.ok) throw new Error(`restore failed (${String(res.status)})`);
      // Success — announce, then collapse the card out (the global reduced-motion guard zeroes the
      // collapse so it removes instantly there, but the affordance/announcement still happens).
      announce('Lesson restored');
      setPhase('restoring');
    } catch {
      // Failure — surface the alert, run the shake, and LEAVE the card in place so the user can retry.
      announceError("Couldn't restore — try again");
      setError(true);
      setBusy(false);
    }
  }, [busy, phase, id, announce, announceError]);

  if (phase === 'gone') return null;

  const className = [
    'shelf-poster',
    phase === 'restoring' ? 'shelf-poster--restoring' : '',
    error ? 'shelf-poster--error' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li
      className={className}
      style={{ '--rail-i': index } as CSSProperties}
      onAnimationEnd={(e) => {
        // Only react to the collapse animation (its name carries "shelf-restore"); the entrance
        // `rail-reveal` bubbling up during `idle` is ignored, and the shake ends back at idle.
        if (phase === 'restoring' && e.animationName.includes('shelf-restore')) setPhase('gone');
        else if (error && e.animationName.includes('shelf-shake')) setError(false);
      }}
    >
      <div className="shelf-poster__card">
        {wash}
        <div className="library-poster__body">
          {head}
          <div className="shelf-poster__foot">
            <span className="shelf-poster__stamp">{deletedLabel}</span>
            <button
              type="button"
              className="shelf-restore"
              aria-label={`Restore ${title}`}
              disabled={busy}
              onClick={onRestore}
            >
              <UndoMark />
              <span className="shelf-restore__label">{busy ? 'Restoring…' : 'Restore'}</span>
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}
