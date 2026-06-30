'use client';

import type { PageStatus } from '../domain/sitemap';

/**
 * The poster card's control slot — a SIBLING of the server-rendered `<a>` morph origin (issue #200).
 *
 * This is the architecture-only seam the lesson-deletion epic's per-card SELECT checkbox / DELETE chip /
 * `TrashMark`/`CheckMark` icons render into (#201 single-delete, #203 bulk multi-select). #200 paints
 * NOTHING — it returns `null` so the rendered DOM (and the committed visual baselines) stay byte-identical
 * to `main`. The `lessonId` / `title` / `status` props are plumbed now so #201/#203 need no signature
 * churn, but are inert this issue.
 */
export function PosterControls(_props: {
  lessonId: string;
  title: string;
  status: PageStatus;
}): null {
  return null;
}
