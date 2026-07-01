'use client';

import { useEffect, useRef, useState, type ReactNode, type TransitionEvent } from 'react';
import type { PageStatus } from '../domain/sitemap';
import { useLibrary } from './library-provider';
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
  const { pendingDeleted } = useLibrary();
  const pending = pendingDeleted.has(lessonId);

  // `collapsed` drops the card from grid flow AFTER its collapse transition settles (so neighbors reflow);
  // `restoring` plays the re-entrance once on Undo.
  const [collapsed, setCollapsed] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const wasPending = useRef(pending);

  useEffect(() => {
    if (wasPending.current && !pending) {
      // Undo: bring the card back into flow + replay the re-entrance.
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

  const className = [
    'library-poster',
    pending ? 'library-poster--pending' : '',
    collapsed ? 'library-poster--collapsed' : '',
    restoring ? 'library-poster--restoring' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li
      className={className}
      // `inert` removes the collapsing card + its anchor/chip from focus + pointer interaction (no
      // navigation while pending); cleared the instant the card is restored.
      inert={pending || undefined}
      onTransitionEnd={onTransitionEnd}
      onAnimationEnd={() => setRestoring(false)}
    >
      {children}
      <PosterControls lessonId={lessonId} title={title} status={status} />
    </li>
  );
}
