import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { StoredPage } from '../../store/repo';
import {
  ARTIFACT_CSP,
  ARTIFACT_ROOT_STYLE,
  ARTIFACT_ROOT_TOKEN_NAMES,
  ARTIFACT_ROOT_TOKENS,
  artifactResponse,
} from './serve';

const builtPage: StoredPage = {
  slug: 'periodic-functions',
  title: 'Periodic Functions',
  status: 'built',
  html: '<!doctype html><html><head><title>Periodic Functions</title></head><body><h1>Periodic Functions</h1></body></html>',
};

describe('artifactResponse', () => {
  it('serves a built page as sandboxed HTML with the strict CSP', async () => {
    const res = artifactResponse(builtPage);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('content-security-policy')).toBe(ARTIFACT_CSP);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await res.text()).toContain('<h1>Periodic Functions</h1>');
  });

  it('CSP blocks everything by default, allows the page its own inline scripts, and pins framing', () => {
    expect(ARTIFACT_CSP).toContain("default-src 'none'"); // no external loads / exfiltration
    expect(ARTIFACT_CSP).toContain("script-src 'unsafe-inline'"); // the page's own interactivity
    expect(ARTIFACT_CSP).toContain("frame-ancestors 'self'"); // only our hub may iframe it
    expect(ARTIFACT_CSP).toContain("form-action 'none'"); // doesn't inherit default-src — explicit POST-exfil block
    expect(ARTIFACT_CSP).toContain("base-uri 'none'"); // doesn't inherit default-src — no <base> URL re-pointing
    expect(ARTIFACT_CSP).not.toContain('allow-same-origin'); // sandbox isolation is the boundary
  });

  it('404s an absent page or a non-built page (null html), never an empty body', async () => {
    expect(artifactResponse(null).status).toBe(404);
    const soon: StoredPage = { slug: 'fft', title: 'FFT', status: 'soon', html: null };
    expect(artifactResponse(soon).status).toBe(404);
  });

  // TS-13 trust-boundary regression pin (AC8): the predict-gate + postMessage land INSIDE the
  // sandboxed HTML (Key-decision 1), never by widening the boundary. The CSP is pinned BYTE-FOR-BYTE
  // here so any future relaxation (e.g. a `connect-src` to send progress over the network instead of
  // in-frame postMessage) trips this test. postMessage is same-process, NOT a network load, so no CSP
  // directive is needed for it — `default-src 'none'` stays complete. TS-19 adds a `<style>` to the
  // BODY bytes only; this header assertion proves the policy is untouched (TS-19 AC4).
  it('ARTIFACT_CSP is byte-for-byte the locked policy (TS-13/TS-19 add no relaxation — AC8/AC4)', () => {
    expect(ARTIFACT_CSP).toBe(
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
        "img-src data: blob:; font-src data:; frame-ancestors 'self'; " +
        "form-action 'none'; base-uri 'none'",
    );
    // postMessage rides the sandbox, not the network — no connect-src was added to allow it.
    expect(ARTIFACT_CSP).not.toContain('connect-src');
    expect(ARTIFACT_CSP).not.toContain('allow-same-origin');
  });
});

