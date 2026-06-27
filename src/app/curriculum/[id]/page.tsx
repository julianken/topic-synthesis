import { notFound, redirect } from 'next/navigation';
import { getSessionIdentity } from '../../auth/require-session';
import { getCurriculum, ownsRun } from '../../../store/repo'; // concept-drift-ok: code identifier, deferred rename (ADR-0003)
import { GeneratingPoller } from './generating';
import { MorphReceiverGuard } from './morph-receiver-guard';
import { ReaderShell } from './reader-shell';

const STATUS_LABEL = { built: 'Built', soon: 'Soon', text: 'Text' } as const;
const STATUS_ICON = { built: '✓', soon: '◷', text: '≡' } as const;

// Read per request — the persisted lesson row lives in Postgres, not at build time. concept-drift-ok: persisted-entity / route identifier, deferred rename (ADR-0003)
export const dynamic = 'force-dynamic';

export default async function LessonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const identity = await getSessionIdentity();
  if (!identity) redirect('/sign-in');
  const view = await getCurriculum(id, identity.sub); // concept-drift-ok: code identifier, deferred rename (ADR-0003)

  // Owner-scoped null: show "generating" ONLY for the caller's own not-yet-persisted run (persistRun
  // writes the lesson row atomically on completion); a foreign/absent id is a uniform 404 (no oracle).
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

  // The single-lesson run persists as a one-page curriculum row — persistRun/getCurriculum reuse (ADR-0002). concept-drift-ok: persisted-entity / code identifier, deferred rename (ADR-0003)
  // Resolve the lone page out of the existing view regardless of `built` (a
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
        // The v11 reader shell (TS-20) frames the UNCHANGED opaque-origin lesson iframe: a
        // reading-progress affordance + section list driven by the decision-12 postMessage channel,
        // inside the `#readerPanel.morph-box` card→reader FLIP destination. The iframe stays
        // sandbox="allow-scripts" WITHOUT allow-same-origin (opaque origin) with src at the strict-CSP
        // /artifact route (page.href → src/app/artifact/serve.ts), authorized through the owning row
        // (the same-origin GET carries the session cookie — ADR-0002 §5). The shell never reads the
        // iframe DOM and never relaxes the sandbox/CSP. concept-drift-ok: persisted-entity (curriculum) identifier, deferred rename (ADR-0003)
        //
        // RECEIVER-GUARANTEE (TS-22): the morph-box destination IS present on this `built` branch, so the
        // guard (told `destinationBoxPresent`) lets the card→reader box-FLIP run when the browser supports
        // the cross-doc VT and the user hasn't asked for reduced motion — else it instant-swaps (AC3).
        <>
          <MorphReceiverGuard destinationBoxPresent />
          <ReaderShell id={id} href={page.href} title={page.title} />
        </>
      ) : (
        // RECEIVER-GUARANTEE (TS-22): the degraded state renders NO `#readerPanel.morph-box`, so the
        // morph would try to pair a missing endpoint. The guard (told `destinationBoxPresent={false}`)
        // skips the cross-doc View-Transition → a clean instant-swap to this usable degraded page (AC4).
        <>
          <MorphReceiverGuard destinationBoxPresent={false} />
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
        </>
      )}
    </main>
  );
}
