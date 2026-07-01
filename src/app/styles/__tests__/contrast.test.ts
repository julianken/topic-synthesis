import { describe, expect, it } from 'vitest';

/**
 * Color & contrast verification — an executable guard on DESIGN.md "## Color &
 * contrast".
 *
 * DESIGN.md states the design target is WCAG 2.2 AA: body `--text` on `--bg-app`
 * clears AA for normal text, muted text is used only at ≥ `--fs-body`, and status
 * is conveyed by **label + icon, never color alone**. That last rule means the
 * status colors do NOT have to clear AA *as the sole status carrier* — but a
 * status LABEL is still text the reader must read, so each status token is
 * verified as readable text on the surfaces it actually paints on (the badge
 * border + label sit on `--bg-surface`; status text in chrome sits on `--bg-app`).
 *
 * This test recomputes the WCAG 2.x relative-luminance ratio for each documented
 * pair DIRECTLY from the raw §0 OKLCH values (the literals transcribed from
 * `DESIGN.md ## 0` / `globals.css :root`), so a future §0 hex/OKLCH edit that
 * breaks a documented pair fails this gate loudly. The OKLCH literals are
 * duplicated from §0 ON PURPOSE: the point is to recompute the AA pairs from the
 * raw values independently — it cannot read the (untestable-from-JS) resolved CSS
 * custom properties.
 *
 * Modeled on the violin-tools `contrast.test.ts`, adapted from that file's sRGB
 * hex primitives to this product's OKLCH ramps (the conversion adds the
 * OKLCH→OKLab→linear-sRGB step before WCAG relative luminance).
 *
 * One documented sub-threshold pairing is asserted as an ALLOWED exemption, not a
 * failure: `--text-faint` on `--bg-surface` (placeholder / meta / faint-stamp
 * only — never operable body copy; DESIGN.md "## Color & contrast" muted-text rule
 * and "## Components" — `.library-poster__when` / `.library__hint` faint stamps).
 */

// ── §0 OKLCH primitives referenced below (transcribed from DESIGN.md ## 0 / globals.css :root) ──
// Each is [L, C, hueDeg].
const INK_950: Oklch = [0.165, 0.018, 250]; // --bg-app (canvas)
const INK_900: Oklch = [0.205, 0.02, 250]; // --bg-surface
const BG_RAISED: Oklch = [0.215, 0.018, 250]; // --bg-raised (its own near-ink value, not a primitive alias)
const FOG_100: Oklch = [0.95, 0.008, 250]; // --text
const FOG_450: Oklch = [0.74, 0.015, 250]; // --text-muted
const FOG_550: Oklch = [0.65, 0.016, 250]; // --text-faint
const ACCENT: Oklch = [0.82, 0.145, 215]; // --accent / --interactive
const ACCENT_DIM: Oklch = [0.7, 0.11, 215]; // --accent-dim / --interactive-hover
const OK: Oklch = [0.78, 0.15, 152]; // --ok / --status-built
const WARN: Oklch = [0.82, 0.13, 80]; // --warn / --status-soon
const ERR: Oklch = [0.66, 0.17, 25]; // --err / --status-error
// --surface-panel-strong's OWN OKLCH channel is IDENTICAL to --bg-surface's (INK_900 above) — only the
// alpha differs (globals.css: `oklch(0.205 0.020 250 / 0.55)`). Named separately so a future edit to
// either token's channel is caught independently, even though the literals happen to match today.
const SURFACE_PANEL_STRONG: Oklch = [0.205, 0.02, 250]; // --surface-panel-strong (translucent)
const SURFACE_PANEL_STRONG_ALPHA = 0.55;

type Oklch = readonly [L: number, C: number, hDeg: number];
interface LinearRgb {
  r: number;
  g: number;
  b: number;
}

/** OKLCH → OKLab (polar chroma/hue → rectangular a/b). */
function oklchToOklab([L, C, hDeg]: Oklch): { L: number; a: number; b: number } {
  const h = (hDeg * Math.PI) / 180;
  return { L, a: C * Math.cos(h), b: C * Math.sin(h) };
}

