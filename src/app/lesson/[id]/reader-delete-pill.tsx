'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { runViewTransition } from '../../library-morph';
import { TrashMark } from '../../poster-mark';
import { writeUndoHandoff } from '../../undo-handoff';
import { performReaderDelete } from './reader-delete';

/**
 * The reader's quiet delete affordance (issue #202) — an icon-only pill in `.ws-topbar__right`,
 * immediately left of the user pill, gated by a non-modal `role="dialog"` confirm popover. Reuses the
 * committed `TrashMark` glyph (`poster-mark.tsx`, #201's card delete chip) so the delete vocabulary reads
 * consistently across the library card and the reader.
 *
 * Unlike the library card's zero-confirm DEFERRED-commit (#201) — which can optimistically collapse the
 * card in place because there's still a grid to reconcile — the reader is COMMITTED-then-restore: there is
 * no card here, and the user is about to LEAVE the document, so the popover asks first, then `await`s the
 * soft-delete before doing anything else. On a confirmed 2xx: a same-document RECEDE (gated by
 * `vtOff()`/`runViewTransition`, `library-morph.ts` — the exact mechanism the create-form flow already
 * uses; NOT `reader-morph-guard.ts`'s preference-only guard, which serves the automatic CROSS-document
 * card↔reader morph and would throw a scripted call on a browser with no View-Transition API), then the
 * read-once `undo-handoff.ts` write, then a CLIENT `router.push('/')` (never a full-document nav — a soft
 * nav sidesteps the cross-document `@view-transition` transport entirely, so it never pairs the reader
 * panel against the now-missing card). The library's `LibraryProvider` picks the handoff up on mount and
 * offers a restore-mode Undo snackbar (`POST /api/lessons/restore`, not a timer cancel).
 *
 * The delete/recede/handoff/navigate SEQUENCING lives in the pure, node-tested `performReaderDelete`
 * (`reader-delete.ts`); this component is the thin wiring layer + the popover's DOM behavior (focus
 * management, Esc, outside-click) — mirroring the `library-create.tsx` / `LibraryProvider` split.
 */
export function ReaderDeletePill({ id, scrollProgress }: { id: string; scrollProgress: number }) {
  const router = useRouter();
  const [phase, setPhase] = useState<'closed' | 'open' | 'closing'>('closed');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pillRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  // The reader's live posted scroll position, read at confirm-time (not open-time) so a late-arriving
  // postMessage between open and confirm is still carried into the handoff.
  const scrollProgressRef = useRef(scrollProgress);
  scrollProgressRef.current = scrollProgress;

  const open = useCallback(() => {
    setError(null);
    setPhase('open');
  }, []);

  const requestClose = useCallback(() => {
    // Guarded against a request in flight: Esc / outside-click / Cancel are inert while `deleting` — the
    // popover (and its role="alert" retry surface, AC23) must stay put until the request resolves.
    if (deleting) return;
    setPhase((p) => (p === 'open' ? 'closing' : p));
  }, [deleting]);

  // Focus → Cancel on open (AC12).
  useEffect(() => {
    if (phase === 'open') cancelRef.current?.focus();
  }, [phase]);

  // Esc + outside-click close the popover while it's open (AC13/AC14) — not while deleting is in flight
  // for outside-click, so an accidental stray click can't abandon a request already underway; Esc still
  // works (dismissing the affordance, the request continues either way — router.push fires on success).
  useEffect(() => {
    if (phase !== 'open') return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        requestClose();
      }
    }
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node | null;
      if (popoverRef.current?.contains(target) || pillRef.current?.contains(target)) return;
      requestClose();
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [phase, requestClose]);

  const onPopoverAnimationEnd = useCallback((e: React.AnimationEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return; // ignore a bubbled child animation
    setPhase((p) => {
      if (p !== 'closing') return p;
      pillRef.current?.focus();
      return 'closed';
    });
  }, []);

  const confirmDelete = useCallback(async () => {
    if (deleting) return;
    setDeleting(true);
    setError(null);
    const ok = await performReaderDelete(id, scrollProgressRef.current, {
      deleteLesson: async (lessonId) => {
        try {
          const res = await fetch(`/api/lesson/${encodeURIComponent(lessonId)}`, { method: 'DELETE' });
          return res.ok;
        } catch {
          return false;
        }
      },
      recede: () =>
        runViewTransition(() => {
          // A quiet same-document fade before the soft-nav swaps the route (globals.css
          // `body.ws-reader-receding .reader--ws`) — gated entirely by vtOff()/runViewTransition, so
          // reduced motion / no VT API applies the class synchronously with no animation (AC20).
          document.body.classList.add('ws-reader-receding');
        }, ['reader-delete']),
      writeHandoff: (lessonId, sp) => writeUndoHandoff({ id: lessonId, scrollProgress: sp }),
      navigate: () => router.push('/'),
    }).catch(() => false); // defensive: performReaderDelete only throws if deleteLesson rejects, which
    // the wrapper above never does — this belt-and-suspenders catch keeps a truly unexpected throw from
    // ever reaching an unhandled rejection instead of the retry UI.
    if (!ok) {
      setDeleting(false);
      setError("Couldn't delete — try again");
      // Keep the popover open + usable to retry (AC23) — focus stays put, no phase change.
    }
    // On success the component is about to unmount (router.push swaps the route) — no further state.
  }, [deleting, id, router]);

  return (
    <div className="ws-topbar__delete-wrap">
      <button
        ref={pillRef}
        type="button"
        className="ws-topbar__delete"
        aria-label="Delete lesson"
        aria-haspopup="dialog"
        aria-expanded={phase !== 'closed'}
        onClick={() => (phase === 'closed' ? open() : requestClose())}
      >
        <TrashMark />
      </button>

      {phase !== 'closed' ? (
        <div
          ref={popoverRef}
          className="ws-topbar__confirm"
          data-closing={phase === 'closing' || undefined}
          role="dialog"
          aria-labelledby="ws-confirm-title"
          aria-describedby="ws-confirm-body"
          onAnimationEnd={onPopoverAnimationEnd}
        >
          <p id="ws-confirm-title" className="ws-topbar__confirm-title">
            Delete this lesson?
          </p>
          <p id="ws-confirm-body" className="ws-topbar__confirm-body">
            {"You'll go back to your library — find it in Recently deleted."}
          </p>
          <div className="ws-topbar__confirm-actions">
            {/* `aria-disabled`, NOT the native `disabled` attribute (#202-review FIX, mirroring #221's
                `restore-controls.tsx` fix for the identical bug): disabling a FOCUSED element force-moves
                `document.activeElement` to `<body>` the instant it's set, and both Cancel and Delete can be
                focused (Cancel via the open-time AC12 autofocus, Delete via Tab) when a click sets
                `deleting`. `aria-disabled` keeps each button focusable + in the a11y tree; the `deleting`
                early-return already at the top of `requestClose`/`confirmDelete` is what actually blocks
                re-entry (aria-disabled alone doesn't suppress clicks). */}
            <button
              ref={cancelRef}
              type="button"
              className="ws-topbar__confirm-cancel"
              onClick={requestClose}
              aria-disabled={deleting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => void confirmDelete()}
              aria-disabled={deleting}
            >
              <TrashMark />
              Delete
            </button>
          </div>
          {error ? (
            <p className="ws-topbar__confirm-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
