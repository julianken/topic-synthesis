import { describe, expect, it, vi } from 'vitest';
import {
  LESSON_MESSAGE_TYPE,
  PARENT_TO_CHILD_TARGET_ORIGIN,
  sanitizeApparatus,
  validateMessage,
  type LessonMessage,
} from './lesson-message';

/**
 * TS-13 (path a) — the decision-12 postMessage RECEIVE-SIDE discipline, proven as a node unit test
 * (the repo can't run a browser e2e consumer — `vitest` is `environment: 'node'`, no jsdom /
 * happy-dom / Playwright / Puppeteer; Key-decision 5 / R2 forbid adding a renderer). The validator
 * is the pure-function stand-in for that consumer: hand-built fake `Window` SENTINELS exercise the
 * post→receive trust check (object identity is all `===` needs), and adversarial payloads exercise
 * the untrusted-data parse. TS-20's real parent will import + call this SAME function.
 *
 * Fake `Window` sentinels: distinct object references. The validator only ever does `===` on them
 * (it NEVER reads a property), so a bare `{}` is a faithful sentinel for an opaque-origin Window.
 */
const readerWindow = { name: 'reader-iframe-contentWindow' } as unknown as Window;
const foreignWindow = { name: 'some-other-frame' } as unknown as Window;

/** A well-formed coordinate-only payload (what the in-iframe sender posts). */
function validPayload(): LessonMessage {
  return {
    type: LESSON_MESSAGE_TYPE,
    sections: [
      { id: 's1', title: 'Predict before you reveal' },
      { id: 's2', title: 'Check your understanding' },
    ],
    scrollProgress: 0.42,
  };
}