/** OKLab → linear-light sRGB (Björn Ottosson's published M2⁻¹ / LMS matrices). */
function oklabToLinearSrgb({ L, a, b }: { L: number; a: number; b: number }): LinearRgb {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** OKLCH → clamped linear-light sRGB. Clamp to the sRGB gamut: a value outside [0,1] is out-of-gamut and
 *  a display shows the clamped channel, so luminance / compositing is computed from the clamped light.
 *  Shared by the direct-luminance path below and the alpha-compositing path further down. */
function oklchToLinearRgb(color: Oklch): LinearRgb {
  const lin = oklabToLinearSrgb(oklchToOklab(color));
  return { r: clamp01(lin.r), g: clamp01(lin.g), b: clamp01(lin.b) };
}

/** WCAG 2.x relative luminance from linear-light sRGB. */
function relativeLuminanceFromLinearRgb({ r, g, b }: LinearRgb): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x relative luminance, computed from an OKLCH color via linear sRGB. */
function relativeLuminance(color: Oklch): number {
  return relativeLuminanceFromLinearRgb(oklchToLinearRgb(color));
}

/** WCAG contrast ratio between two relative luminances. */
function contrastRatioFromLuminance(la: number, lb: number): number {
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG contrast ratio between two OKLCH colors. */
function contrastRatio(a: Oklch, b: Oklch): number {
  return contrastRatioFromLuminance(relativeLuminance(a), relativeLuminance(b));
}

// ── Alpha compositing (for the one translucent §0 surface a text pair sits on: --surface-panel-strong) ──
// A browser composites a translucent `background-color` layer over its opaque backdrop by blending the
// GAMMA-ENCODED (non-linear) pixel values directly — the standard "over" operator every browser actually
// paints DOM layers with (no `color-interpolation: linearRGB`, which only applies inside SVG filters).
// Matching that requires gamma-encoding each channel before the blend and decoding back to linear light
// before computing WCAG luminance, hence the sRGB OETF/EOTF pair below.
function linearToGamma(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}
function gammaToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Composite a translucent OKLCH color (`fg` at `alpha`) over an opaque OKLCH backdrop, returning the
 *  resulting EFFECTIVE opaque linear-light sRGB — i.e. what a browser actually paints (gamma-space "over",
 *  per the comment above). */
function compositeOverOpaque(fg: Oklch, alpha: number, bg: Oklch): LinearRgb {
  const fgLin = oklchToLinearRgb(fg);
  const bgLin = oklchToLinearRgb(bg);
  const blendChannel = (fgC: number, bgC: number): number =>
    gammaToLinear(linearToGamma(fgC) * alpha + linearToGamma(bgC) * (1 - alpha));
  return {
    r: blendChannel(fgLin.r, bgLin.r),
    g: blendChannel(fgLin.g, bgLin.g),
    b: blendChannel(fgLin.b, bgLin.b),
  };
}

/** Round to the hundredth — ratios are pinned to two decimals. */
function toHundredth(n: number): number {
  return Math.round(n * 100) / 100;
}

interface Pair {
  /** DESIGN.md "## Color & contrast" pair label */
  name: string;
  /** computed ratio to the hundredth */
  ratio: number;
  /** the value pinned at authoring time (recomputed each run; a drift trips this) */
  expected: number;
  /** sub-AA pairs that are documented exemptions (faint meta, never operable copy) */
  exemption?: 'faint-meta-only';
}

// The snackbar's ACTUAL painted background: `--surface-panel-strong` (translucent) composited over
// `--bg-app` (INK_950) — the snackbar is `position: fixed` over the page canvas, per `globals.css`
// `.library-snackbar`. This is the effective opaque backdrop the snackbar's `--accent` Undo text sits on.
const SNACKBAR_BG = compositeOverOpaque(SURFACE_PANEL_STRONG, SURFACE_PANEL_STRONG_ALPHA, INK_950);

const pairs: Pair[] = [
  // Body text — the load-bearing AA pair DESIGN.md names explicitly.
  { name: '{bg-app} / {text}', ratio: toHundredth(contrastRatio(FOG_100, INK_950)), expected: 16.65 },
  {
    name: '{bg-surface} / {text}',
    ratio: toHundredth(contrastRatio(FOG_100, INK_900)),
    expected: 15.48,
  },
  {
    name: '{bg-raised} / {text}',
    ratio: toHundredth(contrastRatio(FOG_100, BG_RAISED)),
    expected: 15.14,
  },
  // Muted text — used only at ≥ --fs-body (DESIGN.md), so it must still clear AA there.
  {
    name: '{bg-app} / {text-muted}',
    ratio: toHundredth(contrastRatio(FOG_450, INK_950)),
    expected: 8.36,
  },
  {
    name: '{bg-surface} / {text-muted}',
    ratio: toHundredth(contrastRatio(FOG_450, INK_900)),
    expected: 7.77,
  },
  // Faint text — placeholder / faint relative-time stamp / intake note ONLY (exempt; see below).
  {
    name: '{bg-surface} / {text-faint}',
    ratio: toHundredth(contrastRatio(FOG_550, INK_900)),
    expected: 5.54,
  },
  // Interactive accent — the sign-out / button / link color must read as text on the canvas.
  { name: '{bg-app} / {interactive}', ratio: toHundredth(contrastRatio(ACCENT, INK_950)), expected: 11.51 },
  // Status LABEL colors (label + icon — never color alone): each must be readable text on the
  // surfaces it paints on. Badge label/border sit on {bg-surface}; status text in chrome on {bg-app}.
  { name: '{bg-surface} / {status-built}', ratio: toHundredth(contrastRatio(OK, INK_900)), expected: 9.48 },
  { name: '{bg-app} / {status-built}', ratio: toHundredth(contrastRatio(OK, INK_950)), expected: 10.2 },
  { name: '{bg-surface} / {status-soon}', ratio: toHundredth(contrastRatio(WARN, INK_900)), expected: 10.13 },
  { name: '{bg-app} / {status-soon}', ratio: toHundredth(contrastRatio(WARN, INK_950)), expected: 10.9 },
  { name: '{bg-surface} / {status-error}', ratio: toHundredth(contrastRatio(ERR, INK_900)), expected: 5.32 },
  { name: '{bg-app} / {status-error}', ratio: toHundredth(contrastRatio(ERR, INK_950)), expected: 5.72 },
  // Destructive-as-foreground (§Color & contrast, #201) — the two pairs the delete/Undo affordances
  // ACTUALLY paint on, not their {bg-surface}/{bg-app} proxies above.
  {
    // The delete chip's --err hover/focus emphasis sits on the HOVERED card's background, which swaps
    // to --bg-raised on :hover (globals.css `.library-poster__card:hover`) — not the card's resting
    // --bg-surface.
    name: '{bg-raised} / {err-hover} (delete chip hover/focus)',
    ratio: toHundredth(contrastRatio(ERR, BG_RAISED)),
    expected: 5.2,
  },
  {
    // The snackbar's Undo button sits on the snackbar's OWN translucent background composited over the
    // page canvas (SNACKBAR_BG above) — not the opaque {bg-surface} proxy.
    name: '{surface-panel-strong-over-bg-app} / {accent-undo} (snackbar Undo)',
    ratio: toHundredth(contrastRatioFromLuminance(relativeLuminance(ACCENT), relativeLuminanceFromLinearRgb(SNACKBAR_BG))),
    expected: 11.09,
  },
  // Recovery affordance — Restore-as-foreground (§Color & contrast, #204). The shelf Restore control
  // (label + `<UndoMark/>` icon, `.shelf-restore` in globals.css) paints `--accent` directly on the
  // card surfaces it actually sits on — not a `{bg-app}`/`{interactive}` proxy — so these three pairs
  // guard the ratios DESIGN.md "Recovery affordance" publishes.
  {
    // Restore label + icon at rest, AND the `:focus-visible` ring (`--interactive` = `--accent`) — both
    // paint on the shelf card's resting `--bg-surface`.
    name: '{bg-surface} / {accent} (shelf Restore label/icon + focus ring)',
    ratio: toHundredth(contrastRatio(ACCENT, INK_900)),
    expected: 10.7,
  },
  {
    // Restore label + icon on :hover, when the control's own background swaps to `--bg-raised`
    // (globals.css `.shelf-restore:hover`).
    name: '{bg-raised} / {accent} (shelf Restore hover)',
    ratio: toHundredth(contrastRatio(ACCENT, BG_RAISED)),
    expected: 10.46,
  },
  {
    // The hover border only (`.shelf-restore:hover { border-color: var(--accent-dim) }`) — non-text,
    // so its floor is 3:1, not the 4.5:1 normal-text floor; it clears both.
    name: '{bg-surface} / {accent-dim} (shelf Restore hover border, non-text)',
    ratio: toHundredth(contrastRatio(ACCENT_DIM, INK_900)),
    expected: 6.95,
  },
];

// Tag the one documented exemption.
const faintRow = pairs.find((p) => p.name === '{bg-surface} / {text-faint}');
if (faintRow) faintRow.exemption = 'faint-meta-only';

const WCAG_NORMAL_TEXT_FLOOR = 4.5;

describe('DESIGN.md "## Color & contrast" pairs (computed from §0 OKLCH)', () => {
  it.each(pairs)('$name recomputes to the pinned ratio ($expected:1)', ({ ratio, expected }) => {
    expect(ratio).toBeCloseTo(expected, 2);
  });

  it.each(pairs.filter((p) => p.exemption === undefined))(
    '$name clears the WCAG AA normal-text floor (4.5:1)',
    ({ ratio }) => {
      expect(ratio).toBeGreaterThanOrEqual(WCAG_NORMAL_TEXT_FLOOR);
    },
  );

  it('body {text} on {bg-app} clears WCAG AAA (the load-bearing DESIGN.md pair)', () => {
    const body = pairs.find((p) => p.name === '{bg-app} / {text}');
    // DESIGN.md names this pair as the body-text AA target; it clears AAA (7:1) with headroom.
    expect(body?.ratio).toBeGreaterThanOrEqual(7);
  });

  it('every status label color clears AA on both {bg-app} and {bg-surface}', () => {
    // Status is label + icon, never color alone — but the LABEL is still readable text.
    const statusRows = pairs.filter((p) => p.name.includes('status-'));
    expect(statusRows.length).toBe(6); // built/soon/error × {bg-app}/{bg-surface}
    for (const row of statusRows) {
      expect(row.ratio).toBeGreaterThanOrEqual(WCAG_NORMAL_TEXT_FLOOR);
    }
  });

  it('treats {text-faint} on {bg-surface} as the documented faint-meta exemption', () => {
    const faint = pairs.find((p) => p.name === '{bg-surface} / {text-faint}');
    expect(faint?.exemption).toBe('faint-meta-only');
    // It actually clears AA comfortably today, but is tagged exempt because its ROLE is
    // faint meta (.library-poster__when relative-time / .library__hint), never operable body copy —
    // so a future darkening below the floor would be sanctioned, not a failure.
    expect(faint?.ratio).toBeGreaterThan(0);
  });

  it('asserts every documented pair (none silently dropped)', () => {
    expect(pairs).toHaveLength(18);
  });

  it('the shelf Restore hover border (non-text) clears the WCAG AA non-text floor (3:1)', () => {
    const border = pairs.find((p) => p.name === '{bg-surface} / {accent-dim} (shelf Restore hover border, non-text)');
    const WCAG_NON_TEXT_FLOOR = 3;
    expect(border?.ratio).toBeGreaterThanOrEqual(WCAG_NON_TEXT_FLOOR);
  });
});
