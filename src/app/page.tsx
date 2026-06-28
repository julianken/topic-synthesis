import { redirect } from 'next/navigation';
import { getSessionIdentity } from './auth/require-session';
import { listLessons } from '../store/repo';
import { IntakeForm } from './intake-form';
import { PosterMark } from './poster-mark';
import { badgeClass, metaLine, morphName, STATUS_ICON, STATUS_LABEL } from './library-card';

// The library lists the signed-in owner's persisted lessons — Postgres data read per request, not at
// build time (mirrors the reader route's `force-dynamic`).
export const dynamic = 'force-dynamic';

/**
 * The library home (`/`, TS-17) — rebuilt to the Figma library frame `6:2`: an auth-gated, owner-scoped
 * card grid of the signed-in user's lesson posters that is ALSO the product's sole generation entry (the
 * intake form folds in here — program decision 11). The signed-in top-bar chrome (`6:6` wordmark + user
 * chip) is the shared `<SessionNav>` app header (layout.tsx); this page owns the section title row, the
 * poster card grid, the empty state, and the folded-in intake. concept-drift-ok: route identifier, deferred rename (ADR-0003)
 *
 * Each poster card is the FLIP ORIGIN of the card→reader morph: a bounded box carrying a per-card
 * `view-transition-name` endpoint (`morphName`) that the TS-21 route-level cross-document View-Transition
 * (declared in `globals.css`, NOT here) morphs into the reader's `#readerPanel.morph-box` (TS-20). The
 * transport + box-geometry tween live at the route seam (`globals.css`); this page sets only the inline
 * per-card endpoint name — box-only, per the TS-5b verdict; the library `/` and reader route
 * stay two independent App-Router routes (`/curriculum/[id]`). concept-drift-ok: route identifier, deferred rename (ADR-0003)
 *
 * A SERVER component (the owner-scoped `listLessons` fetch must run behind the session gate, off the
 * client) with the `<IntakeForm>` client island embedded — mirroring `layout.tsx` server + `SessionNav`.
 *
 * Card fidelity to the Figma `6:2` poster (DESIGN.md §Components → Library): the card renders the wash,
 * the serif title, and a bottom-pinned footer (status badge LEFT + the "beginner · d2 · 3h ago" meta
 * RIGHT) at the frame's card height, so the title-top / footer-bottom rhythm matches the frame. The meta
 * line is REAL data — `level` + `depth` come from the request's saved Settings (`metaLine`), the relative
 * time from `createdAt`. The body is bottom-anchored so the footer pins to the card floor regardless of
 * how the (deferred) eyebrow/description rows would have grown it.
 *
 * Two of the frame's five rows stay deferred — they have NO data source, so filling them would fabricate:
 * the Figma card eyebrow (`6:41`) holds a SUBJECT CATEGORY (BIOLOGY / MATHEMATICS / …), but a single-
 * lesson run's hub category is the placeholder `'Lesson'`, not a subject; and there is no description
 * column. The card deliberately renders NEITHER rather than fill them with the artifact's internal
 * `interactionKind` render-backend enum (`svg`/`canvas`/`html`, dev-speak) or an invented sentence — show
 * nothing > leak a code identifier or fabricate copy (copy-appropriateness gate). Full eyebrow/description
 * fidelity is deferred to a subject-category data source; the footer + meta + frame geometry land now.
 */
export default async function Library() {
  const identity = await getSessionIdentity();
  if (!identity) redirect('/sign-in');

  const lessons = await listLessons(identity.sub);

  return (
    <main className="library">
      <div className="library__head">
        <h1 className="library__title">Lessons</h1>
        <p className="library__hint">Tap a built lesson — the card opens into the workspace.</p>
      </div>

      {lessons.length > 0 ? (
        <ul className="library-grid">
          {lessons.map((lesson) => {
            const meta = metaLine(lesson.level, lesson.depth, lesson.createdAt);
            return (
              <li key={lesson.id} className="library-poster">
                {/* Each card links CROSS-DOCUMENT to the reader via a PLAIN <a> anchor — deliberately
                    NOT next/link. next/link intercepts the click and does a CLIENT-SIDE soft navigation
                    (RSC payload swap, no document unload/load), and `@view-transition { navigation: auto }`
                    is a cross-document mechanism that only activates on a real document navigation — so a
                    soft nav would never fire the morph (the card click would be an instant route swap with
                    no box-FLIP). A plain anchor is a genuine full-document navigation App Router does not
                    intercept, so the cross-document View-Transition transport in `globals.css` activates,
                    pairs this card's `view-transition-name` endpoint (morphName, id-scoped — the FLIP
                    ORIGIN) with the reader's destination box, and box-FLIPs the geometry on the click. The
                    two routes stay independent (TS-5b decision 2: cross-doc VT transport, SPA shell rejected). */}
                <a
                  className="library-poster__card"
                  href={`/curriculum/${encodeURIComponent(lesson.id)}`} // concept-drift-ok: route identifier, deferred rename (ADR-0003)
                  style={{ viewTransitionName: morphName(lesson.id) }}
                >
                  <span className="library-poster__wash" aria-hidden="true">
                    <PosterMark />
                  </span>
                  <span className="library-poster__body">
                    <span className="library-poster__title">{lesson.title}</span>
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
        </ul>
      ) : (
        // Empty state: a first-run prompt that points at the intake — never a bare blank grid (AC4).
        <div className="library-empty">
          <p className="library-empty__title">No lessons yet</p>
          <p className="library-empty__hint">
            Generate your first one below — it takes about a minute.
          </p>
        </div>
      )}

      <section className="library-intake" aria-label="Generate a new lesson">
        <h2 className="library-intake__heading">New lesson</h2>
        <p className="library-intake__sub">
          Enter a STEM topic and a multi-agent pipeline researches it and synthesizes one interactive,
          scaffolded lesson end-to-end.
        </p>
        <IntakeForm />
      </section>
    </main>
  );
}