describe('validateMessage — the identity trust check (AC4, AC6)', () => {
  it('accepts a message whose source IS the reader iframe contentWindow', () => {
    const result = validateMessage({
      source: readerWindow,
      expectedWindow: readerWindow,
      payload: validPayload(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.scrollProgress).toBe(0.42);
      expect(result.data.sections).toEqual([
        { id: 's1', title: 'Predict before you reveal' },
        { id: 's2', title: 'Check your understanding' },
      ]);
    }
  });

  it('rejects a message whose source is NOT the reader iframe sentinel (untrusted-source)', () => {
    const result = validateMessage({
      source: foreignWindow,
      expectedWindow: readerWindow,
      payload: validPayload(),
    });
    expect(result).toEqual({ ok: false, reason: 'untrusted-source' });
  });

  it('rejects a null source even with a valid payload (a foreign / detached frame)', () => {
    const result = validateMessage({
      source: null,
      expectedWindow: readerWindow,
      payload: validPayload(),
    });
    expect(result).toEqual({ ok: false, reason: 'untrusted-source' });
  });

  it('never matches when the expected window is null (no iframe mounted yet)', () => {
    // A null/null compare must NOT pass — a not-yet-mounted iframe has no trusted sender.
    const result = validateMessage({ source: null, expectedWindow: null, payload: validPayload() });
    expect(result).toEqual({ ok: false, reason: 'untrusted-source' });
  });

  it('uses Window IDENTITY, not an origin string — origin is irrelevant to the verdict (AC6)', () => {
    // The opaque-origin iframe's `event.origin` is the literal "null"; the validator takes no
    // origin arg at all, so there is structurally NO origin string compare. Identity alone decides:
    // the SAME payload+source pair flips solely on which Window is the expected sender.
    const trusted = validateMessage({
      source: readerWindow,
      expectedWindow: readerWindow,
      payload: validPayload(),
    });
    const untrusted = validateMessage({
      source: readerWindow,
      expectedWindow: foreignWindow,
      payload: validPayload(),
    });
    expect(trusted.ok).toBe(true);
    expect(untrusted.ok).toBe(false);
  });
});

describe('validateMessage — the untrusted coordinate-only data parse (AC5)', () => {
  it.each([
    ['a primitive payload', 42, 'not-an-object'],
    ['a null payload', null, 'not-an-object'],
    ['a string payload', '<img src=x onerror=alert(1)>', 'not-an-object'],
    ['a missing/wrong discriminant', { sections: [], scrollProgress: 0 }, 'wrong-type'],
  ] as const)('rejects %s with { ok: false }', (_label, payload, reason) => {
    const result = validateMessage({ source: readerWindow, expectedWindow: readerWindow, payload });
    expect(result).toEqual({ ok: false, reason });
  });

  it.each([
    ['NaN progress', NaN],
    ['Infinity progress', Infinity],
    ['a negative progress', -0.1],
    ['an over-1 progress', 1.5],
    ['a string progress', '0.5'],
  ] as const)('rejects %s as bad-progress (the 0..1 bound is enforced)', (_label, scrollProgress) => {
    const result = validateMessage({
      source: readerWindow,
      expectedWindow: readerWindow,
      payload: { type: LESSON_MESSAGE_TYPE, sections: [], scrollProgress },
    });
    expect(result).toEqual({ ok: false, reason: 'bad-progress' });
  });

  it.each([
    ['a non-array sections', 'not-an-array'],
    ['a section that is not an object', ['x']],
    ['a section missing string id/title', [{ id: 1, title: 2 }]],
    ['a section with a non-string title', [{ id: 'ok', title: { evil: '<script>' } }]],
  ] as const)('rejects %s as bad-sections', (_label, sections) => {
    const result = validateMessage({
      source: readerWindow,
      expectedWindow: readerWindow,
      payload: { type: LESSON_MESSAGE_TYPE, sections, scrollProgress: 0.5 },
    });
    expect(result).toEqual({ ok: false, reason: 'bad-sections' });
  });

  it('strips any extra attacker-controlled fields — data carries ONLY {id, title} (AC5)', () => {
    const hostile = {
      type: LESSON_MESSAGE_TYPE,
      scrollProgress: 0.5,
      sections: [{ id: 's1', title: 'ok', href: 'javascript:alert(1)', __proto__: { polluted: true } }],
    };
    const result = validateMessage({
      source: readerWindow,
      expectedWindow: readerWindow,
      payload: hostile,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The rebuilt entry carries only id + title — the `href` exfil/reflection field is gone.
      expect(result.data.sections).toEqual([{ id: 's1', title: 'ok' }]);
      expect(Object.keys(result.data.sections[0]!)).toEqual(['id', 'title']);
    }
  });

  it('performs NO eval / network side effect — it only returns data (AC5)', () => {
    // The validator is pure; assert it touches none of the dangerous globals even for a payload that
    // tries to look like markup. With no DOM in `environment: 'node'`, we stub the globals a careless
    // reflection would reach (`eval`, `fetch`) and assert NEITHER is invoked.
    const g = globalThis as { eval: typeof eval; fetch?: unknown };
    const evalSpy = vi.fn();
    const fetchSpy = vi.fn();
    const originalEval = g.eval;
    const originalFetch = g.fetch;
    g.eval = evalSpy as unknown as typeof eval;
    g.fetch = fetchSpy;
    try {
      const result = validateMessage({
        source: readerWindow,
        expectedWindow: readerWindow,
        payload: {
          type: LESSON_MESSAGE_TYPE,
          scrollProgress: 0.9,
          sections: [{ id: 'x', title: '<script>document.location="//evil"</script>' }],
        },
      });
      // The hostile-looking title is returned VERBATIM as inert data — never executed, never fetched.
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.sections[0]!.title).toBe('<script>document.location="//evil"</script>');
      }
      expect(evalSpy).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      g.eval = originalEval;
      g.fetch = originalFetch;
    }
  });
});

