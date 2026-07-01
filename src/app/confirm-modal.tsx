'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * A generic, reusable TRUE modal dialog (issue #203) — the ONE true modal the bulk-delete feature shows:
 * `role="dialog"` + `aria-modal="true"`, `inert` on the rest of the app while open (AC16), focus-trapped
 * (AC17), focus defaults to Cancel on open (AC17), and Esc/Cancel dismiss with no side effect (AC18).
 *
 * The CALLER controls mount/unmount — React-idiomatic: render `<ConfirmModal/>` only while a confirmation
 * is pending, and stop rendering it on Cancel/Confirm. This component owns focus ONLY while it is mounted;
 * post-close focus restoration (AC30 — focus must land on a stable survivor, e.g. the snackbar's Undo
 * button, never the unmounted "Delete {N}" trigger) is the CALLER's job, since only the caller knows what
 * survives the close (this component has no knowledge of the library grid).
 *
 * Portals to `document.body` (transitions-dev "Modal open/close": scale-up from a component-scoped
 * `--modal-scale` + a `color-mix` scrim) — gated on a post-mount flag so the portal never runs during SSR
 * (`document` doesn't exist server-side); the one-tick client-only mount is the standard SSR-safe portal
 * pattern and costs nothing visible (the modal is already interaction-gated on selection state upstream).
 */
export interface ConfirmModalProps {
  title: string;
  body: string;
  confirmLabel: string;
  /** Renders the confirm control as the status-as-foreground danger button (`.btn--danger` — §Color &
   *  contrast: `--err` text/outline over a panel surface, NEVER an `--err` fill). */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ConfirmModal({ title, body, confirmLabel, danger, onConfirm, onCancel }: ConfirmModalProps) {
  const [mounted, setMounted] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Read the latest onCancel through a ref so the keydown listener never has to be re-attached when the
  // caller passes a fresh closure identity (it's set up once, on mount).
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => setMounted(true), []);

  // `inert` every OTHER direct child of <body> while the modal is mounted (AC16 — no focus/pointer reaches
  // the grid/header behind it), restoring exactly what we set on unmount. Defensive: skip anything already
  // inert before we ran (never un-inert something we didn't inert ourselves).
  useEffect(() => {
    if (!mounted) return;
    const root = rootRef.current;
    const inerted: HTMLElement[] = [];
    for (const child of Array.from(document.body.children)) {
      if (child instanceof HTMLElement && child !== root && !child.hasAttribute('inert')) {
        child.setAttribute('inert', '');
        inerted.push(child);
      }
    }
    return () => {
      for (const el of inerted) el.removeAttribute('inert');
    };
  }, [mounted]);

  // Focus defaults to Cancel on open (AC17).
  useEffect(() => {
    if (mounted) cancelRef.current?.focus();
  }, [mounted]);

  // Esc dismisses (AC18); Tab/Shift+Tab is trapped within the dialog's own focusable elements (AC17). A
  // capture-phase document listener so the trap holds even if focus is somehow outside the dialog.
  useEffect(() => {
    if (!mounted) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancelRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const container = dialogRef.current;
      if (!container) return;
      const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !container.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !container.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [mounted]);

  if (!mounted) return null;

  const titleId = 'confirm-modal-title';
  const bodyId = 'confirm-modal-body';

  return createPortal(
    <div ref={rootRef} className="confirm-modal-scrim">
      <div ref={dialogRef} className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId}>
        <h2 id={titleId} className="confirm-modal__title">
          {title}
        </h2>
        <p id={bodyId} className="confirm-modal__body">
          {body}
        </p>
        <div className="confirm-modal__actions">
          <button ref={cancelRef} type="button" className="confirm-modal__cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={danger ? 'btn btn--danger confirm-modal__confirm' : 'btn confirm-modal__confirm'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
