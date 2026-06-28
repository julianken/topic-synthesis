import { describe, expect, it } from 'vitest';
import {
  badgeClass,
  LEVEL_LABEL,
  metaLine,
  morphName,
  relativeTime,
  STATUS_ICON,
  STATUS_LABEL,
} from './library-card';

describe('library-card — status presentation (TS-17)', () => {
  it('labels every PageStatus with a word + a glyph (label + icon, never color alone)', () => {
    expect(STATUS_LABEL).toEqual({ built: 'Built', soon: 'Soon', text: 'Text' });
    // every status carries a non-empty glyph — the icon half of "label + icon"
    for (const icon of Object.values(STATUS_ICON)) expect(icon.length).toBeGreaterThan(0);
  });

  it('maps each status to its existing badge modifier class (reuses the reader tokens)', () => {
    expect(badgeClass('built')).toBe('badge badge--built');
    expect(badgeClass('soon')).toBe('badge badge--soon');
    expect(badgeClass('text')).toBe('badge badge--text');
  });
});

describe('library-card — morphName, the FLIP-origin view-transition-name endpoint (TS-17 → TS-21)', () => {
  it('derives a stable, id-scoped name so the card (origin) pairs with the reader box (destination)', () => {
    expect(morphName('abc123')).toBe('lesson-card-abc123');
  });

  it('sanitizes ids to a valid CSS <custom-ident> (no chars outside [A-Za-z0-9_-])', () => {
    // a uuid-with-colon or a slashy id must not produce an invalid ident
    expect(morphName('a:b/c.d')).toBe('lesson-card-a-b-c-d');
    // the constant prefix means the ident never starts with a digit
    expect(morphName('9z')).toMatch(/^lesson-card-/);
    expect(morphName('any')).not.toMatch(/[^A-Za-z0-9_-]/);
  });

  it('is distinct per lesson id (each card box is its own morph endpoint)', () => {
    expect(morphName('one')).not.toBe(morphName('two'));
  });
});

describe('library-card — relativeTime, the coarse recency string (deterministic, pure)', () => {
  const now = new Date('2026-06-26T12:00:00.000Z');
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const SEC = 1000;
  const MIN = 60 * SEC;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  it('buckets into just-now / minutes / hours / yesterday / days / weeks', () => {
    expect(relativeTime(ago(10 * SEC), now)).toBe('just now');
    expect(relativeTime(ago(5 * MIN), now)).toBe('5m ago');
    expect(relativeTime(ago(3 * HOUR), now)).toBe('3h ago');
    expect(relativeTime(ago(1 * DAY), now)).toBe('yesterday');
    expect(relativeTime(ago(4 * DAY), now)).toBe('4 days ago');
    expect(relativeTime(ago(14 * DAY), now)).toBe('2w ago');
  });

  it('never returns a negative/future bucket (clamps to just-now) and is empty on a bad date', () => {
    expect(relativeTime(ago(-5 * MIN), now)).toBe('just now'); // a future createdAt clamps
    expect(relativeTime('not-a-date', now)).toBe('');
  });
});

describe('library-card — the Figma 6:2 card meta line (level · depth · time)', () => {
  const now = new Date('2026-06-26T12:00:00.000Z');
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const HOUR = 60 * 60 * 1000;

  it('surfaces the learner-facing level word, never the raw enum (intro → beginner)', () => {
    // The Figma footer reads "beginner …"; the internal `intro` enum must not leak onto a user surface.
    expect(LEVEL_LABEL).toEqual({ intro: 'beginner', intermediate: 'intermediate', advanced: 'advanced' });
  });

  it('builds the middot-joined "beginner · d2 · 3h ago" line from real data', () => {
    expect(metaLine('intro', 2, ago(3 * HOUR), now)).toBe('beginner · d2 · 3h ago');
    expect(metaLine('intermediate', 3, ago(3 * HOUR), now)).toBe('intermediate · d3 · 3h ago');
    expect(metaLine('advanced', 4, ago(3 * HOUR), now)).toBe('advanced · d4 · 3h ago');
  });

  it('drops a blank relative-time so the line never trails a dangling separator', () => {
    // an unparseable createdAt → relativeTime '' → the line ends at the depth, no trailing " · "
    expect(metaLine('intro', 1, 'not-a-date', now)).toBe('beginner · d1');
  });
});
