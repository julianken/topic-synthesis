import type { InFlightCard as InFlightCardRow } from '../store/repo';
import { PosterMark } from './poster-mark';
import { INFLIGHT_BADGE_CLASS, INFLIGHT_BADGE_ICON, INFLIGHT_BADGE_LABEL, inflightMetaLine } from './library-card';

/**
 * The library home's IN-FLIGHT tile (run-lifecycle 2/4, #231) — a run that has been DISPATCHED but whose
 * lesson has not yet persisted, rendered as a distinct generating card the moment the run starts so a
 * user can navigate INTO the workflow (the owner's intent). Implemented to Figma node `98:2` ("Library
 * card — in progress (generating)"), a variant of the dense poster `6:2`: the run topic as the serif
 * title, an accent-cyan **⟳ Generating** badge (label + icon, never color alone), the `level · d{depth}`
 * settings meta in the built footer rhythm, with NO subject eyebrow and NO description (an in-flight run
 * has neither yet). It REUSES the built poster's chrome (`.library-poster__*`), with the poster-wash
 * quieted to a "forming" state and the `--inflight` modifier (globals.css). Every paint maps to a §0
 * token (the pre-code Figma review confirmed this) — no §0 retoken.
 *
 * A SERVER component (no interactivity): a plain `<li>` + a plain cross-document `<a href="/lesson/[id]">`
 * to the #225 single generating screen. It is rendered OUTSIDE `<PosterCard>` and does NOT consume the
 * `<LibraryProvider>` selection context (no `useLibrary`/`PosterControls`), so the in-flight run — which
 * has no persisted lesson row to soft-delete — is never selectable and has no delete affordance (#231 AC10).
 * It carries NO `view-transition-name`: the card→reader box-FLIP morph is for PERSISTED posters; an
 * in-flight tile is a plain navigation to the generating screen, not a morph origin.
 */
export function InFlightCard({ card }: { card: InFlightCardRow }) {
  const meta = inflightMetaLine(card.level, card.depth);
  return (
    <li className="library-poster library-poster--inflight">
      <a className="library-poster__card" href={`/lesson/${encodeURIComponent(card.id)}`}>
        <span className="library-poster__wash" aria-hidden="true">
          <PosterMark />
        </span>
        <span className="library-poster__body">
          <span className="library-poster__head">
            {/* The run topic as the serif title (Figma 98:2 — the dense card's title lifted to the head;
                no eyebrow / description rows, which an in-flight run has no data for). */}
            <span className="library-poster__title">{card.topic}</span>
          </span>
          <span className="library-poster__foot">
            {/* The Generating badge (NOT a built/soon/text PageStatus badge): label + icon, never color
                alone (§Accessibility). The accent-cyan paint + neutral border live in globals.css. */}
            <span className={INFLIGHT_BADGE_CLASS}>
              <span className="badge__icon" aria-hidden="true">
                {INFLIGHT_BADGE_ICON}
              </span>{' '}
              {INFLIGHT_BADGE_LABEL}
            </span>
            <span className="library-poster__meta">{meta}</span>
          </span>
        </span>
      </a>
    </li>
  );
}
