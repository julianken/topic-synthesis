'use client';

import { type CSSProperties, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { NEW_SURFACE_NAME, runViewTransition, SPECIMEN_TOPIC_NAME, vtOff } from './library-morph';

/**
 * The library home's LIBRARY + CREATE client island (the create-form flow). It wraps the server-rendered
 * owner-scoped lesson cards (passed as `children` so the `listLessons` fetch stays behind the session gate
 * on the server) and owns the two-view state machine + the submit-handoff NAVIGATION:
 *
 *   index — the card grid: a dashed `+ New lesson` cell FIRST, then the library cards.
 *   form  — clicking `+New` GROWS that cell in place into the intake form (a same-document
 *           container-transform; the card box FLIPs into the form via the shared `new-surface`
 *           view-transition-name + `.morph-box`, then the fields stagger in). Esc / Cancel collapses.
 *
 * On a successful submit (`202 {id}`) the island NAVIGATES to the SINGLE generating screen at
 * `/lesson/[id]` (run-lifecycle #225 — the divergence-prone in-place generating shell is GONE; the typed
 * topic now reaches that destination server-side via `run_owner`). The typed topic text MORPHS form →
 * generating-header across the route change via the CROSS-DOCUMENT View-Transition the app already runs for
 * card→reader (`@view-transition { navigation: auto }` in `globals.css`), paired by the shared
 * `specimen-topic` name: the form's topic value (OLD side, a positioned text-twin span) and the generating
 * view's `#genTopic` header (NEW side). A generating-destination branch in the morph receiver guard
 * (`reader-morph-guard.ts`) keeps the cross-doc VT from skipping on the `.gen` page (it has no
 * `#readerPanel`). Under reduced motion / no VT API ({@link vtOff}) it is a plain instant navigation.
 *
 * The four fields + the POST contract are UNCHANGED from the prior `intake-form.tsx`: topic / level /
 * depth(1..5) / optional audience → `POST /api/generate { topic, level, depth, audience }` → `202 {id}`,
 * surfacing 400/401/403/502 as the error text. The redesign changes only the framing + the motion.
 *
 * Every scripted same-document `document.startViewTransition` (the `+New` card ↔ form morph) is gated by
 * {@link vtOff} (capability + reduced-motion): on a fail the swap is SYNCHRONOUS / instant — no morph — and
 * the global `prefers-reduced-motion` rule in `globals.css` zeroes the staggered fields + eased borders.
 * The opaque-origin lesson iframe and its trust boundary are never touched here.
 */

type View = 'index' | 'form';

export function LibraryCreate({ head, children }: { head: ReactNode; children: ReactNode }) {
  const [view, setView] = useState<View>('index');

  // The four controlled form fields + submit state — RELOCATED VERBATIM from intake-form.tsx.
  const [topic, setTopic] = useState('');
  const [level, setLevel] = useState('intermediate');
  const [depth, setDepth] = useState(3);
  const [audience, setAudience] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const newCardRef = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const topicInputRef = useRef<HTMLInputElement>(null);
  // Whether the staggered field-reveal class is applied (added one rAF after the open VT commits).
  const [fieldsIn, setFieldsIn] = useState(false);

  // ── OPEN: +New card → intake form (same-document container-transform) ───────────────────────────────
  const openForm = useCallback(() => {
    // Stamp the shared morph name + .morph-box on the OLD endpoint (the +New card) BEFORE the snapshot, so
    // the VT pairs it with the form (which carries the same name + class on the NEW side). Under vtOff the
    // names are inert (the transition never starts) and the swap is a plain synchronous state change.
    const card = newCardRef.current;
    if (card && !vtOff()) {
      card.style.viewTransitionName = NEW_SURFACE_NAME;
      card.classList.add('morph-box');
    }
    setFieldsIn(false);
    void runViewTransition(() => {
      setView('form');
    }, ['open-form']).then(() => {
      // Post-commit: focus the topic input + stagger the fields a beat after the box settles. Under the
      // instant-swap floor this still runs (synchronously after the resolved promise) so focus moves and
      // the fields are visible — the global reduced-motion rule simply zeroes the stagger animation.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          setFieldsIn(true);
          topicInputRef.current?.focus();
        }),
      );
    });
  }, []);

  // ── CLOSE: intake form → +New card (the morph in reverse) ───────────────────────────────────────────
  const closeForm = useCallback(() => {
    const form = formRef.current;
    if (form && !vtOff()) {
      form.style.viewTransitionName = NEW_SURFACE_NAME;
      form.classList.add('morph-box');
    }
    setError(null);
    void runViewTransition(() => {
      setView('index');
    }, ['close-form']).then(() => {
      newCardRef.current?.focus();
    });
  }, []);

  // ── SUBMIT: the form's POST contract is UNCHANGED; on 202 → NAVIGATE to /lesson/[id] (run-lifecycle #225) ──
  const submit = useCallback(async () => {
    if (!topic.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    let id: string;
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topic: topic.trim(), level, depth, audience: audience.trim() }),
      });
      if (!res.ok) throw new Error(`Generation request failed (${res.status}).`);
      ({ id } = (await res.json()) as { id: string });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setSubmitting(false);
      return;
    }

    // SUCCESS (202 {id}): NAVIGATE to the SINGLE generating screen at /lesson/[id]. When motion is allowed
    // ({@link vtOff} false), stamp the OLD-side morph endpoint BEFORE the navigation snapshot so the typed
    // topic MORPHS form → generating-header across the route change (the shared `specimen-topic` name,
    // paired with the generating view's `#genTopic` header on the new document). An <input>'s value can't
    // be a VT shared element across a value→text change, so we morph a positioned text-TWIN span echoing
    // the typed topic (the prior same-document handoff's technique); the document unloads on navigation, so
    // the twin needs no cleanup.
    const href = `/lesson/${encodeURIComponent(id)}`;
    const input = topicInputRef.current;
    if (!vtOff() && input) {
      const rect = input.getBoundingClientRect();
      const twin = document.createElement('span');
      twin.textContent = topic.trim();
      Object.assign(twin.style, {
        position: 'fixed',
        left: `${rect.left + 12}px`,
        top: `${rect.top}px`,
        height: `${rect.height}px`,
        lineHeight: `${rect.height}px`,
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        fontFamily: 'var(--sans)',
        fontSize: 'var(--fs-small)',
        color: 'var(--text)',
        viewTransitionName: SPECIMEN_TOPIC_NAME,
      } as Partial<CSSStyleDeclaration>);
      document.body.appendChild(twin);
      input.style.color = 'transparent';
    }

    // A full CROSS-DOCUMENT navigation (NOT router.push — a soft client-side nav would NOT trigger the
    // cross-doc `@view-transition` transport or the `pagereveal` receiver guard) — the same reason
    // page.tsx's card→reader link is a plain <a>, never next/link. Under `vtOff` it is a plain instant nav.
    window.location.assign(href);
  }, [topic, level, depth, audience, submitting]);

  // Esc closes the form; `n` opens it from the index (the global shortcuts the spec names).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && view === 'form') {
        e.preventDefault();
        closeForm();
      } else if (
        e.key === 'n' &&
        view === 'index' &&
        // Don't hijack `n` while the user is typing in a field elsewhere.
        !(e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))
      ) {
        e.preventDefault();
        openForm();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, openForm, closeForm]);

  return (
    <>
      {head}
      <ul className={`lessons-grid${view === 'form' ? ' lessons-grid--form-open' : ''}`}>
        <li className="lessons-grid__create">
          {view === 'form' ? (
            <IntakeForm
              formRef={formRef}
              topicInputRef={topicInputRef}
              fieldsIn={fieldsIn}
              topic={topic}
              setTopic={setTopic}
              level={level}
              setLevel={setLevel}
              depth={depth}
              setDepth={setDepth}
              audience={audience}
              setAudience={setAudience}
              submitting={submitting}
              error={error}
              onClose={closeForm}
              onSubmit={() => void submit()}
            />
          ) : (
            <button
              ref={newCardRef}
              type="button"
              className="newcard"
              aria-label="New lesson — open the create form"
              onClick={openForm}
            >
              <span className="newcard__plus" aria-hidden="true">
                +
              </span>
              <span className="newcard__label">New lesson</span>
              <span className="newcard__sub">start a run</span>
            </button>
          )}
        </li>
        {children}
      </ul>
    </>
  );
}

