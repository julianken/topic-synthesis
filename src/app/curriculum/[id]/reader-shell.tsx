'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { deriveApparatus, type ApparatusModel } from './apparatus-state';
import { postScrollTo } from './lesson-scroll-sender';
import { INITIAL_READER_CHROME, reduceReaderMessage } from './reader-message';
import { morphName } from './reader-morph';

/**
 * The reader shell for a BUILT single lesson (TS-20, Phase 3 — FRAME). It frames the unchanged
 * opaque-origin lesson iframe in the v11 reader chrome: a reading-progress affordance + a section
 * list driven by the decision-12 `postMessage` channel, and the `#readerPanel.morph-box` wrapper
 * that is the card→reader FLIP destination. The box-only container-transform is animated by the
 * route-level cross-document View-Transition transport + box-geometry tween in `globals.css` (TS-21,
 * keyed to the per-id `view-transition-name` this shell sets inline); this component itself adds no
 * View-Transition rule and no scripted transition call — the morph is pure CSS at the route boundary.
 *
 * Trust boundary (UNCHANGED — Key-decision 1): the iframe stays `sandbox="allow-scripts"` WITHOUT
 * `allow-same-origin` (opaque origin) and `src` points at the `/artifact` route's strict-CSP HTML.
 * This component NEVER reads the iframe DOM; it learns the lesson's progress/sections ONLY from
 * posted messages, validated by identity (TS-13's `validateMessage`, via `reduceReaderMessage`) —
 * never by `event.origin` (which is the literal `"null"` across the opaque boundary).
 *
 * Best-effort chrome (decision 13): a lesson that posts nothing (a blob-arm lesson, or one that
 * doesn't emit the sender) leaves the chrome at its empty/zero initial state — the shell stays fully
 * usable over a bare iframe, never an error, never a blank frame.
 *
 * Lesson-workspace grid (PR-A — the grid foundation): the shell lays the reader out on the LOCKED
 * named-line CSS grid from DESIGN.md "## Lesson layout" + the measured prototype
 * (.superpowers/lesson-workspace/prototype.html) — `[screen-start] edge [read-start] measure [read-end]
 * gap [panel-start] panel [panel-end] scrub [scrub] edge [screen-end]`, capped at --frame-max and
 * centered. The [read] track holds the UNCHANGED #readerPanel.morph-box + sandboxed iframe. A
 * per-section `grid-template-columns: subgrid` is the STABLE SPINE so prose lands on one identical
 * [read] track (Δ0px, pure CSS — no JS x-math). The grid metrics are component-local --ws-* tokens
 * (globals.css) consuming the existing §0 geometry tokens — NO §0 retoken. The trust boundary, the
 * iframe attrs, and the card→reader box-only morph are byte-unchanged.
 *
 * Apparatus panel (PR-B): the [panel] track now carries the apparatus stack (`container-type:
 * inline-size`, so the cards scale to --panel-w, not the viewport), and the [scrub] track carries the
 * section dot-rail. BOTH are fed ONLY by the SHIPPED coordinate-only `{ sections, scrollProgress }`
 * channel (`deriveApparatus` folds it into the where-am-i + scrubber model) — the chrome NEVER reads the
 * iframe DOM. The where-am-i widget surfaces only what that channel TRUTHFULLY carries: the EXACT overall
 * percent + a progress-fill strip, the posted section LIST (moved OUT of the old flat pill strip INTO the
 * widget), and an EXPLICITLY APPROXIMATE position ("≈ around section N of M") — because the channel has no
 * posted active-section signal, deriving a confident discrete NN/total would be a fabricated mapping
 * (the reviewer's MAJOR finding; AGENTS.md anti-invention). The scrubber's approximate dot is labeled
 * "(approx. here)" for the same reason. The RICHER cards (gloss,
 * mini-figure, source, self-check, takeaways) render EMPTY/best-effort PLACEHOLDERS labeled as awaiting
 * data — their real content is a coordinate-only payload EXTENSION that PR-F adds + the in-iframe sender
 * pushes (lesson-message.ts is UNCHANGED here; no DOM scrape). Decision-13 best-effort: a lesson posting
 * nothing leaves every card empty/zero and the shell fully usable.
 *
 * Scrub-rail section jump (PR-C): the [scrub] track's dot-rail is now KEYBOARD-OPERABLE jump controls.
 * Each dot is a <button> labeled with its section name + position (status by style AND aria-label, never
 * color alone); the active/done state is driven by the SHIPPED { sections, scrollProgress } channel
 * (`deriveApparatus`). Activating a dot posts the COORDINATE-ONLY parent→child message
 * `{ type: 'lesson:scrollTo', id }` INTO the iframe via `postScrollTo` (targeting the opaque-origin token
 * 'null', NEVER '*' — lesson-scroll-sender.ts), the OUTBOUND counterpart to lesson-message.ts's receive
 * side. The chrome NEVER reaches into the iframe DOM to scroll it — the post is the only legal channel
 * across the opaque boundary. PR-C ships the SENDER (best-effort): the post is harmless + inert until PR-F
 * teaches the generated lesson to RECEIVE this verb and scroll itself; lesson-message.ts is UNCHANGED.
 */