// TS-19: serve-time injection of the fixed canonical §0 `:root` token block, so a future re-theme
// reaches already-generated lessons. The injected block is a server-side constant — the same bytes
// for every page — and is added to the BODY only; the CSP/sandbox boundary is byte-unchanged.
describe('artifactResponse — serve-time §0 :root injection (TS-19)', () => {
  it('injects exactly one canonical :root block immediately after <head> (AC2)', async () => {
    const res = artifactResponse(builtPage);
    const body = await res.text();
    // exactly one :root block (the injected one — the artifact is :root-free by code.ts)
    expect(body.match(/:root\s*\{/g)?.length).toBe(1);
    expect(body).toContain(ARTIFACT_ROOT_STYLE);
    // the served CSP header is unchanged by the injection (boundary byte-identical — AC4)
    expect(res.headers.get('content-security-policy')).toBe(ARTIFACT_CSP);
    // the deterministic anchor: the style sits immediately after the opening <head …> tag.
    expect(body.indexOf(ARTIFACT_ROOT_STYLE)).toBe(body.indexOf('<head>') + '<head>'.length);
  });

  it('<head>-absent fallback: injects exactly once after <html> (AC3)', async () => {
    const noHead: StoredPage = {
      slug: 'no-head',
      title: 'No Head',
      status: 'built',
      html: '<!doctype html><html><body><p>hi</p></body></html>',
    };
    const body = await artifactResponse(noHead).text();
    expect(body.match(/:root\s*\{/g)?.length).toBe(1);
    expect(body.indexOf(ARTIFACT_ROOT_STYLE)).toBe(body.indexOf('<html>') + '<html>'.length);
    // not also after a (nonexistent) <head>
    expect(body).not.toContain('<head>');
  });

  it('<head>- and <html>-absent fallback: prepends exactly once at document start (AC3)', async () => {
    const bare: StoredPage = {
      slug: 'bare',
      title: 'Bare',
      status: 'built',
      html: '<p>just a fragment</p>',
    };
    const body = await artifactResponse(bare).text();
    expect(body.match(/:root\s*\{/g)?.length).toBe(1);
    expect(body.startsWith(ARTIFACT_ROOT_STYLE)).toBe(true);
    expect(body.endsWith('<p>just a fragment</p>')).toBe(true);
  });

  it('matches <head …> with attributes, case-insensitively (deterministic anchor)', async () => {
    const upper: StoredPage = {
      slug: 'upper',
      title: 'Upper',
      status: 'built',
      html: '<!DOCTYPE html><HTML><HEAD lang="en"><title>x</title></HEAD><body></body></HTML>',
    };
    const body = await artifactResponse(upper).text();
    expect(body.match(/:root\s*\{/g)?.length).toBe(1);
    expect(body.indexOf(ARTIFACT_ROOT_STYLE)).toBe(
      body.indexOf('<HEAD lang="en">') + '<HEAD lang="en">'.length,
    );
  });

  it('the injected <style> bytes are identical across two different pages (AC5 — no per-lesson value)', async () => {
    // Distinctive sentinels so leakage of any field would be unmistakable in the injected fragment.
    const a: StoredPage = {
      slug: 'SENTINEL-SLUG-AAA',
      title: 'SENTINEL-TITLE-AAA',
      status: 'built',
      html: '<html><head></head><body>SENTINEL-BODY-AAA</body></html>',
    };
    const b: StoredPage = {
      slug: 'SENTINEL-SLUG-BBB',
      title: 'SENTINEL-TITLE-BBB',
      status: 'built',
      html: '<html><head></head><body>SENTINEL-BODY-BBB</body></html>',
    };
    const bodyA = await artifactResponse(a).text();
    const bodyB = await artifactResponse(b).text();
    // the injected fragment is present and byte-identical regardless of slug/title/html
    expect(bodyA).toContain(ARTIFACT_ROOT_STYLE);
    expect(bodyB).toContain(ARTIFACT_ROOT_STYLE);
    // isolate the injected style from each body and prove the two are byte-for-byte equal
    const styleOf = (body: string) => body.slice(body.indexOf('<style>'), body.indexOf('</style>') + '</style>'.length);
    expect(styleOf(bodyA)).toBe(ARTIFACT_ROOT_STYLE);
    expect(styleOf(bodyA)).toBe(styleOf(bodyB));
    // and no StoredPage field leaked into the injected constant
    expect(ARTIFACT_ROOT_STYLE).not.toContain('SENTINEL');
  });

  it('the injected output is one parseable document: single <html>, the <style> is closed (AC6)', async () => {
    const res = artifactResponse(builtPage);
    const body = await res.text();
    // exactly one <html> root and one closing tag (injection added no second root)
    expect(body.match(/<html\b/gi)?.length).toBe(1);
    expect(body.match(/<\/html>/gi)?.length).toBe(1);
    // the injected <style> is well-formed and closed
    expect(ARTIFACT_ROOT_STYLE.startsWith('<style>')).toBe(true);
    expect(ARTIFACT_ROOT_STYLE.endsWith('</style>')).toBe(true);
    expect(body.match(/<style>/g)?.length).toBe(1);
    expect(body.match(/<\/style>/g)?.length).toBe(1);
  });

  it('no injection on the not-found path (AC7): a null/soon page 404s with no :root', async () => {
    const soon: StoredPage = { slug: 'fft', title: 'FFT', status: 'soon', html: null };
    const resNull = artifactResponse(null);
    const resSoon = artifactResponse(soon);
    expect(resNull.status).toBe(404);
    expect(resSoon.status).toBe(404);
    expect(await resNull.text()).not.toContain(':root');
    expect(await resSoon.text()).not.toContain(':root');
  });

  it('the injected :root carries §0 OKLCH dark values (AC1 — DESIGN.md mirror, not a fork)', () => {
    // a representative sample of the locked §0 OKLCH/geometry/font literals (DESIGN.md ## 0 / globals.css)
    expect(ARTIFACT_ROOT_STYLE).toContain('--bg-app:oklch(0.165 0.018 250)'); // near-black canvas
    expect(ARTIFACT_ROOT_STYLE).toContain('--text:oklch(0.95 0.008 250)'); // near-white body text
    expect(ARTIFACT_ROOT_STYLE).toContain('--accent:oklch(0.82 0.145 215)'); // cyan-blue, NOT green
    expect(ARTIFACT_ROOT_STYLE).toContain('--measure:33rem');
    expect(ARTIFACT_ROOT_STYLE).toContain('--frame-max:1640px');
    expect(ARTIFACT_ROOT_STYLE).toContain('--serif:"Iowan Old Style"');
    // dark instrument aesthetic — no sRGB hex, no light/parchment inversion
    expect(ARTIFACT_ROOT_STYLE).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  // AC10 — the static superset assertion. The injected :root token NAMES must be a SUPERSET of the
  // `var(--token, …)` reference names the `code` prompt pins as inline fallbacks. We extract the
  // reference set FROM code.ts (the canonical source), so a future §0 rename that adds a token to the
  // artifact but not to the injected block fails HERE rather than silently no-op'ing re-theming.
  // The matcher captures the token name regardless of whether a fallback follows (NO comma required):
  // code.ts also carries no-fallback refs in its prose (`var(--measure)`, `var(--panel-w)`,
  // `var(--frame-max)`) — exactly the references that render BROKEN, not degraded, if injection omits
  // the token, so the superset must cover them too. A comma-anchored matcher would silently skip them.
  it('the injected :root names are a SUPERSET of the artifact var() reference names (AC10)', () => {
    const codeSrc = readFileSync(
      fileURLToPath(new URL('../../pipeline/code.ts', import.meta.url)),
      'utf8',
    );
    const referenced = new Set(
      [...codeSrc.matchAll(/var\(\s*(--[a-z][a-z0-9-]*)/gi)]
        .map((m) => m[1])
        .filter((name): name is string => name !== undefined),
    );
    // `--token` is the literal placeholder used in the prompt's prose ("var(--token, <fallback>)"),
    // not a real design token — exclude it from the reference set.
    referenced.delete('--token');
    expect(referenced.size).toBeGreaterThan(0); // we actually found references
    const injected = new Set(ARTIFACT_ROOT_TOKEN_NAMES);
    const missing = [...referenced].filter((name) => !injected.has(name));
    expect(missing).toEqual([]);
  });

  // VALUE-DRIFT guard — the strong complement to AC10's NAME-superset. The §0 manifest now has THREE
  // copies (globals.css SoT, code.ts inline `var()` fallbacks, this file's ARTIFACT_ROOT_TOKENS). The
  // name-superset catches a RENAME; it does NOT catch a value edit. The precise re-theme mistake TS-19
  // exists to prevent is: a future §0 retoken edits globals.css (and code.ts fallbacks) but forgets
  // serve.ts — injection would then silently serve the OLD theme to every already-generated lesson.
  // This parses globals.css's resolved :root and asserts ARTIFACT_ROOT_TOKENS[name] equals the
  // globals.css value for EVERY shared token (full set, not a sample), so any value drift is a CI
  // failure here. globals.css is the source of truth; the injected block is its reconciled mirror.
  it('every injected token VALUE equals the resolved globals.css §0 value (value-drift guard)', () => {
    const cssSrc = readFileSync(
      fileURLToPath(new URL('../globals.css', import.meta.url)),
      'utf8',
    );
    // The :root block is the document's first { … } body after `:root`.
    const rootBody = /:root\s*\{([\s\S]*?)\}/.exec(cssSrc)?.[1];
    expect(rootBody).toBeDefined();
    // Parse `--name: value;` declarations into a raw map (value still possibly a `var(--other)` ref).
    const raw = new Map<string, string>();
    for (const m of (rootBody as string).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
      raw.set(m[1] as string, (m[2] as string).trim());
    }
    expect(raw.size).toBeGreaterThan(0);
    // Resolve a value to its literal: a `var(--other)` (no fallback, the globals.css indirection form,
    // e.g. `--bg-app: var(--ink-950)`) dereferences to its primitive; a literal returns as-is. A small
    // depth cap defends against an accidental reference cycle without hanging the test.
    const resolve = (value: string, depth = 0): string => {
      const ref = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i.exec(value);
      if (ref && depth < 8) {
        const target = raw.get(ref[1] as string);
        expect(target).toBeDefined(); // a dangling var() reference in globals.css is itself a bug
        return resolve(target as string, depth + 1);
      }
      return value;
    };
    // Build a name → resolved-literal map for the whole globals.css :root.
    const resolved = new Map([...raw].map(([name, value]) => [name, resolve(value)]));
    // Assert: every injected token's value matches the resolved §0 value, for the FULL injected set.
    const drift = ARTIFACT_ROOT_TOKEN_NAMES.filter((name) => {
      expect(resolved.has(name)).toBe(true); // an injected token absent from globals.css is drift
      return resolved.get(name) !== ARTIFACT_ROOT_TOKENS[name];
    });
    expect(drift).toEqual([]);
  });
});
