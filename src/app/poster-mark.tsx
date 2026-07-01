/**
 * The decorative line-art mark in a library poster card's top wash (Figma frame `6:2`, icon node `6:27`).
 *
 * Why a vector, not a per-lesson illustration: the FRAME-phase `LessonCard` (TS-16) carries no per-category
 * thumbnail data source — the Figma's four distinct category illustrations have no metadata to drive them
 * (DESIGN.md §Components → Library). So rather than fabricate a category icon (which would imply metadata the
 * card does not hold), the wash carries a single neutral `topic·synthesis` motif: a node-graph (a ringed hub
 * wired to two satellites), the product's own "synthesize a topic into a lesson" emblem. It is purely
 * decorative chrome (`aria-hidden`), drawn in `currentColor` so the §0 wash tint drives its color (no
 * hardcoded hex). DESIGN.md sanctions the single neutral mark; only its SCALE is fixed here.
 *
 * Scale + geometry mirror the Figma poster-icon silhouette (`6:27`/`6:28`). The Figma emblem is LARGE — its
 * group bounding box (`6:28`) is ~168.6×56.5px centred in the 277.9×103.2px wash, i.e. the node-graph spreads
 * ACROSS the band rather than huddling at its centre. The earlier 64×36 glyph read as a tiny mark in a near-
 * empty band; this `viewBox` is the wash's own 278×104 coordinate space so the geometry maps 1:1, and the CSS
 * sizes the SVG to fill ~78% of the wash width (the frame's silhouette footprint). The hub sits upper-left, a
 * larger satellite upper-right and a smaller satellite lower-right, both wired to the hub by thin edges. Node
 * positions/radii match the rendered `6:27` emblem (hub centre ~78,47 r26; satellites ~188,38 r13 / ~212,67
 * r9). Strokes are thin (the Figma line weight) and the parent wash drives opacity via `--text-faint`.
 */
export function PosterMark() {
  return (
    <svg
      className="library-poster__mark"
      viewBox="0 0 278 104"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      {/* edges first, so the nodes sit on top — hub → each satellite */}
      <g stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round">
        <line x1="78" y1="47" x2="188" y2="38" />
        <line x1="78" y1="47" x2="212" y2="67" />
      </g>
      {/* hub: a ringed node, upper-left */}
      <circle cx="78" cy="47" r="26" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="78" cy="47" r="4" fill="currentColor" />
      {/* satellites: a larger one upper-right, a smaller one lower-right */}
      <circle cx="188" cy="38" r="13" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="188" cy="38" r="2.4" fill="currentColor" />
      <circle cx="212" cy="67" r="9" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="212" cy="67" r="2" fill="currentColor" />
    </svg>
  );
}

/**
 * The library card's DELETE chip glyph (issue #201) — a monoline trash can, following the committed
 * `PosterMark` precedent: drawn in `currentColor` with a ~1.4–1.6px stroke (NEVER a Unicode/emoji
 * glyph), so the chip's `color` token drives it and the resting `--text-muted` → emphasis `--err` swap
 * works through the `--tr-color` catalog primitive. Purely decorative (`aria-hidden`) — the chip's
 * `<button aria-label>` carries the accessible name (`deleteLabel`). 24×24 viewBox so it centers cleanly
 * in the 24px (≥SC 2.5.8) hit box.
 */
export function TrashMark() {
  return (
    <svg
      className="library-poster__trash"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* lid line */}
      <line x1="4.5" y1="6.5" x2="19.5" y2="6.5" />
      {/* handle */}
      <path d="M9.5 6.5V5.2a1.2 1.2 0 0 1 1.2-1.2h2.6a1.2 1.2 0 0 1 1.2 1.2v1.3" />
      {/* can body */}
      <path d="M6.3 6.5l0.9 12.1a1.4 1.4 0 0 0 1.4 1.3h6.8a1.4 1.4 0 0 0 1.4-1.3l0.9-12.1" />
      {/* two inner strokes */}
      <line x1="10.2" y1="10" x2="10.2" y2="16.5" />
      <line x1="13.8" y1="10" x2="13.8" y2="16.5" />
    </svg>
  );
}

/**
 * The bulk multi-select checkbox glyph (issue #203) — a monoline box outline with a cross-fading
 * check/dash overlay, following the `TrashMark` precedent: `currentColor`, ~1.5px stroke, never a
 * Unicode/emoji glyph. Serves BOTH the per-card checkbox (AC3/AC6, two states: unchecked ↔ checked, i.e.
 * `'none'` ↔ `'all'`) and the action bar's master tri-state checkbox (AC11, all three states). The three
 * overlays are stacked in the SAME SVG grid cell and cross-faded by `data-state` on the wrapper (the
 * icon-swap recipe — `transitions-dev` §09 — extended from 2 states to 3), driven by the §0 `--dur-fast`/
 * `--ease` catalog tokens BY NAME (no new duration/easing literal, per AGENTS.md); the CSS lives in
 * `globals.css` under `.library-checkbox__icon`. Purely decorative (`aria-hidden`) — the enclosing
 * `role="checkbox"` button carries `aria-checked` + the accessible name.
 */
export function CheckboxGlyph({ state }: { state: 'none' | 'mixed' | 'all' }) {
  return (
    <span className="library-checkbox__glyph" data-state={state} aria-hidden="true">
      <svg
        className="library-checkbox__icon"
        data-icon="box"
        viewBox="0 0 16 16"
        xmlns="http://www.w3.org/2000/svg"
        focusable="false"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <rect x="1.25" y="1.25" width="13.5" height="13.5" rx="3" />
      </svg>
      <svg
        className="library-checkbox__icon"
        data-icon="check"
        viewBox="0 0 16 16"
        xmlns="http://www.w3.org/2000/svg"
        focusable="false"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3.8 8.4l2.7 2.7 5.7-5.9" />
      </svg>
      <svg
        className="library-checkbox__icon"
        data-icon="dash"
        viewBox="0 0 16 16"
        xmlns="http://www.w3.org/2000/svg"
        focusable="false"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      >
        <line x1="4" y1="8" x2="12" y2="8" />
      </svg>
    </span>
  );
}
