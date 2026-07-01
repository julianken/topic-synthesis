import {
  buildSummaryModel,
  type BuildSummaryModel,
  type LessonDisposition,
} from './build-summary';
import { getStepEvents } from '../../../store/repo';

/**
 * The owner-only "How this was built" disclosure (issue #175, epic PR-5) — a native `<details>` on the
 * persisted lesson page that expands to the FROZEN six-stage rail (learner-safe per-step timing + status).
 *
 * Owner-gated FOR FREE by co-location: this is server-rendered ONLY inside `page.tsx`'s render paths,
 * which run after the page's `getLesson(id, identity.sub)` filter has 404'd a foreign id — so a non-owner
 * never reaches it. No new route, no new gate, no `ownsRun` (run_owner is pruned at persist). The render
 * math is the pure `build-summary.ts` (`buildSummaryModel`, node-unit-tested); this file (deliberately a
 * DISTINCT basename so the `.ts` core and this `.tsx` view never collide on extension resolution) is the
 * thin view + the async DB read. Timeline-only + learner-safe by construction (see `build-summary.ts`).
 */

/** The async server component: read the durable `step_event` timeline (kept past persist — issue #175),
 *  fold it to a model, and render. Returns `null` when there's nothing to disclose (a legacy/blob lesson
 *  with no recorded steps), so the page renders no empty shell — and, since #239, no orphaned "See the
 *  full build"/"See the full workflow" affordance either (see {@link BuildSummaryView} for why the
 *  affordance moved here, INSIDE the same async unit as the disclosure). */
export async function BuildSummary({
  id,
  disposition,
}: {
  id: string;
  disposition: LessonDisposition;
}) {
  const model = buildSummaryModel(await getStepEvents(id), disposition);
  if (!model) return null;
  // Pass the frozen-workflow route href (run-lifecycle 3/4 — issue #232, and run-lifecycle 4/4 — issue
  // #233). BuildSummaryView renders it as ONE of two mutually-exclusive links, keyed off `model.disposition`
  // (see the #239 doc comment on that gate below): the DEGRADED "See the full workflow" text, or the
  // BUILT "See the full build" text.
  return <BuildSummaryView model={model} workflowHref={`/lesson/${encodeURIComponent(id)}/workflow`} />;
}

/**
 * The PURE, sync view (no DB, no DOM) — split out so a node-env render test can string-render it via
 * `react-dom/server` and pin the copy-gate over the REAL output. A native `<details>`: the ONLY
 * interactive target is the `<summary>` (the rows are inert). The expand rides the §0 catalog `--tr-state`
 * primitive (no new §0 token); a `:focus-visible` ring is on the summary; the box aligns to the reading
 * spine (`--frame-max` / `--edge-gap`) via `.build-summary`. Status is by label + icon, never colour alone.
 */
