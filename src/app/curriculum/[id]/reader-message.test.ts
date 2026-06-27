import { describe, expect, it } from 'vitest';
import { INITIAL_READER_CHROME, reduceReaderMessage } from './reader-message';
import { LESSON_MESSAGE_TYPE, type LessonMessage } from './lesson-message';

/**
 * TS-20 (Phase 3) — the reader shell's message-handler CONTRACT, proven as a node unit test (the
 * `.tsx` shell can't mount in `vitest`'s `environment: 'node'` — no DOM; the same constraint
 * `lesson-message.test.ts` notes). `reduceReaderMessage` is the pure core the shell's `message`
 * handler calls per event. This file tests ONLY the handler's contract — it delegates to
 * `validateMessage`, drives chrome on `{ ok: true }`, and IGNORES `{ ok: false }` — and deliberately
 * does NOT re-test the validator's adversarial-payload matrix (that is TS-13's
 * `lesson-message.test.ts`, not duplicated here).
 *
 * Fake `Window` sentinels — distinct object references; the reducer only `===`-compares them (via
 * `validateMessage`), never reads a property, so a bare object is a faithful opaque-origin Window.
 */
const iframeWindow = { name: 'reader-iframe-contentWindow' } as unknown as Window;
const foreignWindow = { name: 'some-other-frame' } as unknown as Window;

function validPayload(): LessonMessage {
  return {
    type: LESSON_MESSAGE_TYPE,
    sections: [
      { id: 's1', title: 'Predict before you reveal' },
      { id: 's2', title: 'Check your understanding' },
    ],
    scrollProgress: 0.6,
  };
}

describe('reduceReaderMessage — drives chrome only on a trusted, on-contract message (AC4, AC6)', () => {
  it('returns the next chrome state (progress + sections) when source IS the iframe contentWindow', () => {
    const next = reduceReaderMessage({
      source: iframeWindow,
      expectedWindow: iframeWindow,
      payload: validPayload(),
    });
    expect(next).toEqual({
      scrollProgress: 0.6,
      sections: [
        { id: 's1', title: 'Predict before you reveal' },
        { id: 's2', title: 'Check your understanding' },
      ],
    });
  });

  it('passes event.source as `source` and the iframe contentWindow as `expectedWindow` — identity, not origin (AC4)', () => {
    // The verdict flips SOLELY on which Window is the trusted sender — there is no origin arg at all.
    const trusted = reduceReaderMessage({
      source: iframeWindow,
      expectedWindow: iframeWindow,
      payload: validPayload(),
    });
    const untrusted = reduceReaderMessage({
      source: iframeWindow,
      expectedWindow: foreignWindow,
      payload: validPayload(),
    });
    expect(trusted).not.toBeNull();
    expect(untrusted).toBeNull();
  });

  it('builds the next state ONLY from validated coordinates — extra payload fields never ride in (AC6)', () => {
    const hostile = {
      type: LESSON_MESSAGE_TYPE,
      scrollProgress: 0.5,
      sections: [{ id: 's1', title: 'ok', href: 'javascript:alert(1)' }],
    };
    const next = reduceReaderMessage({
      source: iframeWindow,
      expectedWindow: iframeWindow,
      payload: hostile,
    });
    // The validator rebuilt each entry as {id, title} only — the `href` exfil field is gone.
    expect(next).toEqual({ scrollProgress: 0.5, sections: [{ id: 's1', title: 'ok' }] });
    expect(next && Object.keys(next.sections[0]!)).toEqual(['id', 'title']);
  });
});

describe('reduceReaderMessage — ignores every { ok: false } verdict (AC5)', () => {
  it('returns null for an untrusted source (a foreign frame)', () => {
    const next = reduceReaderMessage({
      source: foreignWindow,
      expectedWindow: iframeWindow,
      payload: validPayload(),
    });
    expect(next).toBeNull();
  });

  it('returns null when the iframe has not mounted yet (expectedWindow null)', () => {
    // Before the frame mounts there is no trusted sender — a null expected window can never match.
    const next = reduceReaderMessage({
      source: foreignWindow,
      expectedWindow: null,
      payload: validPayload(),
    });
    expect(next).toBeNull();
  });

  it('returns null for an off-contract payload (so the handler performs no payload-driven DOM write)', () => {
    // One representative off-contract case — the full adversarial matrix is lesson-message.test.ts.
    const next = reduceReaderMessage({
      source: iframeWindow,
      expectedWindow: iframeWindow,
      payload: { type: LESSON_MESSAGE_TYPE, sections: [], scrollProgress: 1.5 },
    });
    expect(next).toBeNull();
  });
});

describe('reduceReaderMessage — the no-data path (AC6)', () => {
  it('starts empty/zero so the shell renders fully usable over a bare iframe', () => {
    expect(INITIAL_READER_CHROME).toEqual({ scrollProgress: 0, sections: [] });
  });
});
