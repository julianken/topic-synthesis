import { describe, expect, it } from 'vitest';
import type { StoredPage } from '../../store/repo';
import { ARTIFACT_CSP, artifactResponse } from './serve';

const builtPage: StoredPage = {
  slug: 'periodic-functions',
  title: 'Periodic Functions',
  status: 'built',
  html: '<!doctype html><html><body><h1>Periodic Functions</h1></body></html>',
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
  // directive is needed for it — `default-src 'none'` stays complete.
  it('ARTIFACT_CSP is byte-for-byte the locked policy (TS-13 adds no relaxation — AC8)', () => {
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
