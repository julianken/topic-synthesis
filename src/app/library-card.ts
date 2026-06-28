/**
 * Pure presentation helpers for the library home's poster cards (TS-17) — the FLIP-origin card grid.
 *
 * These live in a `.ts` module (NOT the `page.tsx` server component) so they unit-test under vitest's
 * `environment: 'node'` (the `.tsx` server component can't mount there — same constraint
 * `lesson-message.ts`/`page.test.ts` note). The card's DATA is TS-16's `LessonCard`
 * (`{ id, slug, title, status, createdAt }`); this module turns that thin row into the status label/icon,
 * the relative-time string, and the per-card `view-transition-name` endpoint — no I/O.
 */
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

// No `kindLabel`: the Figma `6:2` card eyebrow holds a user-meaningful SUBJECT CATEGORY, not a
// render-backend identifier. An earlier build mapped that slot to the artifact's internal
// `interactionKind` enum (`svg`/`canvas`/`html`), which is dev-speak on a user surface — dropped per the
// copy-appropriateness gate. The eyebrow stays unrendered until a real category data source exists.
