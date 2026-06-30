'use client';

import type { ReactNode } from 'react';
import type { PageStatus } from '../domain/sitemap';
import { useLibrary } from './library-provider';
import { PosterControls } from './poster-controls';

/**
 * The library poster card's CLIENT wrapper around the unchanged SERVER `<a>` (issue #200).
 *
 * The card must grow reactive client state (selected ring/tint, deferred-commit collapse, `aria-disabled`,
 * pointer-events gating — #201/#203) AND keep its `view-transition-name` on a server-rendered anchor whose
 * markup must stay byte-identical (the card→reader FLIP morph origin, locked by `lesson-route-morph.spec`
 * and the `library-dense-card` baseline). Making the whole card a client component would drag the inline VT
 * style and the morph-origin markup into client code and risk drift in that byte-locked attribute. Instead
 * `page.tsx` keeps rendering the exact server `<a>` subtree and passes it as `children` (the same RSC
 * pattern as `page.tsx → <LibraryCreate>{cards}</LibraryCreate>`); this wrapper owns the
 * `<li className="library-poster">` and a `<PosterControls>` SIBLING, applying all reactive state to its
 * OWN wrapper layer — NEVER to the anchor. The `<li>` and the controls carry NO `view-transition-name`.
 *
 * #200 introduces zero behavior: it subscribes to `useLibrary()` to establish the seam, but reads nothing
 * reactive yet (the context sets are empty / mode false and never change), so the rendered DOM is
 * byte-identical to `main`.
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
  // Subscribe to the library context so #201/#203 can hang selection / pending-delete state on the
  // wrapper without re-plumbing. #200 reads nothing reactive — the subscription only establishes the seam.
  useLibrary();

  return (
    <li className="library-poster">
      {children}
      <PosterControls lessonId={lessonId} title={title} status={status} />
    </li>
  );
}
