import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// ── TS-13 trust-boundary regression pin (AC8): the iframe sandbox is unchanged ──────────────────────
// The sandbox attribute is the PRIMARY trust boundary for the generated lesson (more load-bearing than
// the strict CSP `serve.test.ts` already byte-pins): `allow-scripts` WITHOUT `allow-same-origin` gives
// the framed lesson an opaque origin, so it runs its own canvas/SVG scripts but can't reach this app's
// origin/cookies/storage. `page.tsx` renders a `.tsx` server component that can't mount in vitest's
// `environment: 'node'` (no DOM — the same constraint `lesson-message.test.ts` notes), so this pins the
// boundary on the SOURCE the way `run-job.test.ts` pins the Job's no-telemetry contract: a future PR
// that adds `allow-same-origin` (collapsing the sandbox isolation) trips this test. It mirrors the CSP
// byte-pin's `.not.toContain('allow-same-origin')` so BOTH halves of AC8 — CSP and sandbox — are pinned.
describe('TS-13 AC8 — the lesson iframe sandbox stays opaque-origin (no allow-same-origin)', () => {
  const SOURCE = readFileSync(fileURLToPath(new URL('./page.tsx', import.meta.url)), 'utf8');

  it('renders the artifact iframe with sandbox="allow-scripts"', () => {
    expect(SOURCE).toContain('sandbox="allow-scripts"');
  });

  it('NEVER widens the sandbox with allow-same-origin (the boundary stays opaque-origin)', () => {
    // allow-same-origin would give the framed lesson THIS app's origin — cookies/storage/DOM access —
    // defeating the isolation. The only `allow-same-origin` mentions in this file are the comments that
    // explain its ABSENCE, so the literal that grants it (inside the sandbox attribute value) must not appear.
    expect(SOURCE).not.toMatch(/sandbox="[^"]*allow-same-origin/);
  });
});