/**
 * The intake form surface — the four controlled fields + the unchanged submit, framed inside the grown
 * `+New` cell. It carries the shared `new-surface` view-transition-name + `.morph-box` so it is the FLIP
 * destination the `+New` card grows into; the fields stagger in (`.fieldsin` + per-field `--rail-i`) one
 * rAF after the box settles. Reduced motion zeroes the stagger via the global rule in globals.css.
 */
function IntakeForm(props: {
  formRef: React.RefObject<HTMLFormElement | null>;
  topicInputRef: React.RefObject<HTMLInputElement | null>;
  fieldsIn: boolean;
  topic: string;
  setTopic: (v: string) => void;
  level: string;
  setLevel: (v: string) => void;
  depth: number;
  setDepth: (v: number) => void;
  audience: string;
  setAudience: (v: string) => void;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const {
    formRef,
    topicInputRef,
    fieldsIn,
    topic,
    setTopic,
    level,
    setLevel,
    depth,
    setDepth,
    audience,
    setAudience,
    submitting,
    error,
    onClose,
    onSubmit,
  } = props;
  return (
    <form
      ref={formRef}
      // The `new-surface` name + `.morph-box` make the form the FLIP destination the `+New` card grows
      // into. Set inline (never a static CSS rule). They are cleaned off the live node after the VT
      // commits is unnecessary here because the form unmounts on close — the +New card re-stamps its own.
      className={`intake morph-box${fieldsIn ? ' fieldsin' : ''}`}
      style={{ viewTransitionName: NEW_SURFACE_NAME } as CSSProperties}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="intake__head">
        <span className="intake__title">New lesson</span>
        <button type="button" className="intake__close" aria-label="Cancel" onClick={onClose}>
          Esc · Cancel
        </button>
      </div>

      <label className="field" style={{ '--rail-i': 0 } as CSSProperties}>
        <span className="field__label">Topic</span>
        <input
          ref={topicInputRef}
          className="field__input"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. Fourier transforms"
          required
          autoComplete="off"
        />
      </label>

      <div className="field-row">
        <label className="field" style={{ '--rail-i': 1 } as CSSProperties}>
          <span className="field__label">Level</span>
          <select className="field__input" value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="intro">Intro</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </select>
        </label>

        <label className="field" style={{ '--rail-i': 2 } as CSSProperties}>
          <span className="field__label">Depth: {depth}</span>
          <input
            className="field__range"
            type="range"
            min={1}
            max={5}
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value))}
          />
        </label>
      </div>

      <label className="field" style={{ '--rail-i': 3 } as CSSProperties}>
        <span className="field__label">Audience (optional)</span>
        <input
          className="field__input"
          value={audience}
          onChange={(e) => setAudience(e.target.value)}
          placeholder="e.g. self-taught dev"
          autoComplete="off"
        />
      </label>

      <div className="field" style={{ '--rail-i': 4 } as CSSProperties}>
        <button className="btn" type="submit" disabled={submitting || !topic.trim()}>
          {submitting ? 'Generating…' : 'Generate'}
        </button>
      </div>

      {error ? (
        <p className="intake__error intake__error--show" role="alert">
          <span className="intake__error-icon" aria-hidden="true">
            !
          </span>{' '}
          {error}
        </p>
      ) : null}
      <p className="intake__note">Runs on Haiku, capped — about a minute and a few cents.</p>
    </form>
  );
}
