import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { allTokens, cssVar } from './tokens';

/**
 * tokens.test.ts — the SYNC guard between the type-safe NAME MAP (`tokens.ts`)
 * and the materialized §0 manifest (`src/app/globals.css` `:root`, the single
 * source of truth — DESIGN.md §0).
 *
 * `tokens.ts` is a hand-maintained tuple of every §0 custom-property NAME so a
 * typo'd `cssVar('--no-such')` fails `tsc`. The names in the tuple and the names
 * in `globals.css :root` are TWO lists that can silently drift: a token added to
 * the CSS but not the map would be referenceable only by raw string (no compile
 * guard); a token in the map but dropped from the CSS would resolve to nothing
 * at runtime. This test parses the `globals.css :root` declarations and asserts
 * the two name sets are EQUAL — so any drift is a CI failure here, not a silent
 * gap. (`globals.css` is the source of truth; `tokens.ts` is its type mirror.)
 *
 * Modeled on the violin-tools `tokens.test.ts` sync guard, adapted to the
 * topic-synthesis §0 token surface and OKLCH manifest.
 */
function globalsRootTokenNames(): string[] {
  const cssSrc = readFileSync(fileURLToPath(new URL('../globals.css', import.meta.url)), 'utf8');
  // The :root block is the document's first { … } body after `:root`.
  const rootBody = /:root\s*\{([\s\S]*?)\}/.exec(cssSrc)?.[1];
  expect(rootBody).toBeDefined();
  // Every `--name:` custom-property DECLARATION (the LHS of a `--name: value;`).
  // Matching the declaration colon (not a `var(--other)` reference inside a value)
  // collects exactly the tokens the :root defines.
  const names: string[] = [];
  for (const m of (rootBody as string).matchAll(/(--[a-z0-9-]+)\s*:/gi)) {
    names.push(m[1] as string);
  }
  return names;
}

describe('tokens.ts ↔ globals.css :root name sync', () => {
  it('every name in the map is declared in globals.css :root (no dangling type)', () => {
    const declared = new Set(globalsRootTokenNames());
    const missing = allTokens.filter((name) => !declared.has(name));
    expect(missing).toEqual([]);
  });

  it('every token declared in globals.css :root is in the map (no untyped token)', () => {
    const mapped = new Set<string>(allTokens);
    const untyped = globalsRootTokenNames().filter((name) => !mapped.has(name));
    expect(untyped).toEqual([]);
  });

  it('the two name sets are exactly equal (sorted, deduped)', () => {
    const fromCss = [...new Set(globalsRootTokenNames())].sort();
    const fromMap = [...new Set<string>(allTokens)].sort();
    expect(fromMap).toEqual(fromCss);
  });

  it('the map has no duplicate names', () => {
    expect(new Set<string>(allTokens).size).toBe(allTokens.length);
  });
});

// cssVar — the runtime helper that emits a CSS `var()` reference for a DECLARED
// token name (the compile-time guard is the type system's job — `TokenName`).
// Two runtime branches: no fallback → `var(--x)`; a fallback → `var(--x, <fallback>)`.
describe('cssVar', () => {
  it('emits a bare var() reference when no fallback is given', () => {
    expect(cssVar('--text')).toBe('var(--text)');
  });

  it('appends the fallback as the var() second argument when one is given', () => {
    expect(cssVar('--accent', 'oklch(0.82 0.145 215)')).toBe('var(--accent, oklch(0.82 0.145 215))');
  });
});
