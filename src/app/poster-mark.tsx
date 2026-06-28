/**
 * The decorative line-art mark in a library poster card's top wash (Figma frame `6:2`, node `6:27` etc.).
 *
 * Why a vector, not a per-lesson illustration: the FRAME-phase `LessonCard` (TS-16) carries no category,
 * no thumbnail, and no description — the Figma's per-category icons have no data source yet (DESIGN.md
 * §Components → Library: "the preview thumbnail … has no data source"). So rather than fabricate a
 * category icon (which would imply metadata the card does not hold), the wash carries a single neutral
 * `topic·synthesis` motif: a small node-graph (a hub linked to two satellites), the product's own
 * "synthesize a topic into a lesson" emblem. It is purely decorative chrome (`aria-hidden`), drawn in
 * `currentColor` so the §0 wash tint drives its color (no hardcoded hex).
 *
 * Geometry mirrors the Figma poster icon silhouette (`6:28`/`6:34`): a ringed hub upper-left wired to two
 * smaller satellite nodes lower-right, centred in the 104px-tall wash. Strokes are thin (the Figma line
 * weight) and semi-transparent via the parent wash opacity.
 */
export function PosterMark() {
  return (
    <svg
      className="library-poster__mark"
      viewBox="0 0 64 36"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      {/* edges first, so the nodes sit on top */}
      <g stroke="currentColor" strokeWidth="1" fill="none" strokeLinecap="round">
        <line x1="22" y1="15" x2="42" y2="11" />
        <line x1="22" y1="15" x2="44" y2="24" />
      </g>
      {/* hub: a ringed node */}
      <circle cx="22" cy="15" r="6" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="22" cy="15" r="2" fill="currentColor" />
      {/* satellites */}
      <circle cx="42" cy="11" r="2.6" fill="none" stroke="currentColor" strokeWidth="1" />
      <circle cx="44" cy="24" r="2.6" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}
