import { describe, expect, it } from 'vitest';
import { decideCardClick } from './poster-card-gesture';

// ── The poster card's click decision (issue #203 review fix — long-press self-cancel) ──────────────────
// Mirrors the `library-selection.ts` / `library-selection.test.ts` convention: pure, I/O-free logic in a
// `.ts` module so the click decision is node-tested directly (vitest `environment: 'node'`), rather than
// left entirely to the browser-only #206 e2e suite.

describe('decideCardClick — a fired long-press swallows the trailing synthetic click', () => {
  it('swallows the click when a long-press just fired, even though selection mode is now true', () => {
    // This is the exact bug: the long-press timer already called enterSelectionMode() + toggleSelected(),
    // so by the time the browser's trailing synthetic click arrives, selectionMode reads true and the
    // click would otherwise take the pointer whole-card-toggle branch and immediately deselect the card.
    expect(
      decideCardClick({ selectionMode: true, fromCheckbox: false, detail: 1, longPressFired: true }),
    ).toBe('ignore');
  });

  it('swallows the click even if it lands on the checkbox target', () => {
    // A fired long-press takes priority over every other branch — it's the browser's own follow-up to a
    // gesture already handled, not a new user click, however it's classified.
    expect(
      decideCardClick({ selectionMode: true, fromCheckbox: true, detail: 1, longPressFired: true }),
    ).toBe('ignore');
  });

  it('swallows the click even when selection mode happens to read false', () => {
    expect(
      decideCardClick({ selectionMode: false, fromCheckbox: false, detail: 1, longPressFired: true }),
    ).toBe('ignore');
  });
});

describe('decideCardClick — a normal tap (no long-press) is unaffected', () => {
  it('ignores a click outside selection mode (a quick tap opens the lesson via the anchor\'s own navigation)', () => {
    expect(
      decideCardClick({ selectionMode: false, fromCheckbox: false, detail: 1, longPressFired: false }),
    ).toBe('ignore');
  });

  it('toggles a pointer click on the whole card while in selection mode (AC5)', () => {
    expect(
      decideCardClick({ selectionMode: true, fromCheckbox: false, detail: 1, longPressFired: false }),
    ).toBe('toggle');
  });

  it('toggles a click on the checkbox while in selection mode, regardless of detail (AC4)', () => {
    expect(
      decideCardClick({ selectionMode: true, fromCheckbox: true, detail: 0, longPressFired: false }),
    ).toBe('toggle');
  });

  it('ignores a keyboard-activated click (detail === 0) on the card outside the checkbox', () => {
    // Enter on the focused anchor itself must keep navigating — never intercepted as a selection toggle.
    expect(
      decideCardClick({ selectionMode: true, fromCheckbox: false, detail: 0, longPressFired: false }),
    ).toBe('ignore');
  });
});
