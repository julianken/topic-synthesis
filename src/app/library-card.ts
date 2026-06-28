/**
 * Pure presentation helpers for the library home's poster cards (TS-17) — the FLIP-origin card grid.
 *
 * These live in a `.ts` module (NOT the `page.tsx` server component) so they unit-test under vitest's
 * `environment: 'node'` (the `.tsx` server component can't mount there — same constraint
 * `lesson-message.ts`/`page.test.ts` note). The card's DATA is TS-16's `LessonCard`
 * (`{ id, slug, title, status, createdAt }`); this module turns that thin row into the status label/icon,
 * the relative-time string, and the per-card `view-transition-name` endpoint — no I/O.
 */
import type { Level } from '../domain/settings';
import type { PageStatus } from '../domain/sitemap';

/** The status badge label + glyph (status by label + icon, never color alone — DESIGN.md §Color & contrast).
 *  Mirrors the reader route's `STATUS_LABEL`/`STATUS_ICON` and the Figma Library node `6:2` card footer. */
export const STATUS_LABEL: Record<PageStatus, string> = { built: 'Built', soon: 'Soon', text: 'Text' };
export const STATUS_ICON: Record<PageStatus, string> = { built: '✓', soon: '◷', text: '≡' };

/** The badge modifier class (`.badge--built` / `--soon` / `--text`) for a card's status — reuses the
 *  reader route's existing badge tokens so the library and reader read identically. */
export function badgeClass(status: PageStatus): string {
  return `badge badge--${status}`;
}

/**
 * The per-card `view-transition-name` ENDPOINT (TS-17 establishes the FLIP ORIGIN geometry; TS-21 wires
 * the actual cross-document container-transform — box-only per the TS-5b verdict). The name is derived
 * from the lesson id so the library card (origin) and the reader's `#readerPanel.morph-box` (destination,
 * TS-20) can later be matched by id WITHOUT a global `@view-transition { navigation }` activating any
 * transition here (TS-17 is box-only, NO animation). `view-transition-name` must be a valid CSS
 * <custom-ident>, so the id is sanitized to `[A-Za-z0-9_-]` and prefixed (an ident can't start with a digit).
 */
export function morphName(id: string): string {
  return `lesson-card-${id.replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

/**
 * A coarse, locale-free relative-time string for a card's `createdAt` (the Figma `6:2` footer shows
 * "3h ago" / "yesterday" / "4 days ago"). Deterministic + pure (caller passes `now`), so it unit-tests
 * without wall-clock flake. Coarse by design — the card needs recency, not precision.
 */
export function relativeTime(createdAtIso: string, now: Date = new Date()): string {
  const then = new Date(createdAtIso).getTime();
  if (!Number.isFinite(then)) return '';
  const seconds = Math.max(0, Math.round((now.getTime() - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

/** The learner-facing level word for the card meta line. The Figma `6:2` footer reads "beginner · d2 · …",
 *  so the `intro` level surfaces as "beginner" (a user-appropriate word, not the internal `intro` enum);
 *  `intermediate`/`advanced` already read naturally. Never the raw enum on a user surface. */
export const LEVEL_LABEL: Record<Level, string> = {
  intro: 'beginner',
  intermediate: 'intermediate',
  advanced: 'advanced',
};

/**
 * The Figma `6:2` card footer-meta line ("beginner · d2 · 3h ago"): the learner-facing level word, the
 * depth shorthand (`d{depth}`), and the coarse relative-time, middot-joined. All three parts are REAL
 * card data (level + depth from the saved Settings, time from `createdAt`) — never fabricated. Each part
 * is dropped if empty so the line never prints `undefined` or trails a dangling separator: a level
 * outside the enum (a legacy/out-of-shape row — the typed `Level` can't hit this in normal flow) falls
 * back to its own value rather than the map's `undefined`, and an unparseable timestamp drops the time.
 */
export function metaLine(level: Level, depth: number, createdAtIso: string, now: Date = new Date()): string {
  const when = relativeTime(createdAtIso, now);
  const parts = [LEVEL_LABEL[level] ?? level, Number.isFinite(depth) ? `d${depth}` : '', when];
  return parts.filter(Boolean).join(' · ');
}

/**
 * The Figma `6:2` dense-card EYEBROW (node `6:41`) text — the stored subject category, presented as the
 * uppercase shelf label the frame shows (BIOLOGY / MATHEMATICS / …). The classifier already validated +
 * uppercased it at the run tail; this is a defense-in-depth re-check on the READ side so a hand-edited /
 * legacy DB value can never leak a code identifier or fabricated string onto a user surface. Returns
 * null when the value is absent OR fails the copy-appropriateness check — the card then OMITS the
 * eyebrow row entirely (show nothing > guess/leak), keeping the rhythm tight. Pure.
 *
 * The rule mirrors `classify-category.ts#normalizeCategory` (kept in sync by hand — this module is a
 * `src/app` presentation helper and the import fence keeps `src/app` from importing core pipeline code):
 * a short, purely-alphabetic word/phrase that is not an internal/render-backend token.
 */
const EYEBROW_MAX_LEN = 24;
const FORBIDDEN_EYEBROW: ReadonlySet<string> = new Set([
  'SVG', 'CANVAS', 'HTML', 'ADR', 'TS', 'PR', 'BLOB', 'V11', 'SPEC', 'CRITIC',
  'LESSON', 'NULL', 'NONE', 'UNKNOWN', 'GENERAL', 'MISC', 'OTHER',
]);

export function categoryEyebrow(category: string | null | undefined): string | null {
  if (typeof category !== 'string') return null;
  const trimmed = category.trim();
  if (trimmed.length === 0 || trimmed.length > EYEBROW_MAX_LEN) return null;
  if (!/^[A-Za-z]+(?: [A-Za-z]+)*$/.test(trimmed)) return null;
  const upper = trimmed.toUpperCase();
  for (const word of upper.split(' ')) {
    if (FORBIDDEN_EYEBROW.has(word)) return null;
  }
  return upper;
}

/**
 * The Figma `6:2` dense-card DESCRIPTION (node `6:47`) text — the lesson's learner-facing one-liner (the
 * stored `summary` = the brief's learningGoal). The frame caps the description at ~two lines (248px,
 * Inter 12.5px); the CSS `-webkit-line-clamp: 2` does the visual cap, and this is a coarse HARD ceiling
 * so a runaway value can't blow the fixed card height even before the clamp paints. Returns null for an
 * absent/blank value so the card omits the description row. Pure.
 */
const DESCRIPTION_MAX_LEN = 180;

export function cardDescription(summary: string | null | undefined): string | null {
  if (typeof summary !== 'string') return null;
  const trimmed = summary.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length <= DESCRIPTION_MAX_LEN) return trimmed;
  // Trim to the last word boundary within the ceiling, then ellipsize — the CSS clamp still handles the
  // visual two-line cut; this only prevents an absurdly long string from ever reaching the DOM.
  const cut = trimmed.slice(0, DESCRIPTION_MAX_LEN);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