export function BuildSummaryView({
  model,
  workflowHref,
}: {
  model: BuildSummaryModel;
  /** The frozen completed-workflow route (issue #232). Rendered on BOTH dispositions: the DEGRADED variant
   *  shows a "See the full workflow" link (its only entry to the route); the BUILT variant shows the "See the
   *  full build" reader affordance (issue #239 — co-located here, gated on the resolved `!degraded`, so it
   *  appears in LOCKSTEP with the disclosure rather than being independently gated in the client shell where
   *  a Server→Client prop is always-truthy). Omitted ⇒ no link on either branch. */
  workflowHref?: string;
}) {
  // Render from the 3-way disposition (issue #215): `data-degraded` (held|failed) keeps the existing CSS
  // hook unchanged, and `data-disposition` exposes the precise terminal state for finer styling/testing.
  const degraded = model.disposition !== 'built';
  return (
    <>
    <details
      className="build-summary"
      data-degraded={degraded || undefined}
      data-disposition={model.disposition}
    >
      <summary className="build-summary__summary">
        <span className="build-summary__chevron" aria-hidden="true" />
        <span className="build-summary__head">{model.headline}</span>
        {model.metaParts.map((part) => (
          <span className="build-summary__meta" key={part}>
            <span className="build-summary__dot" aria-hidden="true">
              ·
            </span>
            {part}
          </span>
        ))}
        <span className="build-summary__verdict">
          <span className="build-summary__dot" aria-hidden="true">
            ·
          </span>
          <span className="build-summary__verdict-glyph" aria-hidden="true">
            {model.verdictGlyph}
          </span>{' '}
          {model.verdictWord}
        </span>
      </summary>

      {/* The FROZEN rail (at rest — no LiveTimer): one row per pipeline stage, learner-safe label + status
          glyph + the visually-hidden state word + the frozen per-step duration. */}
      <div className="build-summary__body">
        <ol className="build-summary__rail" aria-label={`How this lesson was built — ${String(model.rows.length)} stages`}>
          {model.rows.map((row) => (
            <li className="build-summary__row" data-state={row.state} key={row.name}>
              <span className="build-summary__glyph" aria-hidden="true">
                {row.glyph}
              </span>
              <span className="build-summary__label">
                {row.label}
                <span className="build-summary__sr"> · {row.word}</span>
              </span>
              <span className="build-summary__time">{row.duration ?? '—'}</span>
            </li>
          ))}
        </ol>

        {/* The state legend — how to read the rail glyphs (the same label+icon vocabulary §Accessibility
            mandates). Decorative glyphs are aria-hidden; the words carry the meaning. */}
        <dl className="build-summary__legend" aria-label="What the marks mean">
          <div className="build-summary__legend-row" data-state="done">
            <span className="build-summary__legend-glyph" aria-hidden="true">
              ✓
            </span>
            <dt className="build-summary__legend-term">done</dt>
          </div>
          <div className="build-summary__legend-row" data-state="error">
            <span className="build-summary__legend-glyph" aria-hidden="true">
              ✗
            </span>
            <dt className="build-summary__legend-term">didn&rsquo;t finish</dt>
          </div>
          <div className="build-summary__legend-row" data-state="pending">
            <span className="build-summary__legend-glyph" aria-hidden="true">
              —
            </span>
            <dt className="build-summary__legend-term">didn&rsquo;t run</dt>
          </div>
        </dl>
      </div>
    </details>
      {/* DEGRADED-only entry to the frozen completed-workflow page (issue #232). On the degraded reader
          page this disclosure is the sole affordance, so the link sits beside it (OUTSIDE `.build-summary`,
          so the element-scoped build-summary snapshot is untouched). */}
      {degraded && workflowHref ? (
        <a className="build-summary__workflow-link" href={workflowHref}>
          See the full workflow
          <span aria-hidden="true"> →</span>
        </a>
      ) : null}
      {/* BUILT-only "See the full build" affordance (run-lifecycle 4/4 — issue #233), GATED on the disclosure
          (issue #239). It used to be a SEPARATE, unconditionally-rendered element in `reader-shell.tsx`
          (a Client Component), keyed off nothing but the static BUILT branch — so a timeline-less BUILT
          lesson (a legacy build with zero `step_event` rows, `buildSummaryModel` → `null`) still showed the
          link, pointing at the frozen `/workflow` page's empty all-"didn't run" shell.
          #239's fix moved it HERE, into the SAME async unit as the disclosure it escalates from, rather
          than trying to gate on the disclosure's PRESENCE from the client side: `BuildSummary` above already
          returns `null` (no render at all) when `buildSummaryModel` finds nothing to disclose, so a
          timeline-less lesson takes NEITHER this link NOR `<details className="build-summary">` past this
          function — there is no second, independently-evaluated condition to drift out of sync. (An earlier
          version of this fix tried gating in the CLIENT `ReaderShell` on `Boolean(buildSummaryProp)`; that
          measurably failed in e2e — a Server Component element crossing into a Client Component prop is a
          React "lazy reference" object, always truthy in a synchronous JS check, even when it is ABOUT to
          render as nothing. Co-locating both nodes in this one async component sidesteps that boundary
          entirely: by the time this function returns, `model` is already resolved, so `!degraded` is a
          plain, reliable boolean — never a lazy reference.) Reuses the SAME `workflowHref` the degraded
          link above uses (same route, different disposition, different copy) — no new prop, no page.tsx
          change; `reader-shell.tsx` renders this file's whole output as one opaque `buildSummary` node. */}
      {!degraded && workflowHref ? (
        <a className="reader-build-link" href={workflowHref}>
          See the full build
          <span className="reader-build-link__arrow" aria-hidden="true">
            →
          </span>
        </a>
      ) : null}
    </>
  );
}