// ── The OPTIONAL apparatus extension (PR-F) — coordinate-only, fail-safe, bounded ────────────────────
describe('validateMessage — the OPTIONAL apparatus extension (PR-F)', () => {
  /** A well-formed apparatus payload covering every field. */
  function withApparatus(apparatus: unknown) {
    return { type: LESSON_MESSAGE_TYPE, sections: [], scrollProgress: 0.5, apparatus };
  }
  function validate(payload: unknown) {
    return validateMessage({ source: readerWindow, expectedWindow: readerWindow, payload });
  }

  it('passes a well-formed apparatus through (all five fields), as bounded TEXT-only data', () => {
    const result = validate(
      withApparatus({
        glosses: [{ term: 'Stomata', definition: 'Leaf pores that exchange gases.' }],
        figures: [{ caption: 'A cross-section of a leaf.' }],
        sources: [{ title: 'Britannica — Photosynthesis', url: 'https://www.britannica.com/science/photosynthesis' }],
        checks: [{ prompt: 'Where does the carbon come from?', answer: 'From CO₂ in the air.' }],
        takeaways: ['Plants build mass from air, not soil.'],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.apparatus).toEqual({
        glosses: [{ term: 'Stomata', definition: 'Leaf pores that exchange gases.' }],
        figures: [{ caption: 'A cross-section of a leaf.' }],
        sources: [{ title: 'Britannica — Photosynthesis', url: 'https://www.britannica.com/science/photosynthesis' }],
        checks: [{ prompt: 'Where does the carbon come from?', answer: 'From CO₂ in the air.' }],
        takeaways: ['Plants build mass from air, not soil.'],
      });
    }
  });

  it('the OLD shape (no apparatus field) stays backward-compatible — data carries no apparatus', () => {
    const result = validate({ type: LESSON_MESSAGE_TYPE, sections: [], scrollProgress: 0.5 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.apparatus).toBeUndefined();
  });

  it('accepts a PARTIAL apparatus — only the present fields survive, the rest stay absent (placeholders)', () => {
    const result = validate(withApparatus({ takeaways: ['One thing to remember.'] }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.apparatus).toEqual({ takeaways: ['One thing to remember.'] });
      expect(result.data.apparatus?.glosses).toBeUndefined();
    }
  });

  it('FAIL-SAFE: a malformed apparatus NEVER rejects the whole message — progress/sections still flow', () => {
    // apparatus is a string / array / number → dropped entirely; the message stays ok (placeholders).
    for (const bad of ['<script>', 42, ['x'], null]) {
      const result = validate({ type: LESSON_MESSAGE_TYPE, sections: [{ id: 's1', title: 'A' }], scrollProgress: 0.3, apparatus: bad });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.apparatus).toBeUndefined(); // sanitized away → placeholders
        expect(result.data.scrollProgress).toBe(0.3); // the core coordinate data still flows
        expect(result.data.sections).toEqual([{ id: 's1', title: 'A' }]);
      }
    }
  });

  it('DROPS malformed entries field-by-field — a valid sibling in the same array survives', () => {
    const result = validate(
      withApparatus({
        glosses: [
          { term: 'Good', definition: 'kept' },
          { term: 'NoDefinition' }, // dropped — missing definition
          { definition: 'NoTerm' }, // dropped — missing term
          { term: 1, definition: 2 }, // dropped — non-string
        ],
        checks: [{ prompt: 'Q?' }], // dropped — missing answer → the whole checks field omits
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.apparatus?.glosses).toEqual([{ term: 'Good', definition: 'kept' }]);
      expect(result.data.apparatus?.checks).toBeUndefined();
    }
  });

  it('SECURITY: a source URL must be http(s) — a javascript:/data: URL drops that source (no link reflected)', () => {
    const result = validate(
      withApparatus({
        sources: [
          { title: 'evil', url: 'javascript:alert(1)' }, // dropped
          { title: 'evil2', url: 'data:text/html,<script>x</script>' }, // dropped
          { title: 'ok', url: 'https://example.com/a' }, // kept
          { title: 'relative', url: '/local/path' }, // dropped — not absolute http(s)
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.apparatus?.sources).toEqual([{ title: 'ok', url: 'https://example.com/a' }]);
    }
  });

  it('SECURITY: oversized COUNTS are capped (a flood of entries cannot exceed the per-field cap)', () => {
    const glosses = Array.from({ length: 5000 }, (_v, i) => ({ term: `t${String(i)}`, definition: `d${String(i)}` }));
    const result = validate(withApparatus({ glosses }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Capped to 24 (APPARATUS_COUNT_CAP.glosses) — the panel can never be flooded with 5000 rows.
      expect(result.data.apparatus?.glosses?.length).toBe(24);
    }
  });

  it('SECURITY: oversized STRINGS drop that entry (no truncation — a half-value would be fabricated)', () => {
    const huge = 'x'.repeat(100_000);
    const result = validate(
      withApparatus({
        glosses: [
          { term: 'ok', definition: 'short' },
          { term: 'flood', definition: huge }, // dropped — definition exceeds the length cap
        ],
        takeaways: ['fine', 'y'.repeat(100_000)], // the oversized takeaway dropped, the short one kept
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.apparatus?.glosses).toEqual([{ term: 'ok', definition: 'short' }]);
      expect(result.data.apparatus?.takeaways).toEqual(['fine']);
    }
  });

  it('rebuilds each entry with ONLY its contract fields — no extra attacker-controlled property rides in', () => {
    const result = validate(
      withApparatus({
        glosses: [{ term: 'T', definition: 'D', onclick: 'evil()', __proto__: { polluted: true } }],
        sources: [{ title: 'S', url: 'https://ok.test/x', href: 'javascript:1', extra: 'leak' }],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.data.apparatus!.glosses![0]!).sort()).toEqual(['definition', 'term']);
      expect(Object.keys(result.data.apparatus!.sources![0]!).sort()).toEqual(['title', 'url']);
    }
  });

  it('an all-invalid apparatus collapses to undefined (every card falls back to its placeholder)', () => {
    const result = validate(withApparatus({ glosses: 'nope', figures: 42, sources: [{ title: 'x' }] }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.apparatus).toBeUndefined();
  });

  it('a malformed apparatus does NOT defeat the identity check — a foreign window is still rejected', () => {
    // Origin-spoof guard: even a perfectly-formed apparatus from a FOREIGN window is rejected by IDENTITY
    // (the validator never reads origin), so apparatus can never be a back-door around the trust check.
    const result = validateMessage({
      source: foreignWindow,
      expectedWindow: readerWindow,
      payload: withApparatus({ takeaways: ['x'] }),
    });
    expect(result).toEqual({ ok: false, reason: 'untrusted-source' });
  });
});

describe('sanitizeApparatus (the pure parser, used by validateMessage)', () => {
  it('returns undefined for a non-object input (string / array / null / number)', () => {
    for (const bad of ['x', ['a'], null, 42, undefined]) {
      expect(sanitizeApparatus(bad)).toBeUndefined();
    }
  });

  it('returns undefined when every field is absent or empties out', () => {
    expect(sanitizeApparatus({})).toBeUndefined();
    expect(sanitizeApparatus({ glosses: [] })).toBeUndefined();
  });
});

describe('the contract constants (AC3, AC6)', () => {
  it('exposes the discriminant the in-iframe sender stamps', () => {
    expect(LESSON_MESSAGE_TYPE).toBe('lesson:progress');
  });

  it('pins the parent→child target to a known origin, NEVER `*` (AC6)', () => {
    // The future TS-20 parent→child direction targets the opaque-origin literal, not '*'.
    expect(PARENT_TO_CHILD_TARGET_ORIGIN).toBe('null');
    expect(PARENT_TO_CHILD_TARGET_ORIGIN as string).not.toBe('*');
  });
});
