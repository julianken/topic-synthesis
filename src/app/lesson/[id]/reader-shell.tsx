'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { deriveApparatus, type ApparatusModel } from './apparatus-state';
import type { LessonApparatus } from './lesson-message';
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
 * "(approx. here)" for the same reason. The RICHER cards (key terms, figure caption, source, self-check,
 * takeaways) now render REAL data from the OPTIONAL coordinate-only `apparatus` EXTENSION (PR-F): the
 * in-iframe sender serializes the values the lesson already contains (its glosses/figures/sources/checks/
 * takeaways) as bounded TEXT-only data in the SAME `lesson:progress` message, `validateMessage` sanitizes
 * it (bounded counts/lengths, http(s)-only URLs, no DOM scrape), and each card renders that data —
 * falling back to its best-effort PLACEHOLDER when its field is absent/empty. Decision-13 best-effort: a
 * lesson posting nothing (or only the old `{sections, scrollProgress}` shape) leaves the cards as
 * placeholders and the shell fully usable — never a crash, never a fabricated value. A source `url` is a
 * validated `rel="noopener"` link; everything else is React-escaped text (never `innerHTML`).
 *
 * Integrated topbar + Focus-reading (PR-D): the bare reading-progress bar under the generic page header is
 * replaced by a 54px frosted TOPBAR — the ONLY chrome OUTSIDE the iframe. A `1fr auto 1fr` bar (back-to-
 * Library link · the two-tone topic·synthesis wordmark REUSING the shipped `.appbar` tokens · the ⌘K/⇧F
 * chord chips + the user pill, reusing the shipped `.appbar__chip`/avatar/name look). The READING-PROGRESS
 * hairline sits at y=0 across the bar (the SHIPPED `ReadingProgress`, role=progressbar + aria-valuenow,
 * restyled into the 2.5px --brand-gradient hairline), driven PURELY by the posted scrollProgress scalar — no
 * DOM read into the opaque iframe. Wordmark + chips HIDE ≤640px (DESIGN.md invariant). FOCUS-READING (Shift+F
 * or the labeled button) is a pure-CHROME CSS state that hides the [panel] + [scrub] tracks and re-centers/
 * widens the reading spine — NO postMessage, the morph + lesson-message.ts UNCHANGED. The integrated topbar
 * suppresses the global `<SessionNav>` appbar via a `body.has-ws-topbar` class (set on mount). NO §0 retoken
 * (component-local --ws-* + reuse of the §0/appbar tokens).
 *
 * Scrub-rail section jump (PR-C): the [scrub] track's dot-rail is now KEYBOARD-OPERABLE jump controls.
 * Each dot is a <button> labeled with its section name + position (status by style AND aria-label, never
 * color alone); the active/done state is driven by the SHIPPED { sections, scrollProgress } channel
 * (`deriveApparatus`). Activating a dot posts the COORDINATE-ONLY parent→child message
 * `{ type: 'lesson:scrollTo', id }` INTO the iframe via `postScrollTo` (which TRIES the documented opaque-
 * origin token 'null' but, because Chromium rejects 'null' for an opaque-origin frame, actually ships on
 * the '*' fallback — safe for this non-navigable sandbox; see lesson-scroll-sender.ts), the OUTBOUND
 * counterpart to lesson-message.ts's receive
 * side. The chrome NEVER reaches into the iframe DOM to scroll it — the post is the only legal channel
 * across the opaque boundary. PR-C ships the SENDER (best-effort): the post is harmless + inert until PR-F
 * teaches the generated lesson to RECEIVE this verb and scroll itself; lesson-message.ts is UNCHANGED.
 *
 * Responsive + a11y + mobile TOC (PR-E — the FINAL chrome piece): on the ≤900 single-column collapse the
 * in-frame [scrub] dot-rail (which has no room in one column) folds away and is REPLACED by a labeled phone
 * TOC DISCLOSURE (`.ws-toc`) — a "Sections" toggle (aria-expanded + aria-controls) over a collapsible list
 * of jump controls; tapping one posts the SAME coordinate-only `lesson:scrollTo` the desktop dots use, so
 * the section jump survives the collapse. All controls meet the WCAG 2.2 SC 2.5.8 ≥24×24 target floor. The
 * a11y pass is holistic: a logical topbar→prose→panel→scrub tab order (DOM order, no positive tabindex),
 * SR landmarks/labels on every region (the topbar, the apparatus aside, both section navs), and state by
 * aria (aria-current/aria-pressed/aria-expanded/aria-valuenow), never color alone. Every workspace motion
 * (hairline, focus-widen, card reveal, scrub/dot state, the TOC chevron) is zeroed under reduced motion and
 * the card→reader morph's View-Transition transport runs ONLY under no-preference (the rule lives in
 * globals.css, not here). NO postMessage contract change, NO §0 retoken, the trust boundary + morph
 * BYTE-UNCHANGED (lesson-message.ts edits are COMMENT-ONLY).
 */
