import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionIdentity } from './auth/require-session';
import { listLessons } from '../store/repo';
import { IntakeForm } from './intake-form';
import { badgeClass, kindLabel, morphName, relativeTime, STATUS_ICON, STATUS_LABEL } from './library-card';

// The library lists the signed-in owner's persisted lessons — Postgres data read per request, not at
// build time (mirrors the reader route's `force-dynamic`).
export const dynamic = 'force-dynamic';

/**
 * The library home (`/`, TS-17) — the FRAME-phase library route: an auth-gated, owner-scoped card grid
 * of the signed-in user's lesson posters that is ALSO the product's sole generation entry (the intake
 * form folds in here — program decision 11). It is the FLIP ORIGIN of the card→reader morph: each card
 * is a bounded box carrying a per-card `view-transition-name` endpoint (`morphName`) that the TS-21
 * route-level cross-document View-Transition (declared in `globals.css`, NOT here) morphs into the
 * reader's `#readerPanel.morph-box` (TS-20). The transport + box-geometry tween live at the route seam
 * (`globals.css`); this page sets only the inline per-card endpoint name — box-only, per the TS-5b
 * verdict; the library `/` and reader `/curriculum/[id]` stay two independent App-Router routes. concept-drift-ok: route identifier, deferred rename (ADR-0003)
 *
 * A SERVER component (the owner-scoped `listLessons` fetch must run behind the session gate, off the
 * client) with the `<IntakeForm>` client island embedded — mirroring `layout.tsx` server + `SessionNav`.
 */
export default async function Library() {
  const identity = await getSessionIdentity();
  if (!identity) redirect('/sign-in');

  const lessons = await listLessons(identity.sub);

  return (
    <main className="wrap wrap--wide">
      <p className="eyebrow">Topic Synthesis</p>
      <h1>Lessons</h1>
      <p className="lead">
        Your generated lessons. Enter a STEM topic below and a multi-agent pipeline researches it and
        synthesizes one interactive, scaffolded lesson end-to-end.
      </p>

      {lessons.length > 0 ? (
        <ul className="library-grid">
          {lessons.map((lesson) => {
            const kind = kindLabel(lesson.interactionKind);
            const when = relativeTime(lesson.createdAt);
            return (
              <li key={lesson.id} className="poster">
                {/* Each card is a bounded box linking CROSS-DOCUMENT to the reader (a plain next/link
                    anchor — no client-router shell, TS-5b box-only routing). The `view-transition-name`
                    endpoint (morphName, id-scoped) makes this box the morph's FLIP ORIGIN; the TS-21
                    cross-document View-Transition transport in `globals.css` pairs it with the reader's
                    destination box and box-FLIPs the geometry on navigation. */}
                <Link
                  className="poster__card"
                  href={`/curriculum/${encodeURIComponent(lesson.id)}`} // concept-drift-ok: route identifier, deferred rename (ADR-0003)
                  style={{ viewTransitionName: morphName(lesson.id) }}
                >
                  <span className="poster__title">{lesson.title}</span>
                  <span className="poster__meta">
                    <span className={badgeClass(lesson.status)}>
                      <span className="badge__icon" aria-hidden="true">
                        {STATUS_ICON[lesson.status]}
                      </span>{' '}
                      {STATUS_LABEL[lesson.status]}
                    </span>
                    {kind ? <span className="poster__kind">{kind}</span> : null}
                    {when ? <span className="poster__when">{when}</span> : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        // Empty state: a first-run prompt that points at the intake — never a bare blank grid (AC4).
        <p className="library-empty">
          No lessons yet. Generate your first one below — it takes about a minute.
        </p>
      )}

      <section className="library-intake" aria-label="Generate a new lesson">
        <h2 className="library-intake__heading">Generate a lesson</h2>
        <IntakeForm />
        <p className="intake__note">Runs on Haiku, capped — about a minute and a few cents.</p>
      </section>
    </main>
  );
}
