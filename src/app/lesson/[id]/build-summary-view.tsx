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
 *  with no recorded steps), so the page renders no empty shell. */
export async function BuildSummary({
  id,
  disposition,
}: {
  id: string;
  disposition: LessonDisposition;
}) {
  const model = buildSummaryModel(await getStepEvents(id), disposition);
  if (!model) return null;
  return <BuildSummaryView model={model} />;
}

/**
 * The PURE, sync view (no DB, no DOM) — split out so a node-env render test can string-render it via
 * `react-dom/server` and pin the copy-gate over the REAL output. A native `<details>`: the ONLY
 * interactive target is the `<summary>` (the rows are inert). The expand rides the §0 catalog `--tr-state`
 * primitive (no new §0 token); a `:focus-visible` ring is on the summary; the box aligns to the reading
 * spine (`--frame-max` / `--edge-gap`) via `.build-summary`. Status is by label + icon, never colour alone.
 */
export function BuildSummaryView({ model }: { model: BuildSummaryModel }) {
  // Render from the 3-way disposition (issue #215): `data-degraded` (held|failed) keeps the existing CSS
  // hook unchanged, and `data-disposition` exposes the precise terminal state for finer styling/testing.
  const degraded = model.disposition !== 'built';
  return (
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
  );
}
