import { redirect } from 'next/navigation';
import { getSessionIdentity } from './auth/require-session';
import { listLessons } from '../store/repo';
import { LibraryCreate } from './library-create';
import { PosterMark } from './poster-mark';
import {
  badgeClass,
  cardDescription,
  categoryEyebrow,
  metaLine,
  morphName,
  STATUS_ICON,
  STATUS_LABEL,
} from './library-card';

// The library lists the signed-in owner's persisted lessons — Postgres data read per request, not at
// build time (mirrors the reader route's `force-dynamic`).
export const dynamic = 'force-dynamic';

/**
 * The library home (`/`, TS-17) — the Figma library frame `6:2` reconciled with the intake-form intent:
 * an auth-gated, owner-scoped card grid of the signed-in user's lesson posters whose FIRST cell is a
 * `+ New lesson` card. Clicking it GROWS that cell in place into the intake form (a same-document
 * container-transform); a successful submit hands off to an in-place generating shell — the create-form
 * flow (the client island `library-create.tsx`). The signed-in top-bar chrome (`6:6` wordmark + user
 * chip) is the shared `<SessionNav>` app header (layout.tsx); this page owns the section title row, the
 * owner-scoped lesson-card data fetch, and the rendered poster cards it hands to the create island.
 * concept-drift-ok: route identifier, deferred rename (ADR-0003)
 *
 * Each poster card is the FLIP ORIGIN of the card→reader morph: a bounded box carrying a per-card
 * `view-transition-name` endpoint (`morphName`) that the TS-21 route-level cross-document View-Transition
 * (declared in `globals.css`, NOT here) morphs into the reader's `#readerPanel.morph-box` (TS-20). The
 * transport + box-geometry tween live at the route seam (`globals.css`); this page sets only the inline
 * per-card endpoint name — box-only, per the TS-5b verdict; the library `/` and reader route stay two
 * independent App-Router routes (`/lesson/[id]`).
 *
 * A SERVER component (the owner-scoped `listLessons` fetch must run behind the session gate, off the
 * client). It renders the poster cards as a server subtree and passes them as `children` into the
 * `<LibraryCreate>` client island, which prepends the `+New` cell, drives the form reveal, and owns the
 * submit handoff — so the data fetch stays server-side while the interactive create flow is the only
 * client code (mirroring the prior server-page + `<IntakeForm>` client-island split).
 *
 * Card fidelity to the DENSE Figma `6:2` poster (DESIGN.md §Components → Library): the card renders the
 * wash, then the body's rows — the uppercase subject EYEBROW (`6:41`), the serif TITLE (`6:44`), the
 * one-line DESCRIPTION (`6:47`), and a bottom-pinned FOOTER (status badge LEFT + the "beginner · d2 · 3h
 * ago" meta RIGHT). Every value is REAL stored data; a NULL category or summary OMITS that row — never a
 * fabricated value (copy-appropriateness gate). With the `+New` card always the first cell, a fresh
 * account is never an empty grid — the create affordance IS the first card.
 */
export default async function Library() {
  const identity = await getSessionIdentity();
  if (!identity) redirect('/sign-in');

  const lessons = await listLessons(identity.sub);

  return (
    <main className="library">
      {/* The section title row is passed as the `head` prop so the create island can DROP it in the
          in-place generating view (a clean, focused screen — no stale "Tap a built lesson" copy above a
          mid-generation lesson); it renders only in the index/form views. */}
      <LibraryCreate
        head={
          <div className="library__head">
            <h1 className="library__title">Lessons</h1>
            <p className="library__hint">Tap a built lesson — the card opens into the workspace.</p>
          </div>
        }
      >
        {lessons.map((lesson) => {
          const meta = metaLine(lesson.level, lesson.depth, lesson.createdAt);
          // Dense-card rows — both REAL stored data, both re-validated on the read side. A null result
          // (old row / classifier miss / blank summary) OMITS that row (show nothing > guess/leak).
          const eyebrow = categoryEyebrow(lesson.category);
          const description = cardDescription(lesson.summary);
          return (
            <li key={lesson.id} className="library-poster">
              {/* Each card links CROSS-DOCUMENT to the reader via a PLAIN <a> anchor — deliberately NOT
                  next/link. next/link does a CLIENT-SIDE soft navigation (RSC payload swap, no document
                  unload/load), and `@view-transition { navigation: auto }` is a cross-document mechanism
                  that only activates on a real document navigation — so a soft nav would never fire the
                  morph. A plain anchor is a genuine full-document navigation App Router does not intercept,
                  so the cross-document View-Transition transport in `globals.css` activates and pairs this
                  card's `view-transition-name` endpoint (morphName, id-scoped) with the reader's box. */}
              <a
                className="library-poster__card"
                href={`/lesson/${encodeURIComponent(lesson.id)}`}
                style={{ viewTransitionName: morphName(lesson.id) }}
              >
                <span className="library-poster__wash" aria-hidden="true">
                  <PosterMark />
                </span>
                <span className="library-poster__body">
                  <span className="library-poster__head">
                    {/* Subject eyebrow (Figma 6:41) — omitted entirely when null, no empty band. */}
                    {eyebrow ? <span className="library-poster__eyebrow">{eyebrow}</span> : null}
                    <span className="library-poster__title">{lesson.title}</span>
                    {/* One-line description (Figma 6:47) — omitted when null. */}
                    {description ? (
                      <span className="library-poster__desc">{description}</span>
                    ) : null}
                  </span>
                  <span className="library-poster__foot">
                    <span className={badgeClass(lesson.status)}>
                      <span className="badge__icon" aria-hidden="true">
                        {STATUS_ICON[lesson.status]}
                      </span>{' '}
                      {STATUS_LABEL[lesson.status]}
                    </span>
                    <span className="library-poster__meta">{meta}</span>
                  </span>
                </span>
              </a>
            </li>
          );
        })}
      </LibraryCreate>
    </main>
  );
}
