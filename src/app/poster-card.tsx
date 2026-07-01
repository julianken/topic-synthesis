'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type TransitionEvent } from 'react';
import type { PageStatus } from '../domain/sitemap';
import { useLibrary } from './library-provider';
import { decideCardClick } from './poster-card-gesture';
import { PosterControls } from './poster-controls';

/**
 * The library poster card's CLIENT wrapper around the unchanged SERVER `<a>` (scaffolded #200).
 *
 * The card carries reactive client state on its OWN `<li>` wrapper layer — NEVER on the anchor, whose
 * markup (the `view-transition-name` morph endpoint) stays byte-locked. `page.tsx` renders the exact
 * server `<a>` subtree and passes it as `children`; this wrapper owns the `<li className="library-poster">`
 * + a `<PosterControls>` SIBLING.
 *
 * #201 adds the deferred-delete COLLAPSE: while the card's id is pending, the `<li>` collapses via a
 * same-document CSS transition (`--pending`) and is made `inert` (the anchor can't navigate, the chip
 * can't re-fire); when the collapse settles it drops from grid layout (`--collapsed` → `display:none`) so
 * the remaining cards reflow up, the +New cell staying first. Undo (pending → false) restores the card
 * with a `rail-reveal` re-entrance. The inner `<a>`'s `view-transition-name` is left byte-unchanged
 * throughout, and the `<li>` carries none.
 *
 * #203 adds THREE things, none touching the inner `<a>`:
 *  - SELECTABLE-ID REGISTRATION (AC43-46): registers/unregisters its own `lessonId` with the provider on
 *    mount/unmount — the ONLY way an id enters the selection-eligible set (never a DOM query), which is
 *    what structurally excludes `<InFlightCard>` (it never calls `useLibrary()`, so it never registers).
 *  - The SELECTED ring/tint/✓ (`--selected`) + the bulk-collapse per-card stagger index (`--bulk-i`,
 *    read from the SAME merged `pendingDeleted` this wrapper already drives its collapse from) + the
 *    reverse-collapse error-state-shake (`--shake`) on a failed bulk commit.
 *  - Whole-card click-to-toggle in selection mode (AC5): a `<li onClick>` handler that `preventDefault`s
 *    the inner anchor's navigation and toggles selection — POINTER-only (a keyboard-activated click on the
 *    anchor carries `event.detail === 0`, the standard non-pointer-activation signal, and is left alone so
 *    the anchor's own keyboard behavior — Enter navigates — never changes, per the binding constraint that
 *    the inner `<a>`'s role/name/behavior stay untouched). The click decision itself is delegated to the
 *    pure `decideCardClick` (`poster-card-gesture.ts`, unit-tested) — including the guard that swallows
 *    the ONE browser-synthesized `click` that follows a fired long-press on `pointerup` (a stationary
 *    tap-and-hold-then-release still dispatches a click), which would otherwise immediately deselect the
 *    card the long-press just selected (`longPressFiredRef`, set when the 500ms timer fires, consumed by
 *    the very next click decision).
 */
