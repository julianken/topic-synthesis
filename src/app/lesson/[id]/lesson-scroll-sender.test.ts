import { describe, expect, it, vi } from 'vitest';
import { PARENT_TO_CHILD_TARGET_ORIGIN } from './lesson-message';
import {
  buildScrollToMessage,
  LESSON_SCROLL_TO_TYPE,
  postScrollTo,
} from './lesson-scroll-sender';

// lesson-scroll-sender.test — the PARENT→CHILD coordinate-only section-jump SENDER (PR-C). The helper is
// the OUTBOUND counterpart to lesson-message.ts's RECEIVE side. These node tests pin the two trust-boundary
// guarantees the sender must hold (no renderer / DOM env needed — the message build is pure and the post
// targets a hand-built fake contentWindow):
//   • the payload is coordinate-only — EXACTLY { type: 'lesson:scrollTo', id } and nothing else;
//   • the post TRIES the documented opaque-origin token 'null' first, then falls back to '*' when the
//     engine rejects 'null' (the real Chromium behavior for an opaque-origin frame — so '*' is what
//     actually ships at the wire; both legs are exercised below);
//   • a null contentWindow is a guarded no-op (a not-yet-loaded iframe never throws).

describe('buildScrollToMessage — the coordinate-only payload shape (PR-F receiver contract)', () => {
  it('returns EXACTLY { type, id } — the discriminant + the id string, no extra field', () => {
    const msg = buildScrollToMessage('s3');
    expect(msg).toEqual({ type: LESSON_SCROLL_TO_TYPE, id: 's3' });
    expect(LESSON_SCROLL_TO_TYPE).toBe('lesson:scrollTo');
    // No extra attacker-reflectable property rides along — the keys are precisely these two.
    expect(Object.keys(msg).sort()).toEqual(['id', 'type']);
  });

  it('carries the id verbatim (a plain string the chrome already holds from the inbound channel)', () => {
    expect(buildScrollToMessage('where-the-mass-comes-from').id).toBe('where-the-mass-comes-from');
  });
});

describe('postScrollTo — the DOM-edge wrapper (tries the opaque token, falls back to "*", guards null)', () => {
  it('TRIES the documented opaque-origin token "null" first (the intent, where the engine accepts it)', () => {
    const postMessage = vi.fn();
    const fakeWindow = { postMessage } as unknown as Window;

    const sent = postScrollTo(fakeWindow, 's5');

    expect(sent).toBe(true);
    // The first (and only, when accepted) post targets the documented opaque token — not the wildcard.
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'lesson:scrollTo', id: 's5' },
      PARENT_TO_CHILD_TARGET_ORIGIN,
    );
    expect(PARENT_TO_CHILD_TARGET_ORIGIN).toBe('null');
  });

  it('FALLS BACK to "*" only when the engine rejects "null" (the real browser behavior for an opaque frame)', () => {
    // Real Chromium throws `SyntaxError: Invalid target origin 'null'` for an opaque-origin frame — '*' is
    // the only reachable target, and is safe for our non-navigable sandboxed artifact. Simulate the throw.
    const postMessage = vi.fn((_msg: unknown, targetOrigin: unknown) => {
      if (targetOrigin === 'null') throw new SyntaxError("Invalid target origin 'null'");
    });
    const fakeWindow = { postMessage } as unknown as Window;

    const sent = postScrollTo(fakeWindow, 's2');

    expect(sent).toBe(true);
    // First the documented token (rejected), then the '*' fallback carrying the SAME coordinate-only payload.
    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(postMessage).toHaveBeenNthCalledWith(1, { type: 'lesson:scrollTo', id: 's2' }, 'null');
    expect(postMessage).toHaveBeenNthCalledWith(2, { type: 'lesson:scrollTo', id: 's2' }, '*');
  });

  it('is a guarded no-op on a null contentWindow (a not-yet-loaded iframe) — returns false, never throws', () => {
    expect(() => postScrollTo(null, 's1')).not.toThrow();
    expect(postScrollTo(null, 's1')).toBe(false);
  });
});
