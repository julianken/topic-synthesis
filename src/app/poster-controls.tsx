'use client';

import { useCallback, useRef } from 'react';
import type { PageStatus } from '../domain/sitemap';
import { deleteLabel } from './library-delete';
import { MAX_SELECTION } from './library-selection';
import { useLibrary } from './library-provider';
import { CheckboxGlyph, TrashMark } from './poster-mark';

/** The longest title that still makes a clean `Select {title}` accessible name; past it (or when blank)
 *  the label degrades to the generic copy (AC3 — mirrors `deleteLabel`'s own threshold/behavior). */
const SELECT_LABEL_MAX = 80;

/** The per-card checkbox's accessible name: `Select {title}`, degrading to `Select this lesson` when the
 *  title is blank or too long for clean copy. Exported for the unit-testable pure part of this file. */
export function selectLabel(title: string | null | undefined): string {
  const trimmed = (title ?? '').trim();
  if (trimmed.length === 0 || trimmed.length > SELECT_LABEL_MAX) return 'Select this lesson';
  return `Select ${trimmed}`;
}

/**
 * The poster card's control slot — a SIBLING of the server-rendered `<a>` morph origin (scaffolded #200).
 *
 * #201 gives it the DELETE chip: a quiet `<button>` in the card's 104px top wash (top-right, where the
 * node-graph motif leaves the corners free), carrying the monoline `<TrashMark>` (never an emoji glyph)
 * and the `deleteLabel(title)` accessible name. Activating it starts the deferred delete (the provider's
 * 6s Undo window — no network at t=0) and moves focus to a logical neighbor so focus never falls to
 * `<body>`. Its own click STOPS propagation so activating it in selection mode never ALSO bubbles into
 * `PosterCard`'s whole-card toggle handler (#203).
 *
 * #203 gives it the SELECT checkbox: a matching quiet `<button role="checkbox">` top-LEFT of the same
 * wash (corners free either side), carrying the monoline `<CheckboxGlyph>` (icon-swap, never a Unicode/
 * emoji glyph) and the `selectLabel(title)` accessible name. Mounted ONLY while selection mode is on
 * (AC3) — outside selection mode there is nothing to Tab to here, avoiding a stray invisible tab stop.
 * It carries NO click handler of its own: activating it (mouse OR keyboard Space/Enter on the native
 * `<button>`) fires a `click` that BUBBLES to `PosterCard`'s wrapper `<li>`, whose own handler is the
 * SOLE place selection actually toggles (AC4/AC5) — so a checkbox click and a whole-card click can never
 * double-toggle.
 */
export function PosterControls({
  lessonId,
  title,
}: {
  lessonId: string;
  title: string;
  status: PageStatus;
}) {
  const { scheduleDelete, selectionMode, selection } = useLibrary();
  const btnRef = useRef<HTMLButtonElement>(null);

  const onDelete = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      // Never also toggle selection (AC5's whole-card toggle lives on the wrapper `<li>`'s onClick).
      e.stopPropagation();
      const li = btnRef.current?.closest('.library-poster') as HTMLElement | null;
      // Capture the focus neighbor BEFORE the card collapses, so focus never lands on <body> (AC #30):
      // next card → previous card → the +New cell → (last resort) the section header.
      const target = li ? nextFocusTarget(li) : null;
      scheduleDelete(lessonId, title);
      // Move focus after the collapse render so the neighbor is mounted + focusable.
      requestAnimationFrame(() => target?.focus());
    },
    [lessonId, title, scheduleDelete],
  );

  const selected = selection.has(lessonId);
  const atCapUnselected = !selected && selection.size >= MAX_SELECTION;

  return (
    <>
      {selectionMode ? (
        <button
          type="button"
          className="library-poster__select"
          role="checkbox"
          aria-checked={selected}
          aria-label={selectLabel(title)}
          aria-disabled={atCapUnselected || undefined}
        >
          <CheckboxGlyph state={selected ? 'all' : 'none'} />
        </button>
      ) : null}
      <button
        ref={btnRef}
        type="button"
        className="library-poster__delete"
        aria-label={deleteLabel(title)}
        onClick={onDelete}
      >
        <TrashMark />
      </button>
    </>
  );
}

/** The card anchor of the next/previous NON-pending poster, else the +New create cell, else the section
 *  header — the logical focus destination after a delete (never `<body>`). DOM-only (covered by #206 e2e). */
function nextFocusTarget(li: HTMLElement): HTMLElement | null {
  const cardAnchor = (el: Element): HTMLElement | null =>
    el.querySelector<HTMLElement>('.library-poster__card');
  const isLivePoster = (el: Element): boolean =>
    el.classList.contains('library-poster') && !el.classList.contains('library-poster--pending');

  for (let sib = li.nextElementSibling; sib; sib = sib.nextElementSibling) {
    if (isLivePoster(sib)) {
      const a = cardAnchor(sib);
      if (a) return a;
    }
  }
  for (let prev = li.previousElementSibling; prev; prev = prev.previousElementSibling) {
    if (isLivePoster(prev)) {
      const a = cardAnchor(prev);
      if (a) return a;
    }
    const newCard = prev.querySelector<HTMLElement>('.newcard');
    if (newCard) return newCard;
  }
  const grid = li.closest('.lessons-grid');
  const newCard = grid?.querySelector<HTMLElement>('.newcard');
  if (newCard) return newCard;
  // Last resort: the section title — make it programmatically focusable so focus never falls to <body>.
  const title = document.querySelector<HTMLElement>('.library__title');
  if (title) {
    if (!title.hasAttribute('tabindex')) title.setAttribute('tabindex', '-1');
    return title;
  }
  return null;
}
