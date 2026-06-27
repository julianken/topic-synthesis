/**
 * The ✦ sparkle mark, inlined as an SVG vector — the badge glyph in the Figma frame `5:2` (node `5:7`).
 *
 * Why a vector, not the literal "✦" character (U+2726): that codepoint is NOT in Inter (`--sans`), so a
 * text node falls back to a per-platform system font — which draws the star at a DIFFERENT size and
 * baseline on macOS vs. the Linux/Cloud Run container, so the glyph never matched the Figma render and
 * drifted between dev and deploy. A path renders byte-identically everywhere, pinning the mark to the
 * Figma `5:6` geometry (a symmetric 4-pointed sparkle with concave sides, reaching ~50% of the badge).
 * Same rationale as the inlined `<GoogleG/>` — a mark we ship locally, never a font fallback or remote
 * asset.
 *
 * `fill="currentColor"` so the §0 token drives the color (the badge's `color: var(--accent)`); the
 * cyan is NOT hardcoded here, matching the no-duplicate-a-token rule. `aria-hidden` + `focusable=false`:
 * the badge is decorative chrome (the heading is the page's accessible name).
 */
export function SparkleMark({ size = 24 }: { size?: number }) {
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
        d="M12 2.8Q14.4 9.6 21.2 12Q14.4 14.4 12 21.2Q9.6 14.4 2.8 12Q9.6 9.6 12 2.8Z"
      />
    </svg>
  );
}
