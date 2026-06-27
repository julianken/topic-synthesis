'use client';

import { useEffect, useRef, useState } from 'react';
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
 */
export function ReaderShell({ id, href, title }: { id: string; href: string; title: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [chrome, setChrome] = useState(INITIAL_READER_CHROME);

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

  return (
    <div className="reader">
      <ReadingProgress percent={pct} />

      {/*
        The card→reader morph's FLIP DESTINATION. The `view-transition-name` is set INLINE and is
        id-scoped — `morphName(id)` (= `lesson-card-<id>`) — so it equals the per-card name TS-17 stamps
        on the FLIP ORIGIN (`library-card.ts`'s `morphName`). A cross-document View-Transition only pairs
        an old/new snapshot when the two names are IDENTICAL, so a per-card origin needs a per-id
        destination here — a single global name would never pair. TS-21's route-level cross-document
        View-Transition transport (in globals.css) then pairs BOTH endpoints and tweens the box. The
        morph is BOX-ONLY per the TS-5b verdict — the container box geometry-FLIPs while the opaque
        iframe contents "jump in" at the final frame (the iframe's sandbox + ARTIFACT_CSP are
        byte-unchanged across the morph). The animation lives in globals.css, NOT here — this box only
        carries the inline per-id endpoint name.
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

      {chrome.sections.length > 0 && (
        <nav className="reader-sections" aria-label="Lesson sections">
          <ol>
            {chrome.sections.map((section) => (
              // Coordinate-only data rendered as INERT text — the validator stripped every field but
              // {id, title}; the title is set as a text child (React-escaped), never innerHTML/href.
              <li key={section.id} className="reader-sections__item">
                {section.title}
              </li>
            ))}
          </ol>
        </nav>
      )}
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
