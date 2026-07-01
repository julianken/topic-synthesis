'use client';

import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { isConfirmedRestore } from '../library-delete';

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
 *     stays server-rendered), POSTs `{ ids:[id] }` to the #199 `POST /api/lessons/restore` route, and honors
 *     the route's documented no-op contract (`{ restored: string[] }`, ALWAYS 200 — empty on an already-
 *     restored / foreign / not-deleted id) via the pure, tested `isConfirmedRestore` (`library-delete.ts`)
 *     rather than trusting a bare `res.ok`: a CONFIRMED restore (`id` present in `restored[]`) RECONCILES
 *     ITS OWN CARD — collapses + unmounts and announces "Lesson restored", no server round-trip needed; a
 *     NO-OP (still 200, still a success — never the error path) does NOT collapse the card on its own
 *     optimism, and instead calls the SINGLE `router.refresh()` in this component to reconcile the shelf to
 *     server truth (the #204-review FIX 1 single reconcile point — see the comment at its call site); on a
 *     genuine failure (non-2xx / thrown) it surfaces "Couldn't restore — try again", runs the failure
 *     shake, and LEAVES the card.
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

/** The focus destination once a restored card unmounts (never `<body>`): the next/previous LIVE shelf
 *  card's own Restore control, else the "Back to lessons" link, else the shelf heading. Mirrors
 *  `poster-controls.tsx`'s `nextFocusTarget` (#201's library-card delete focus handoff): next → previous →
 *  a page-level fallback → the section heading (made focusable if it isn't already). DOM-only, so it is not
 *  independently unit-testable (same precedent as `poster-controls.tsx`, which carries no test of its own
 *  for this reason); covered by the frontend e2e/a11y suite alongside the rest of the shelf's keyboard path. */
function nextFocusTarget(li: Element): HTMLElement | null {
  const restoreButton = (el: Element): HTMLElement | null =>
    el.querySelector<HTMLElement>('.shelf-restore');
  // A "live" card: still in the DOM, not itself mid-collapse (its own Restore control is about to vanish
  // too if it's already restoring).
  const isLiveCard = (el: Element): boolean =>
    el.classList.contains('shelf-poster') && !el.classList.contains('shelf-poster--restoring');

  for (let sib = li.nextElementSibling; sib; sib = sib.nextElementSibling) {
    if (isLiveCard(sib)) {
      const btn = restoreButton(sib);
      if (btn) return btn;
    }
  }
  for (let prev = li.previousElementSibling; prev; prev = prev.previousElementSibling) {
    if (isLiveCard(prev)) {
      const btn = restoreButton(prev);
      if (btn) return btn;
    }
  }
  // No sibling card left (this was the last one) — the "Back to lessons" link is the natural next stop.
  const back = document.querySelector<HTMLElement>('.shelf__back');
  if (back) return back;
  // Last resort: the shelf heading — make it programmatically focusable so focus never falls to <body>.
  const title = document.querySelector<HTMLElement>('.shelf__title');
  if (title) {
    if (!title.hasAttribute('tabindex')) title.setAttribute('tabindex', '-1');
    return title;
  }
  return null;
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
  const router = useRouter();
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
      // The route ALWAYS replies 200 — even on a no-op (already-restored / foreign / not-deleted id,
      // #199's no-existence-oracle contract, `{ restored: string[] }`). `res.ok` alone can't tell a
      // genuine restore from a no-op, so read the body through the pure, tested `isConfirmedRestore`.
      const body: unknown = await res.json().catch(() => null);
      announce('Lesson restored'); // true either way: the end state (not deleted) holds in both branches.
      if (isConfirmedRestore(id, body)) {
        // Confirmed — THIS request did the restoring. The card's own collapse + unmount already
        // reflects the new state (it leaves the deleted-shelf list); no server round-trip needed.
        setPhase('restoring');
      } else {
        // No-op — trusting bare `res.ok` here would collapse a card that this request did NOT
        // actually restore (a stale/raced click). Don't guess: reconcile the shelf to server truth
        // instead. THIS is the ONE `router.refresh()` call site in this component (FIX 1, #204
        // review) — it fires only on a no-op, never on a confirmed restore (which needs no refresh)
        // and never twice for the same click, so there is no #220-style double-fire. A fresh render
        // then either drops the card (it was already restored elsewhere) or keeps it (still deleted),
        // whichever server truth says — never the client's optimistic guess.
        router.refresh();
        setBusy(false);
      }
    } catch {
      // Failure — surface the alert, run the shake, and LEAVE the card in place so the user can retry.
      announceError("Couldn't restore — try again");
      setError(true);
      setBusy(false);
    }
  }, [busy, phase, id, announce, announceError, router]);

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
        if (phase === 'restoring' && e.animationName.includes('shelf-restore')) {
          // Capture the focus neighbor BEFORE this card unmounts, so focus never falls to <body>
          // (mirrors `poster-controls.tsx`'s delete focus handoff — #201/AC#30 precedent for #204).
          const target = nextFocusTarget(e.currentTarget);
          setPhase('gone');
          // Move focus after the unmount render so the neighbor is mounted + focusable.
          requestAnimationFrame(() => target?.focus());
        } else if (error && e.animationName.includes('shelf-shake')) setError(false);
      }}
    >
      <div className="shelf-poster__card">
        {wash}
        <div className="library-poster__body">
          {head}
          <div className="shelf-poster__foot">
            <span className="shelf-poster__stamp">{deletedLabel}</span>
            {/* `aria-disabled`, NOT the native `disabled` attribute (#204-review FIX A): disabling a
                FOCUSED element force-moves `document.activeElement` to `<body>` the instant it's set,
                stranding focus on the no-op-reconcile and failure paths (the button re-enables in place,
                the card stays) — the same bug the `nextFocusTarget` handoff above fixed for the
                confirmed-restore unmount path, reintroduced here via a different trigger. `aria-disabled`
                keeps the button focusable + in the a11y tree; the `busy` early-return at the top of
                `onRestore` is what actually blocks re-entry (aria-disabled alone doesn't suppress clicks). */}
            <button
              type="button"
              className="shelf-restore"
              aria-label={`Restore ${title}`}
              aria-disabled={busy}
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
