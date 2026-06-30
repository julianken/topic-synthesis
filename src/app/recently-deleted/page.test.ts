import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// ── The Recently-deleted shelf's load-bearing invariants (#204) ──────────────────────────────────────
// The `/recently-deleted` route is a SERVER component and the restore island is a client component, neither
// of which mounts under vitest's `environment: 'node'` (no DOM — the constraint page.test.ts /
// library-card.test.ts / lesson-message.test.ts note). So the route's auth-gate / owner-scope / empty-state
// wiring and the island's restore-POST / a11y contract are SOURCE byte-pins here; the pure `deletedAgo`
// helper + the store's owner-scoped read are exercised behaviorally in library-card.test.ts / repo.test.ts.

const PAGE = readFileSync(fileURLToPath(new URL('./page.tsx', import.meta.url)), 'utf8');
const ISLAND = readFileSync(fileURLToPath(new URL('./restore-controls.tsx', import.meta.url)), 'utf8');
const CSS = readFileSync(fileURLToPath(new URL('../globals.css', import.meta.url)), 'utf8');

describe('recently-deleted route — server component, auth gate, owner-scoped read (AC 1–4)', () => {
  it('is a force-dynamic server component (no "use client" at the top of the route file)', () => {
    expect(PAGE).toContain("export const dynamic = 'force-dynamic'");
    // The DATA-fetching route stays a server component — only the restore island is client.
    expect(PAGE.trimStart().startsWith("'use client'")).toBe(false);
  });

  it('imports getSessionIdentity from ../auth/require-session and listDeletedLessons from ../../store/repo', () => {
    expect(PAGE).toContain("from '../auth/require-session'");
    expect(PAGE).toContain('getSessionIdentity');
    expect(PAGE).toContain("from '../../store/repo'");
    expect(PAGE).toContain('listDeletedLessons');
  });

  it('default-denies: a null session redirects to /sign-in before any read', () => {
    expect(PAGE).toContain('if (!identity) redirect');
    expect(PAGE).toContain("'/sign-in'");
    // the gate precedes the read in source order (read after redirect)
    expect(PAGE.indexOf('redirect')).toBeLessThan(PAGE.indexOf('listDeletedLessons(identity.sub)'));
  });

  it('reads only the owner-scoped listDeletedLessons(identity.sub) — no foreign owner / id from elsewhere', () => {
    expect(PAGE).toContain('listDeletedLessons(identity.sub)');
  });
});

describe('recently-deleted route — heading, card order, no morph, no /lesson link (AC 6–10)', () => {
  it('renders the exact primary heading "Recently deleted"', () => {
    expect(PAGE).toContain('<h1 className="shelf__title">Recently deleted</h1>');
  });

  it('renders cards in the order listDeletedLessons returns — a plain map, no client re-sort', () => {
    expect(PAGE).toContain('deleted.map((lesson, i)');
    expect(PAGE).not.toMatch(/deleted[^;]*\.sort\(/);
  });

  it('sets NO view-transition-name on the shelf (never contends with the card→reader FLIP morph)', () => {
    expect(PAGE).not.toContain('viewTransitionName');
    expect(PAGE).not.toContain('view-transition-name');
    expect(ISLAND).not.toContain('viewTransitionName');
    expect(ISLAND).not.toContain('view-transition-name');
  });

  it('renders NO anchor to /lesson/[id] on the shelf (deleted lessons 404 at the read layer)', () => {
    expect(PAGE).not.toContain('/lesson/');
    expect(ISLAND).not.toContain('/lesson/');
  });

  it('builds the "Deleted …" stamp via the pure deletedAgo helper', () => {
    expect(PAGE).toContain('deletedAgo(lesson.deletedAt)');
  });
});

describe('recently-deleted route — the empty state (AC 19)', () => {
  it('branches on zero deleted lessons to a labeled empty state with the exact copy', () => {
    expect(PAGE).toContain('deleted.length === 0');
    expect(PAGE).toContain('<h2 className="shelf-empty__title">Nothing here</h2>');
    expect(PAGE).toContain('Deleted lessons stay here so you can get them back.');
  });
});

describe('recently-deleted island — the Restore control + the #199 mutation (AC 5, 11–18)', () => {
  it('adds NO new API route — it consumes the #199 POST /api/lessons/restore with { ids:[id] }', () => {
    expect(ISLAND).toContain("fetch('/api/lessons/restore'");
    expect(ISLAND).toContain("method: 'POST'");
    expect(ISLAND).toContain('JSON.stringify({ ids: [id] })');
  });

  it('the per-card control has visible text "Restore" + aria-label="Restore {title}"', () => {
    expect(ISLAND).toContain('aria-label={`Restore ${title}`}');
    expect(ISLAND).toContain("'Restore'"); // the visible label (idle)
  });

  it('renders an inline arrow glyph in currentColor (the button color is --accent in CSS)', () => {
    expect(ISLAND).toContain('function UndoMark');
    expect(ISLAND).toContain('<UndoMark />');
    expect(ISLAND).toMatch(/shelf-restore__icon[\s\S]*stroke="currentColor"/);
    expect(CSS).toMatch(/\.shelf-restore\s*\{[\s\S]*color: var\(--accent\)/);
  });

  it('on success removes the card and announces "Lesson restored" into a pre-mounted polite region', () => {
    expect(ISLAND).toContain("announce('Lesson restored')");
    expect(ISLAND).toContain("setPhase('restoring')"); // the restore-exit collapse → unmount
    expect(ISLAND).toMatch(/role="status"[\s\S]*aria-live="polite"[\s\S]*aria-atomic="true"/);
  });

  it('on failure surfaces "Couldn\'t restore — try again" via a pre-mounted alert region and LEAVES the card', () => {
    expect(ISLAND).toContain('announceError("Couldn\'t restore — try again")');
    expect(ISLAND).toContain('role="alert"');
    // the failure path does NOT advance to the restoring/gone phase (the card stays)
    expect(ISLAND).toMatch(/catch[\s\S]*announceError[\s\S]*setError\(true\)/);
  });
});

describe('recently-deleted CSS — reuses the poster visual, additive §0-token motion (AC 23, 25)', () => {
  it('the shelf card enters via the EXISTING rail-reveal keyframe (no bespoke entrance)', () => {
    expect(CSS).toMatch(/\.shelf-poster__card\s*\{[\s\S]*animation: rail-reveal var\(--dur-base\) var\(--ease\)/);
  });

  it('the additive shelf motion composes only §0 --dur-*/--ease + catalog --tr-* primitives', () => {
    // restore-exit collapse + failure shake at the §0 base tier; the Restore control on the --tr-hover catalog primitive.
    expect(CSS).toContain('@keyframes shelf-restore-collapse');
    expect(CSS).toContain('@keyframes shelf-shake');
    expect(CSS).toMatch(/\.shelf-restore\s*\{[\s\S]*transition: var\(--tr-hover\)/);
  });

  it('introduces NO new :root §0 token (the manifest is byte-untouched by this surface)', () => {
    // The shelf block is appended AFTER the single :root manifest; assert the shelf class names never
    // appear inside a :root declaration (a coarse guard that no token was added for this surface).
    const rootBlock = CSS.slice(CSS.indexOf(':root'), CSS.indexOf('}', CSS.indexOf(':root')));
    expect(rootBlock).not.toContain('shelf');
  });
});