export function ReaderShell({
  id,
  href,
  title,
  userName,
  head,
}: {
  id: string;
  href: string;
  title: string;
  /** The signed-in account's friendly display name — derived in page.tsx via the SHARED
   *  session-nav `displayName` so the topbar's user pill matches the global appbar's exactly. */
  userName: string;
  /** The reader header content (eyebrow/title/level/depth) — rendered BELOW the integrated topbar so the
   *  topbar is the page's TOP chrome (PR-D), aligned to the [read] spine via `.reader-head`. */
  head: { eyebrow: string; title: string; level: string; depth: number };
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [chrome, setChrome] = useState(INITIAL_READER_CHROME);
  // Focus-reading (Shift+F): a pure-CHROME CSS state on the workspace that hides the [panel] + [scrub]
  // tracks and re-centers/widens the reading spine (globals.css `.reader--ws[data-focus] .ws-grid`). It is
  // a chrome-local toggle — NO postMessage into the iframe, the morph + lesson-message.ts untouched.
  const [focus, setFocus] = useState(false);
  // Mobile section-jump TOC (PR-E): on the ≤900 single-column collapse the in-frame [scrub] dot-rail folds
  // away (it has no room) and is REPLACED by a labeled phone TOC DISCLOSURE — a collapsed "Sections" list
  // shown only ≤900 (globals.css `.ws-toc`). `tocOpen` drives the disclosure's expand/collapse + the
  // toggle's aria-expanded; collapsed, the list carries the `hidden` attr so it leaves BOTH the a11y tree
  // and the tab order. Tapping an item posts the SAME coordinate-only parent→child `lesson:scrollTo` the
  // desktop scrub dots use (via `jumpToSection`/`postScrollTo`) so the section jump survives the collapse —
  // chrome-only state, the trust boundary + lesson-message.ts UNCHANGED.
  const [tocOpen, setTocOpen] = useState(false);

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

  // Shift+F toggles Focus-reading from the keyboard (the labeled button toggles it too — two affordances,
  // one state). Ignore the chord while typing in a field, and never swallow a browser/native shortcut
  // (no modifier other than Shift). The handler is window-level so the chord works without focusing the
  // button first; the SENDER/receiver boundary is untouched (this is chrome-only state).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      // Shift+F (case-insensitive on the produced char). `event.key` is 'F' with Shift held.
      if (!event.shiftKey || event.key.toLowerCase() !== 'f') return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
      event.preventDefault();
      setFocus((on) => !on);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // The integrated topbar REPLACES the bare global appbar on the built reader route (the global
  // <SessionNav> appbar is hidden under `body.has-ws-topbar`); mark the body on mount, restore on unmount
  // so the library / degraded routes keep their global appbar. A nested client component can't reach the
  // appbar (a layout sibling above it in the DOM), so a body class is the robust suppression seam.
  useEffect(() => {
    document.body.classList.add('has-ws-topbar');
    return () => document.body.classList.remove('has-ws-topbar');
  }, []);

  const pct = Math.round(chrome.scrollProgress * 100);
  // Fold the SHIPPED coordinate-only state into the apparatus model — coordinate-only, no DOM read.
  const apparatus = deriveApparatus(chrome.sections, chrome.scrollProgress);
  const initial = (userName[0] ?? '?').toUpperCase();

  return (
    <div className="reader reader--ws" data-focus={focus || undefined}>
      {/*
        The integrated 54px frosted TOPBAR (PR-D) — the ONLY chrome outside the iframe, a `1fr auto 1fr`
        bar: left = a back-to-Library link; center = the two-tone topic·synthesis wordmark (REUSING the
        shipped `.appbar` tokens 1:1); right = the ⌘K / ⇧F chord chips + the user pill (reusing the
        shipped `.appbar__chip` / avatar / name look). The READING-PROGRESS hairline sits at y=0 across the
        bar, driven PURELY by the posted scrollProgress scalar — no DOM read into the opaque iframe.
        Wordmark + chord chips HIDE ≤640px (DESIGN.md invariant) so the bar never overflows the narrow
        viewport; the user pill alone anchors the right on mobile.
      */}
      <header className="ws-topbar appbar" aria-label="Lesson workspace">
        {/* y=0 reading-progress hairline — REUSES the shipped ReadingProgress affordance (role=progressbar
            + aria-valuenow), restyled by `.ws-topbar` into the 2.5px brand hairline; coordinate-only. */}
        <ReadingProgress percent={pct} />
        <div className="ws-topbar__left">
          {/* A plain <a> (not next/link) keeps the cross-document navigation that the card↔reader
              View-Transition transport rides — matching the library card's FLIP-origin link. */}
          <a className="ws-topbar__back" href="/">
            <span aria-hidden="true">←</span> Library
          </a>
        </div>
        <p className="appbar__wordmark ws-topbar__wordmark">
          topic·<span className="appbar__wordmark-accent">synthesis</span>
        </p>
        <div className="ws-topbar__right">
          <div className="ws-topbar__chips" aria-hidden="true">
            {/* Chord HINT for the ⌘K jumper (a later pass). aria-hidden — a visual affordance reminder;
                the keyboard behavior itself is the real a11y surface. The ⇧F chord lives ON the
                Focus-reading button below (its kbd cap), so it isn't duplicated as a separate chip. */}
            <span className="ws-topbar__chip">
              Jump to <kbd className="ws-topbar__kbd">⌘K</kbd>
            </span>
          </div>
          {/* The Focus-reading control — a labeled, keyboard-operable toggle (the visible counterpart to
              the Shift+F chord, carrying the ⇧F kbd chip itself). aria-pressed reflects the state;
              aria-keyshortcuts announces the chord to AT. */}
          <button
            type="button"
            className="ws-topbar__focus"
            aria-pressed={focus}
            aria-keyshortcuts="Shift+F"
            // A stable accessible name so the control is self-describing even when the text label is
            // visually compacted to the ⇧F glyph at ≤640 (the label span is hidden there to fit the bar).
            aria-label={focus ? 'Exit focus reading' : 'Focus reading'}
            onClick={() => setFocus((on) => !on)}
          >
            <span className="ws-topbar__focus-label">{focus ? 'Exit focus' : 'Focus reading'}</span>
            <kbd className="ws-topbar__kbd" aria-hidden="true">
              ⇧F
            </kbd>
          </button>
          <div className="appbar__chip ws-topbar__pill">
            <span className="appbar__avatar" aria-hidden="true">
              {initial}
            </span>
            <span className="appbar__name">{userName}</span>
          </div>
        </div>
      </header>

      {/* The reader header (eyebrow → title → level/depth), BELOW the topbar, aligned to the [read] spine
          (`.reader-head` caps at --measure, offset by --edge-gap) so it sits OVER the prose column. */}
      <div className="reader-head">
        <p className="eyebrow">{head.eyebrow}</p>
        <h1>{head.title}</h1>
        <p className="lead">
          {head.level} · depth {head.depth}
        </p>
      </div>

      {/*
        Mobile section-jump TOC (PR-E) — shown ONLY on the ≤900 single-column collapse (globals.css hides
        it on desktop, where the in-frame [scrub] dot-rail is the section nav instead). A labeled DISCLOSURE:
        a "Sections" toggle (aria-expanded + aria-controls) over a collapsible list of jump controls. The
        list carries `hidden` while collapsed, so it leaves the a11y tree AND the tab order until opened.
        Tapping an item posts the SAME coordinate-only parent→child `lesson:scrollTo` the desktop dots use
        (`jumpToSection` → `postScrollTo`, target 'null' → '*' fallback), then collapses the disclosure — the
        chrome NEVER reaches into the iframe DOM. Rendered only when sections have been posted (best-effort).
      */}
      {apparatus.hasSections && (
        <nav className="ws-toc" aria-label="Sections">
          <button
            type="button"
            className="ws-toc__toggle"
            aria-expanded={tocOpen}
            aria-controls="ws-toc-list"
            onClick={() => setTocOpen((open) => !open)}
          >
            <span className="ws-toc__toggle-label">Sections</span>
            <span className="ws-toc__count" aria-hidden="true">
              {apparatus.total}
            </span>
            {/* The chevron is decorative — aria-expanded on the button conveys the state to AT. It rotates
                via a §0-tier transform transition, zeroed under reduced motion by the global guard. */}
            <span className="ws-toc__chevron" aria-hidden="true" data-open={tocOpen || undefined} />
          </button>
          <ol id="ws-toc-list" className="ws-toc__list" hidden={!tocOpen}>
            {apparatus.marks.map((mark) => (
              <li key={mark.id}>
                <button
                  type="button"
                  className="ws-toc__item"
                  data-done={mark.done || undefined}
                  data-active={mark.active || undefined}
                  aria-current={mark.active ? 'true' : undefined}
                  // The jump: post the coordinate-only `lesson:scrollTo` INTO the iframe (never a DOM
                  // reach), then collapse the disclosure so the reader is back on the prose. Best-effort —
                  // inert until PR-F's in-lesson receiver lands (the seed stub acks it in the e2e).
                  onClick={() => {
                    jumpToSection(mark.id);
                    setTocOpen(false);
                  }}
                  // Status by LABEL, not color alone (§Accessibility) — mirrors the desktop dot's label:
                  // the ordinal + posted title + the explicit-approximate read state. "approx." because the
                  // active position is estimated from overall scroll, not a posted active-section signal.
                  aria-label={`Jump to section ${String(mark.ordinal)}: ${mark.title}${
                    mark.active ? ' (approx. here)' : mark.done ? ' (read)' : ''
                  }`}
                >
                  <span className="ws-toc__ord" aria-hidden="true">
                    {String(mark.ordinal).padStart(2, '0')}
                  </span>
                  <span className="ws-toc__item-title">{mark.title}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
      )}

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
            <ApparatusPanel model={apparatus} apparatus={chrome.apparatus} />
          </aside>

          {/*
            The [scrub] dot-rail track (PR-C — the scrub rail + section jump). Reserved INSIDE the capped
            frame (never viewport-pinned), `justify-self: center` in the --scrub-w track. One dot per
            SHIPPED section; each dot is now a KEYBOARD-OPERABLE <button> jump control (focusable, Enter/
            Space-activated by the platform). The active/done state is driven by { sections, scrollProgress }
            (deriveApparatus). Status is encoded by style AND the aria-label (never color alone). Activating
            a dot posts the COORDINATE-ONLY parent→child message `{ type:'lesson:scrollTo', id }` INTO the
            iframe (postScrollTo → tries 'null', ships on the '*' fallback Chromium forces for an opaque
            frame; safe for this non-navigable sandbox) — the chrome NEVER reaches into the iframe DOM.
            Best-effort: the scroll LANDS once PR-F teaches the lesson to receive it. The
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
 * The apparatus panel (PR-B + PR-F) — the [panel] track's card stack, fed ONLY by the coordinate-only
 * `postMessage` channel (the chrome NEVER reads the iframe DOM). The where-am-i widget + the section
 * list come from `{ sections, scrollProgress }` (folded into `model` by `deriveApparatus`); the RICHER
 * cards (key terms / figure / source / self-check / takeaways) come from the OPTIONAL `apparatus`
 * EXTENSION (PR-F — `validateMessage` already sanitized it to bounded, text-only data). Each richer
 * card renders its REAL data when present and falls back to the existing best-effort PLACEHOLDER when
 * absent (decision-13 — a lesson posting only the old `{sections, scrollProgress}` shape still works,
 * never a crash, never a fabricated value). Pure presentation — it reads no DOM and holds no state.
 */
function ApparatusPanel({
  model,
  apparatus,
}: {
  model: ApparatusModel;
  apparatus?: LessonApparatus | undefined;
}) {
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
        2–6 — the RICHER cards (PR-F). Each renders its REAL content from the OPTIONAL `apparatus`
        extension when present (sanitized to bounded, TEXT-only data by `validateMessage` — no DOM
        scrape), and falls back to its best-effort PLACEHOLDER when absent (decision-13 — a lesson
        posting only the old shape, or nothing, still renders the panel shape, never a crash). All copy
        is user-facing — it never names a pipeline stage, a payload field, or any internal.
      */}
      <GlossCard glosses={apparatus?.glosses} />
      <FigureCard figures={apparatus?.figures} />
      <SourceCard sources={apparatus?.sources} />
      <SelfCheckCard checks={apparatus?.checks} />
      <TakeawaysCard takeaways={apparatus?.takeaways} />
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

/** Key terms (PR-F) — the posted glosses as a term→definition list, or the placeholder when none.
 *  Every value is React-escaped TEXT (the validator stripped each entry to {term, definition}). */
function GlossCard({ glosses }: { glosses?: LessonApparatus['glosses'] }) {
  if (!glosses || glosses.length === 0) {
    return (
      <ApparatusPlaceholder className="ws-glosscard" eyebrow="Key terms" hint="Key terms appear here as you reach them." />
    );
  }
  return (
    <div className="ws-card ws-glosscard" data-filled="true">
      <p className="ws-card__eyebrow">Key terms</p>
      <dl className="ws-gloss__list">
        {glosses.map((g, i) => (
          <div className="ws-gloss__row" key={`${g.term}-${String(i)}`}>
            <dt className="ws-gloss__term">{g.term}</dt>
            <dd className="ws-gloss__def">{g.definition}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Figure (PR-F) — the posted figure CAPTIONS as text (coordinate-only: the chrome never renders the
 *  lesson's actual figure, only its caption text), or the placeholder when none. */
function FigureCard({ figures }: { figures?: LessonApparatus['figures'] }) {
  if (!figures || figures.length === 0) {
    return (
      <ApparatusPlaceholder className="ws-fig" eyebrow="Figure" hint="Diagrams appear beside the steps they illustrate." />
    );
  }
  return (
    <div className="ws-card ws-fig" data-filled="true">
      <p className="ws-card__eyebrow">Figure</p>
      <ul className="ws-fig__list">
        {figures.map((f, i) => (
          <li className="ws-fig__caption" key={`${f.caption}-${String(i)}`}>
            {f.caption}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Source (PR-F) — the posted cited sources. The `url` was http(s)-validated by the sanitizer, so it
 *  renders as a SAFE `rel="noopener noreferrer"` link (never `dangerouslySetInnerHTML`); the title is
 *  escaped text. Falls back to the placeholder when none. */
function SourceCard({ sources }: { sources?: LessonApparatus['sources'] }) {
  if (!sources || sources.length === 0) {
    return (
      <ApparatusPlaceholder className="ws-src" eyebrow="Source" hint="Cited sources appear beside the claims they support." />
    );
  }
  return (
    <div className="ws-card ws-src" data-filled="true">
      <p className="ws-card__eyebrow">Source</p>
      <ul className="ws-src__list">
        {sources.map((s, i) => (
          <li className="ws-src__item" key={`${s.url}-${String(i)}`}>
            <a className="ws-src__link" href={s.url} target="_blank" rel="noopener noreferrer">
              {s.title}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Self-check (PR-F) — the posted prompts as a keyboard-operable predict-then-reveal: a native
 *  `<details>` gates the answer behind the prompt `<summary>`. Falls back to the placeholder when none. */
function SelfCheckCard({ checks }: { checks?: LessonApparatus['checks'] }) {
  if (!checks || checks.length === 0) {
    return (
      <ApparatusPlaceholder className="ws-check" eyebrow="Self-check" hint="Check-yourself prompts appear here as you go." />
    );
  }
  return (
    <div className="ws-card ws-check" data-filled="true">
      <p className="ws-card__eyebrow">Self-check</p>
      <ul className="ws-check__list">
        {checks.map((c, i) => (
          <li key={`${c.prompt}-${String(i)}`}>
            <details className="ws-check__item">
              <summary className="ws-check__prompt">{c.prompt}</summary>
              <p className="ws-check__answer">{c.answer}</p>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Takeaways (PR-F) — the posted recap bullets as escaped text, or the placeholder when none. */
function TakeawaysCard({ takeaways }: { takeaways?: LessonApparatus['takeaways'] }) {
  if (!takeaways || takeaways.length === 0) {
    return (
      <ApparatusPlaceholder className="ws-take" eyebrow="Takeaways" hint="A recap appears here at the end." />
    );
  }
  return (
    <div className="ws-card ws-take" data-filled="true">
      <p className="ws-card__eyebrow">Takeaways</p>
      <ul className="ws-take__list">
        {takeaways.map((t, i) => (
          <li className="ws-take__item" key={`${t}-${String(i)}`}>
            {t}
          </li>
        ))}
      </ul>
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
