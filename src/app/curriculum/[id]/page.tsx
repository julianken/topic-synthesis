import { notFound, redirect } from 'next/navigation';
import { getSessionIdentity } from '../../auth/require-session';
import { getCurriculum, ownsRun } from '../../../store/repo';
import { GeneratingPoller } from './generating';

const STATUS_LABEL = { built: 'Built', soon: 'Soon', text: 'Text' } as const;
const STATUS_ICON = { built: '✓', soon: '◷', text: '≡' } as const;

// Read per request — the curriculum lives in Postgres, not at build time.
export const dynamic = 'force-dynamic';

export default async function LessonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const identity = await getSessionIdentity();
  if (!identity) redirect('/sign-in');
  const view = await getCurriculum(id, identity.sub);

  // Owner-scoped null: show "generating" ONLY for the caller's own not-yet-persisted run (persistRun
  // writes the curriculum atomically on completion); a foreign/absent id is a uniform 404 (no oracle).
  if (!view) {
    if (!(await ownsRun(id, identity.sub))) notFound();
    return (
      <main className="wrap">
        <p className="eyebrow">Lesson</p>
        <h1>Generating…</h1>
        <p className="lead">Researching and building your lesson. This usually takes a minute or two.</p>
        <GeneratingPoller id={id} />
      </main>
    );
  }

  // The single-lesson run persists as a one-page curriculum (the existing persistRun/getCurriculum
  // reuse — ADR-0002). Resolve the lone page out of the existing view regardless of `built` (a
  // soon/text lesson is a valid, non-`built` page), then branch on its status: built → render the
  // sandboxed artifact directly; soon/text → a labeled degraded state (never a blank iframe).
  const page = view.hub.tiers
    .flatMap((tier) => tier.categories.flatMap((category) => category.pages))
    .find(() => true);

  return (
    <main className="wrap wrap--wide">
      <p className="eyebrow">{view.topic}</p>
      <h1>{page ? page.title : view.topic}</h1>
      <p className="lead">
        {view.settings.level} · depth {view.settings.depth}
      </p>

      {page && page.status === 'built' ? (
        // sandbox="allow-scripts" WITHOUT allow-same-origin → opaque origin: the lesson runs its own
        // canvas/SVG scripts but can't reach this app's origin/cookies/storage. The strict CSP is set
        // by the /artifact route (page.href → src/app/artifact/serve.ts), authorized through the
        // owning curriculum (the same-origin GET carries the session cookie — ADR-0002 §5).
        <iframe
          className="artifact-frame"
          title={page.title}
          src={page.href}
          sandbox="allow-scripts"
        />
      ) : (
        <div className="lesson-degraded" role="status">
          <span className={`badge badge--${page ? page.status : 'soon'}`}>
            <span className="badge__icon" aria-hidden="true">
              {STATUS_ICON[page ? page.status : 'soon']}
            </span>{' '}
            {STATUS_LABEL[page ? page.status : 'soon']}
          </span>
          <p className="lead">
            This lesson couldn&rsquo;t be generated as an interactive page. Try generating it again.
          </p>
        </div>
      )}
    </main>
  );
}
