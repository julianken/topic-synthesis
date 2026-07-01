import { redirect } from 'next/navigation';
import { getSessionIdentity } from '../auth/require-session';
import { listDeletedLessons } from '../../store/repo';
import { cardDescription, categoryEyebrow, deletedAgo } from '../library-card';
import { PosterMark } from '../poster-mark';
import { RestoreCard, RestoreShelf } from './restore-controls';

// Owner-scoped, read-per-request behind the session gate (mirrors the library home + the reader route).
export const dynamic = 'force-dynamic';

/**
 * The Recently-deleted recovery shelf (`/recently-deleted`, #204) — the DURABLE half of the lesson-deletion
 * epic's recovery (the timed Undo snackbar is the transient half). A signed-in owner sees their soft-deleted
 * lessons newest-deleted-first, each with a per-card Restore that returns it to the library.
 *
 * A SERVER component (the owner-scoped `listDeletedLessons` read MUST run behind the session gate, off the
 * client — the same gate + split `page.tsx` uses for `getSessionIdentity`/`listLessons`). Default-deny: no
 * session → redirect to `/sign-in`; the read is scoped to `identity.sub`, so a foreign/empty owner gets `[]`
 * (no existence oracle, no other owner's rows). This route adds NO new API route — the only mutation, the
 * per-card Restore, consumes the #199 `POST /api/lessons/restore` route via the `RestoreCard` client island.
 *
 * The shelf REUSES the shipped poster visual (the `.library-poster__*` wash/eyebrow/title/description) but
 * the card is NOT a link into the lesson read route (a deleted lesson 404s at the read layer) and carries
 * no view-transition morph name — it must never pair into the card→reader FLIP morph. Its footer is the
 * "Deleted …" stamp + the Restore control.
 */
export default async function RecentlyDeleted() {
  const identity = await getSessionIdentity();
  if (!identity) redirect('/sign-in');

  const deleted = await listDeletedLessons(identity.sub);

  return (
    <main className="shelf">
      <div className="shelf__head">
        <div className="shelf__head-row">
          <h1 className="shelf__title">Recently deleted</h1>
          <a className="shelf__back" href="/">
            Back to lessons
          </a>
        </div>
      </div>

      {deleted.length === 0 ? (
        // Honest, labeled empty state — never a bare void (DESIGN.md — empty states are labeled).
        <section className="shelf-empty">
          <h2 className="shelf-empty__title">Nothing here</h2>
          <p className="shelf-empty__hint">Deleted lessons stay here so you can get them back.</p>
        </section>
      ) : (
        // The interactive island wraps the SERVER-rendered grid + pre-mounts the standing live regions.
        <RestoreShelf>
          <ul className="shelf-grid">
            {/* Rendered in the order `listDeletedLessons` returns (newest-deleted-first) — NO client re-sort. */}
            {deleted.map((lesson, i) => {
              // The same read-side copy-appropriateness gates the library home uses; a null result OMITS
              // that row (show nothing > guess/leak).
              const eyebrow = categoryEyebrow(lesson.category);
              const description = cardDescription(lesson.summary);
              return (
                <RestoreCard
                  key={lesson.id}
                  id={lesson.id}
                  title={lesson.title}
                  index={i}
                  deletedLabel={deletedAgo(lesson.deletedAt)}
                  wash={
                    <span className="library-poster__wash" aria-hidden="true">
                      <PosterMark />
                    </span>
                  }
                  head={
                    <div className="library-poster__head">
                      {eyebrow ? <span className="library-poster__eyebrow">{eyebrow}</span> : null}
                      <span className="library-poster__title">{lesson.title}</span>
                      {description ? <span className="library-poster__desc">{description}</span> : null}
                    </div>
                  }
                />
              );
            })}
          </ul>
        </RestoreShelf>
      )}
    </main>
  );
}
