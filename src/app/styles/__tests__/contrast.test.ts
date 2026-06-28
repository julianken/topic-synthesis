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
const OK: Oklch = [0.78, 0.15, 152]; // --ok / --status-built
const WARN: Oklch = [0.82, 0.13, 80]; // --warn / --status-soon
const ERR: Oklch = [0.66, 0.17, 25]; // --err / --status-error

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

/** WCAG 2.x relative luminance, computed from an OKLCH color via linear sRGB. */
function relativeLuminance(color: Oklch): number {
  const lin = oklabToLinearSrgb(oklchToOklab(color));
  // Clamp to the sRGB gamut: a value outside [0,1] is out-of-gamut and a display
  // shows the clamped channel, so luminance is computed from the clamped light.
  const r = clamp01(lin.r);
  const g = clamp01(lin.g);
  const b = clamp01(lin.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two OKLCH colors. */
function contrastRatio(a: Oklch, b: Oklch): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
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
    expect(pairs).toHaveLength(13);
  });
});