export function ReaderShell({ id, href, title }: { id: string; href: string; title: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [chrome, setChrome] = useState(INITIAL_READER_CHROME);

  // The coordinate-only parent→child section-jump SENDER (PR-C). Reads the iframe's contentWindow IDENTITY
  // only (the post target) — never the framed DOM. Guarded for a not-yet-loaded iframe (postScrollTo no-ops
  // on a null window). Best-effort: the lesson acts on it once PR-F adds the receiver.
  const jumpToSection = useCallback((sectionId: string) => {
    postScrollTo(iframeRef.current?.contentWindow ?? null, sectionId);
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      // Delegate the WHOLE trust + untrusted-parse decision to the pure reducer (→ validateMessage).
      // We pass the iframe's contentWindow as the only trusted sender and NEVER look at event.origin.
      const next = reduceReaderMessage({
        source: event.source,
        expectedWindow: iframeRef.current?.contentWindow ?? null,
        payload: event.data,
      });
      // null === ignore (untrusted source / off-contract payload): leave the chrome untouched — no
      // DOM write is driven by an ignored event's payload (AC5). Only a valid message updates state.
      if (next) setChrome(next);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const pct = Math.round(chrome.scrollProgress * 100);
  // Fold the SHIPPED coordinate-only state into the apparatus model — coordinate-only, no DOM read.
  const apparatus = deriveApparatus(chrome.sections, chrome.scrollProgress);

  return (
    <div className="reader reader--ws">
      <ReadingProgress percent={pct} />

      {/*
        The LOCKED named-line workspace grid (PR-A). `.ws-grid` carries the exact line set
        `[screen-start] edge [read-start] measure [read-end] gap [panel-start] panel [panel-end] scrub
        [scrub] edge [screen-end]` (globals.css), capped at --frame-max + centered. A single `.ws-section`
        is a `subgrid` (the stable spine) holding three tracks: the [read] reading column (the morph-box +
        iframe, byte-unchanged), the [panel] apparatus stack (PR-B — the where-am-i widget + section list
        LIVE from the posted { sections, scrollProgress }, the richer cards best-effort placeholders), and
        the [scrub] section dot-rail (PR-B). All apparatus is fed coordinate-only — no iframe DOM read.
      */}
      <div className="ws-grid">
        <section className="ws-section">
          <div className="ws-read">
            {/*
              The card→reader morph's FLIP DESTINATION. The `view-transition-name` is set INLINE and is
              id-scoped — `morphName(id)` (= `lesson-card-<id>`) — so it equals the per-card name TS-17
              stamps on the FLIP ORIGIN (`library-card.ts`'s `morphName`). A cross-document View-Transition
              only pairs an old/new snapshot when the two names are IDENTICAL, so a per-card origin needs a
              per-id destination here — a single global name would never pair. TS-21's route-level
              cross-document View-Transition transport (in globals.css) then pairs BOTH endpoints and
              tweens the box. The morph is BOX-ONLY per the TS-5b verdict — the container box geometry-FLIPs
              while the opaque iframe contents "jump in" at the final frame (the iframe's sandbox +
              ARTIFACT_CSP are byte-unchanged across the morph). The animation lives in globals.css, NOT
              here — this box only carries the inline per-id endpoint name. Moving the box into the [read]
              track is a layout change ONLY: the element, its id/class, and its inline name are unchanged.
            */}
            <div id="readerPanel" className="morph-box" style={{ viewTransitionName: morphName(id) }}>
              {/*
                The lesson iframe — attributes BYTE-UNCHANGED from the bare render (AC2): opaque origin via
                `sandbox="allow-scripts"` WITHOUT `allow-same-origin`, `src` at the strict-CSP `/artifact`
                route. The ref is read only for its `contentWindow` IDENTITY (the trusted postMessage
                sender) — never to read the framed DOM.
              */}
              <iframe
                ref={iframeRef}
                className="artifact-frame"
                title={title}
                src={href}
                sandbox="allow-scripts"
              />
            </div>
          </div>

          {/*
            The [panel] apparatus track (PR-B). Carries `container-type: inline-size` (globals.css) so the
            cards scale to --panel-w, not the viewport. The where-am-i widget + the section list LIGHT UP
            from the SHIPPED { sections, scrollProgress } channel; the richer cards are best-effort
            placeholders awaiting the PR-F payload extension. All copy is user-facing — no internals.
          */}
          <aside className="ws-panel" aria-label="Lesson apparatus">
            <ApparatusPanel model={apparatus} />
          </aside>

          {/*
            The [scrub] dot-rail track (PR-C — the scrub rail + section jump). Reserved INSIDE the capped
            frame (never viewport-pinned), `justify-self: center` in the --scrub-w track. One dot per
            SHIPPED section; each dot is now a KEYBOARD-OPERABLE <button> jump control (focusable, Enter/
            Space-activated by the platform). The active/done state is driven by { sections, scrollProgress }
            (deriveApparatus). Status is encoded by style AND the aria-label (never color alone). Activating
            a dot posts the COORDINATE-ONLY parent→child message `{ type:'lesson:scrollTo', id }` INTO the
            iframe (postScrollTo → opaque-origin token 'null', never '*') — the chrome NEVER reaches into
            the iframe DOM. Best-effort: the scroll LANDS once PR-F teaches the lesson to receive it. The
            rail is hidden when no sections have been posted (the empty state) and folds away on the ≤900
            single-column collapse (globals.css → a TOC there).
          */}
          <nav className="ws-scrub" aria-label="Jump to section">
            {apparatus.hasSections && (
              <ol className="ws-scrub__rail">
                {apparatus.marks.map((mark) => (
                  <li key={mark.id}>
                    <button
                      type="button"
                      className="ws-scrub__dot"
                      data-done={mark.done || undefined}
                      data-active={mark.active || undefined}
                      aria-current={mark.active ? 'true' : undefined}
                      // The jump: post the coordinate-only `lesson:scrollTo` INTO the iframe (never a DOM
                      // reach). Best-effort — inert until PR-F's receiver lands.
                      onClick={() => jumpToSection(mark.id)}
                      // Status by LABEL, not color alone (§Accessibility): the ordinal + posted title +
                      // the read state. The label also carries the "jump to" affordance so the control is
                      // self-describing. The title is inert React-escaped text (validator-stripped to
                      // {id, title}), never innerHTML/href. "approx." because the active dot is estimated
                      // from overall scroll, not a posted active-section signal.
                      aria-label={`Jump to section ${String(mark.ordinal)}: ${mark.title}${
                        mark.active ? ' (approx. here)' : mark.done ? ' (read)' : ''
                      }`}
                    />
                  </li>
                ))}
              </ol>
            )}
          </nav>
        </section>
      </div>
    </div>
  );
}

/**
 * The apparatus panel (PR-B) — the [panel] track's card stack, fed ONLY by the SHIPPED coordinate-only
 * `{ sections, scrollProgress }` channel (already folded into `model` by `deriveApparatus`). The
 * where-am-i widget + the section list are LIVE (they light up from the posted data); the richer cards
 * are best-effort placeholders that clearly read as awaiting data until PR-F extends the payload. Pure
 * presentation — it reads no DOM and holds no state; a model with no sections renders the empty state.
 */
function ApparatusPanel({ model }: { model: ApparatusModel }) {
  return (
    <div className="ws-app">
      {/*
        1 — WHERE-AM-I widget. HONESTY (the reviewer's MAJOR finding): the SHIPPED channel carries only an
        OVERALL `scrollProgress` scalar — no posted active-section signal — so the widget leads with the two
        EXACT facts (the percent read + the full section list) and presents position as an explicit ESTIMATE
        ("≈ section N of M", `model.approximate`), never a confident tracked `NN/total` count. The segment
        strip is an OVERALL-progress visualization (its filled count mirrors the scalar), aria-hidden because
        the legible-by-number percent already conveys it. When a future payload adds a real active-section
        signal, `model.approximate` flips false and the "≈" framing can become exact — no channel change.
      */}
      <div className="ws-card ws-where">
        <p className="ws-card__eyebrow">Where you are</p>
        {model.hasSections ? (
          <>
            {/* EXACT, posted: the overall reading percent, legible by number. */}
            <p className="ws-where__percent" aria-label={`${String(model.percent)} percent through this lesson`}>
              {model.percent}
              <span className="ws-where__pct-sign">%</span> read
            </p>
            <div
              className="ws-where__strip"
              aria-hidden="true"
              // overall-progress fill width, driven by the EXACT posted percent (not the estimated index).
              style={{ ['--ws-where-pct' as string]: `${String(model.percent)}%` }}
            >
              <span className="ws-where__seg-fill" />
            </div>
            {/* ESTIMATE, clearly labeled: position inferred from the overall scalar, never claimed exact. */}
            <p className="ws-where__approx">
              <span className="ws-where__approx-sign" aria-hidden="true">
                ≈{' '}
              </span>
              around section {model.activeOrdinal} of {model.total}
              {model.activeTitle ? <span className="ws-where__approx-title"> · {model.activeTitle}</span> : null}
            </p>
            {/*
              The section LIST (exact, posted) — moved OUT of the old flat pill strip INTO the widget. Inert,
              React-escaped titles (the validator stripped each entry to {id, title}). The approximate
              position gets a SOFT highlight by style AND aria-current — but the heading copy above makes
              clear it is an estimate, so the highlight reads as "about here", not a tracked "you are here".
            */}
            <ol className="ws-where__list">
              {model.marks.map((mark) => (
                <li
                  key={mark.id}
                  className="ws-where__item"
                  data-done={mark.done || undefined}
                  data-active={mark.active || undefined}
                  aria-current={mark.active ? 'true' : undefined}
                >
                  <span className="ws-where__ord">{String(mark.ordinal).padStart(2, '0')}</span>
                  {mark.title}
                </li>
              ))}
            </ol>
          </>
        ) : (
          // Decision-13 best-effort empty state: a lesson that posts nothing leaves the widget usable
          // and honest — never a blank card, never an error.
          <p className="ws-where__blurb ws-empty">Section progress appears here as you read.</p>
        )}
      </div>

      {/*
        2–6 — the RICHER cards. Their real content is a coordinate-only payload EXTENSION (PR-F) the
        in-iframe sender will push; in PR-B they render as best-effort placeholders that clearly read as
        awaiting data, so the panel shape is real now and a lesson posting nothing never crashes. Each is
        labeled with its purpose (user-facing copy, no internals) and a "soon" awaiting-data hint.
      */}
      <ApparatusPlaceholder className="ws-glosscard" eyebrow="Key terms" hint="Key terms appear here as you reach them." />
      <ApparatusPlaceholder className="ws-fig" eyebrow="Figure" hint="Diagrams appear beside the steps they illustrate." />
      <ApparatusPlaceholder className="ws-src" eyebrow="Source" hint="Cited sources appear beside the claims they support." />
      <ApparatusPlaceholder className="ws-check" eyebrow="Self-check" hint="Check-yourself prompts appear here as you go." />
      <ApparatusPlaceholder className="ws-take" eyebrow="Takeaways" hint="A recap appears here at the end." />
    </div>
  );
}

/**
 * One best-effort apparatus card placeholder (PR-B). Renders its purpose eyebrow + an awaiting-data hint;
 * marked `data-awaiting` so the styling + the e2e can recognize a card whose richer data (PR-F) has not
 * arrived. Copy is user-facing — it never names a pipeline stage, a payload field, or any internal.
 */
function ApparatusPlaceholder({
  className,
  eyebrow,
  hint,
}: {
  className: string;
  eyebrow: string;
  hint: string;
}) {
  return (
    <div className={`ws-card ${className}`} data-awaiting="true">
      <p className="ws-card__eyebrow">{eyebrow}</p>
      <p className="ws-card__hint">{hint}</p>
    </div>
  );
}

/**
 * The reading-progress affordance (DESIGN.md `## Components` → "Reading progress"). A labeled bar +
 * a tabular-figure percent readout, so the status is legible by NUMBER, not color alone (§Accessibility).
 * The fill width is driven by the posted `scrollProgress` scalar; under `prefers-reduced-motion` the
 * fill updates instantly (the transition is removed in `globals.css`, §Motion).
 */
function ReadingProgress({ percent }: { percent: number }) {
  return (
    <div
      className="reading-progress"
      role="progressbar"
      aria-label="Reading progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <div className="reading-progress__track">
        <div className="reading-progress__fill" style={{ width: `${percent}%` }} />
      </div>
      <span className="reading-progress__label">{percent}%</span>
    </div>
  );
}
