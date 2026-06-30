import { notFound, redirect } from 'next/navigation';
import { getSessionIdentity } from '../../auth/require-session';
import { displayName } from '../../auth/session-nav';
import { getLesson, getRunMeta, ownsRun } from '../../../store/repo';
import type { LessonDisposition } from './build-summary';
import { BuildSummary } from './build-summary-view';
import { GeneratingPoller } from './generating';
import { ReaderShell } from './reader-shell';

const STATUS_LABEL = { built: 'Built', soon: 'Soon', text: 'Text' } as const;
const STATUS_ICON = { built: '✓', soon: '◷', text: '≡' } as const;

// Read per request — the persisted lesson row lives in Postgres, not at build time.
export const dynamic = 'force-dynamic';

export default async function LessonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const identity = await getSessionIdentity();
  if (!identity) redirect('/sign-in');
  const view = await getLesson(id, identity.sub);

  // Owner-scoped null: show "generating" ONLY for the caller's own not-yet-persisted run (persistRun
  // writes the lesson row atomically on completion); a foreign/absent id is a uniform 404 (no oracle).
  if (!view) {
    if (!(await ownsRun(id, identity.sub))) notFound();
    // The SHARED live-research generating view (the B view — Figma 1:2) renders its own header + the
    // research node-graph + the LIVE RESEARCH panel + the rail, driven by the status poll. This is now the
    // SINGLE generating screen (run-lifecycle #225): the create-form NAVIGATES here on submit. The typed
    // topic + settings come from `run_owner` (getRunMeta, already owner-scoped — we hold ownsRun above),
    // rendered SSR so the header shows "Generating <topic>…" + the "<level> · depth <n>" sub-line AND the
    // `specimen-topic` morph target is present at first paint for the create-form→generating topic morph.
    // A legacy run_owner with no recorded topic → null → the honest bare "Generating…" degrade.
    const meta = await getRunMeta(id, identity.sub);
    return (
      <main className="wrap wrap--gen">
        <GeneratingPoller id={id} topic={meta?.topic} level={meta?.level} depth={meta?.depth} />
      </main>
    );
  }

  // The single-lesson run persists as a one-page `curriculum`-table row — persistRun/getLesson reuse (ADR-0002). concept-drift-ok: names the RETAINED `curriculum` table (ADR-0003 — DB rename still deferred)
  // Resolve the lone page out of the existing view regardless of `built` (a
  // soon/text lesson is a valid, non-`built` page), then branch on its status: built → render the
  // sandboxed artifact directly; soon/text → a labeled degraded state (never a blank iframe).
  const page = view.hub.tiers
    .flatMap((tier) => tier.categories.flatMap((category) => category.pages))
    .find(() => true);

  // The honest terminal disposition (issue #215), derived from (status, html presence) — NO schema change:
  //   built  → status='built' (accepted interactive page),
  //   held   → status='soon' WITH html present (the reviewer held a rendered lesson back),
  //   failed → status='soon' WITHOUT html (synthesis produced no artifact).
  // It splits the old "degraded" lump so a HELD lesson stops claiming "couldn't finish" (the all-✓ rail
  // would contradict that). It changes COPY ONLY — the render gate below still keys on status==='built',
  // so a `held` lesson (status='soon') stays NON-rendered and the critic gate is never defeated.
  const disposition: LessonDisposition =
    page && page.status === 'built' ? 'built' : page && page.hasHtml ? 'held' : 'failed';

  const head = {
    eyebrow: view.topic,
    title: page ? page.title : view.topic,
    level: view.settings.level,
    depth: view.settings.depth,
  };

  // RECEIVER-GUARANTEE (TS-22): the `pagereveal` listener is registered from a parser-blocking inline
  // script in the document <head> (mounted site-wide in `src/app/layout.tsx`), NOT in this body — Chrome
  // requires the listener to register before the first rendering opportunity, which a body script can
  // race. The head-mounted handler reads the destination box from the LIVE DOM, so it decides correctly
  // on EITHER branch: the `built` shell renders `#readerPanel.morph-box` (→ the card→reader box-FLIP runs
  // when supported + reduced-motion off), and the degraded `soon`/`text` state renders NO box (→ skip the
  // cross-doc VT → a clean instant-swap; AC4).
  //
  // PR-D — the BUILT branch is the integrated workspace: the ReaderShell now owns the TOP CHROME (the 54px
  // frosted topbar with the y=0 reading-progress hairline), then the reader header (eyebrow/title/level),
  // then the grid — so the shell is rendered DIRECTLY under <main> (no surrounding page header above the
  // topbar). The degraded branch keeps the plain narrow-wrap header + degraded state.
  if (page && page.status === 'built') {
    return (
      // The BUILT branch lays out the lesson-workspace grid (PR-A), which caps at --frame-max and centers
      // itself — so its <main> uses the frame-wide `wrap--reader` (capped at --frame-max, no side padding
      // so the grid's own --edge-gap gutters center it).
      <main className="wrap wrap--reader">
        {/*
          The v11 reader shell (TS-20) frames the UNCHANGED opaque-origin lesson iframe inside the
          `#readerPanel.morph-box` card→reader FLIP destination. The iframe stays sandbox="allow-scripts"
          WITHOUT allow-same-origin (opaque origin), src at the strict-CSP /artifact route (page.href →
          src/app/artifact/serve.ts), authorized through the owning row (the same-origin GET carries the
          session cookie — ADR-0002 §5). The shell never reads the iframe DOM and never relaxes the
          sandbox/CSP. PR-D: it also renders the integrated topbar + the y=0 reading-progress hairline.
          concept-drift-ok: names the RETAINED `curriculum` table (ADR-0003 — DB rename still deferred)
        */}
        <ReaderShell
          id={id}
          href={page.href}
          title={page.title}
          userName={displayName(identity.email)}
          head={head}
          // Owner-only "How this was built" disclosure (issue #175) — server-rendered HERE (under the
          // owner-scoped getLesson gate above, so it inherits the owner gate for free) and slotted quietly
          // near the reader head. Returns null for a legacy lesson with no recorded timeline.
          buildSummary={<BuildSummary id={id} disposition={disposition} />}
        />
      </main>
    );
  }

  return (
    <main className="wrap wrap--wide">
      {/*
        RECEIVER-GUARANTEE (TS-22): the degraded state renders NO `#readerPanel.morph-box`, so the
        head-mounted guard finds no box and SKIPS the cross-document morph → a clean instant-swap (AC4).
        The reader header (eyebrow + title + level/depth) renders as the plain narrow-wrap header.
      */}
      <div>
        <p className="eyebrow">{head.eyebrow}</p>
        <h1>{head.title}</h1>
        <p className="lead">
          {head.level} · depth {head.depth}
        </p>
      </div>
      <div className="lesson-degraded" role="status">
        <span className={`badge badge--${page ? page.status : 'soon'}`}>
          <span className="badge__icon" aria-hidden="true">
            {STATUS_ICON[page ? page.status : 'soon']}
          </span>{' '}
          {STATUS_LABEL[page ? page.status : 'soon']}
        </span>
        {/* HONEST degraded copy (issue #215): a HELD lesson WAS generated and then held back at review —
            never tell the learner it "couldn't be generated" (that lie contradicted the all-✓ build rail).
            A genuinely FAILED lesson keeps the "couldn't be generated" framing because that is true. */}
        <p className="lead">
          {disposition === 'held'
            ? 'A reviewer held this lesson back before publishing it — it didn’t quite meet the bar this time. You can try generating it again.'
            : 'This lesson couldn’t be generated as an interactive page. Try generating it again.'}
        </p>
      </div>
      {/* Owner-only "How this was built" disclosure (issue #175) — on the DEGRADED branch it is the
          higher-intent "See what happened" entry. The 3-way disposition (issue #215) gives held vs failed
          honest summary copy. Same owner gate as the built branch: rendered only after getLesson scoping. */}
      <BuildSummary id={id} disposition={disposition} />
    </main>
  );
}
