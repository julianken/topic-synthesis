/**
 * The ✦ sparkle mark, inlined as an SVG vector — the badge glyph in the Figma frame `5:2` (node `5:7`).
 *
 * Why a vector, not the literal "✦" character (U+2726): a text node falls back to a per-platform system
 * font for that codepoint — which draws the star at a DIFFERENT size and baseline on macOS vs. the
 * Linux/Cloud Run container, so the glyph drifts between dev and deploy. A path renders byte-identically
 * everywhere. Same rationale as the inlined `<GoogleG/>` — a mark we ship locally, never a font fallback
 * or remote asset.
 *
 * Geometry is matched to the Figma `5:6`/`5:7` render PIXEL-FOR-PIXEL (Inter Light "✦" at 25px in the
 * 54px badge): a SYMMETRIC 4-pointed sparkle (the ink bbox aspect is 1.00 in Figma) with SHORT, STUBBY
 * points and DEEPLY CONCAVE sides — a fat diamond body, not a thin/pointy star. The earlier path was too
 * big and too pointy (its tips reached ~76% of the element, its sides only mildly concave). This path's
 * tips sit at the viewBox edges and the quadratic control points are pulled close to centre (±2.5 of the
 * 12,12 centre), so the sides bow in tightly; rendered at the 23px default in the 54px badge the ink
 * spans ~32%..68% of the box (≈36% fill, optically centred), coinciding with the Figma glyph silhouette.
 *
 * `fill="currentColor"` so the §0 token drives the color (the badge's `color: var(--accent)`); the
 * cyan is NOT hardcoded here, matching the no-duplicate-a-token rule. `aria-hidden` + `focusable=false`:
 * the badge is decorative chrome (the heading is the page's accessible name).
 */
export function SparkleMark({ size = 23 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M12 1.5Q14.5 9.5 22.5 12Q14.5 14.5 12 22.5Q9.5 14.5 1.5 12Q9.5 9.5 12 1.5Z"
      />
    </svg>
  );
}