export function PosterCard({
  lessonId,
  title,
  status,
  children,
}: {
  lessonId: string;
  title: string;
  status: PageStatus;
  children: ReactNode;
}) {
  const {
    pendingDeleted,
    registerSelectable,
    unregisterSelectable,
    selectionMode,
    selection,
    toggleSelected,
    enterSelectionMode,
    bulkIndexOf,
    bulkShaking,
  } = useLibrary();
  const pending = pendingDeleted.has(lessonId);
  const selected = selection.has(lessonId);
  const bulkIndex = bulkIndexOf(lessonId);
  const shaking = bulkShaking.has(lessonId);

  // Register this persisted card's id as selectable for the life of the mount (AC43-46) — an in-flight
  // tile never runs this effect (`inflight-card.tsx` renders no `PosterCard`), so it can never register.
  useEffect(() => {
    registerSelectable(lessonId);
    return () => unregisterSelectable(lessonId);
  }, [lessonId, registerSelectable, unregisterSelectable]);

  // `collapsed` drops the card from grid flow AFTER its collapse transition settles (so neighbors reflow);
  // `restoring` plays the re-entrance once on Undo (single-delete) OR a bulk re-expand (a race/failure).
  const [collapsed, setCollapsed] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const wasPending = useRef(pending);

  useEffect(() => {
    if (wasPending.current && !pending) {
      // Undo / bulk re-expand: bring the card back into flow + replay the re-entrance.
      setCollapsed(false);
      setRestoring(true);
    } else if (!wasPending.current && pending) {
      setRestoring(false);
    }
    wasPending.current = pending;
  }, [pending]);

  const onTransitionEnd = (e: TransitionEvent<HTMLLIElement>) => {
    // Once the collapse's opacity leg finishes, leave grid layout so the remaining cards reflow up.
    if (pending && e.propertyName === 'opacity') setCollapsed(true);
  };

  // Long-press (touch enhancement, #203): holding a card on a touch pointer enters selection mode and
  // selects it, mirroring the common mobile "long-press to multi-select" affordance. Pointer-only guarded
  // to `pointerType === 'touch'` so it never fires for mouse/pen; cancelled on move/up/leave so a scroll
  // or a normal tap never mis-fires it. Not itself a tested AC (the rigorous drive lives in #206's e2e
  // suite) — a best-effort enhancement layered over the header Select toggle, the primary entry point.
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearLongPress = () => {
    if (longPressTimer.current != null) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };
  // Review fix (#203): the browser dispatches its own synthetic `click` on the `pointerup` that follows a
  // fired long-press (duration alone doesn't suppress it) — `longPressFiredRef` records that the timer
  // fired so the NEXT click decision (`decideCardClick`, below) swallows exactly that one trailing click
  // instead of re-toggling and deselecting the card the long-press just selected. Reset defensively at the
  // start of every new press cycle too, so an interrupted cycle (e.g. a `pointercancel` that arrives after
  // the timer already fired, with no click ever following) can't leave a stale `true` that swallows an
  // unrelated future click.
  const longPressFiredRef = useRef(false);
  useEffect(() => clearLongPress, []);

  const className = [
    'library-poster',
    pending ? 'library-poster--pending' : '',
    collapsed ? 'library-poster--collapsed' : '',
    restoring ? 'library-poster--restoring' : '',
    selected ? 'library-poster--selected' : '',
    shaking ? 'library-poster--shake' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li
      className={className}
      // `inert` removes the collapsing card + its anchor/chip from focus + pointer interaction (no
      // navigation while pending); cleared the instant the card is restored.
      inert={pending || undefined}
      // `--bulk-i` drives the CSS per-card stagger delay (AC23) — 0 (the default) when this card isn't
      // part of an active bulk collapse, so the single-delete collapse (which reads the same rule) is
      // never delayed.
      style={bulkIndex >= 0 ? ({ '--bulk-i': bulkIndex } as CSSProperties) : undefined}
      onClick={(e) => {
        // A fired long-press swallows exactly the one trailing synthetic click the browser dispatches on
        // `pointerup` — consumed here, BEFORE any of the selection-mode/checkbox/detail branches, so it
        // takes priority regardless of how selection mode was entered (see `longPressFiredRef` above).
        const longPressFired = longPressFiredRef.current;
        longPressFiredRef.current = false;
        const fromCheckbox = Boolean((e.target as HTMLElement).closest('.library-poster__select'));
        const action = decideCardClick({ selectionMode, fromCheckbox, detail: e.detail, longPressFired });
        if (action === 'ignore') return;
        e.preventDefault();
        toggleSelected(lessonId);
      }}
      onTransitionEnd={onTransitionEnd}
      onAnimationEnd={() => setRestoring(false)}
      onPointerDown={(e) => {
        if (e.pointerType !== 'touch' || selectionMode) return;
        longPressFiredRef.current = false;
        longPressTimer.current = setTimeout(() => {
          longPressTimer.current = null;
          longPressFiredRef.current = true;
          enterSelectionMode();
          toggleSelected(lessonId);
        }, 500);
      }}
      onPointerUp={clearLongPress}
      onPointerCancel={clearLongPress}
      onPointerMove={clearLongPress}
      onPointerLeave={clearLongPress}
    >
      {children}
      <PosterControls lessonId={lessonId} title={title} status={status} />
    </li>
  );
}
