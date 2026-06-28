'use client';

import { useRouter } from 'next/navigation';
import { type CSSProperties, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  BEGIN_GENERATE_TYPE,
  NEW_SURFACE_NAME,
  runViewTransition,
  SPECIMEN_TOPIC_NAME,
  vtOff,
} from './library-morph';
import { GeneratingView } from './curriculum/[id]/generating-view'; // concept-drift-ok: route identifier, deferred rename (ADR-0003)
import type { StepEvent } from './curriculum/[id]/stage-rail'; // concept-drift-ok: route identifier, deferred rename (ADR-0003)
import type { ResearchEvent } from '../store/repo'; // concept-drift-ok: code identifier, deferred rename (ADR-0003)

/**
 * The library home's LIBRARY + CREATE client island (the create-form flow). It wraps the server-rendered
 * owner-scoped lesson cards (passed as `children` so the `listLessons` fetch stays behind the session gate
 * on the server) and owns the three-view state machine:
 *
 *   index      — the card grid: a dashed `+ New lesson` cell FIRST, then the library cards.
 *   form       — clicking `+New` GROWS that cell in place into the intake form (a same-document
 *                container-transform; the card box FLIPs into the form via the shared `new-surface`
 *                view-transition-name + `.morph-box`, then the fields stagger in). Esc / Cancel collapses.
 *   generating — on a successful submit (`202 {id}`) the form RECEDES and the typed topic text LIFTS into
 *                the generating shell's header (the `begin-generate` typed transition + the `specimen-topic`
 *                shared element); the in-place generating shell polls status and navigates to
 *                `/curriculum/[id]` once the run lands. concept-drift-ok: route identifier, deferred rename (ADR-0003)
 *
 * The four fields + the POST contract are UNCHANGED from the prior `intake-form.tsx`: topic / level /
 * depth(1..5) / optional audience → `POST /api/generate { topic, level, depth, audience }` → `202 {id}`,
 * surfacing 400/401/403/502 as the error text. The redesign changes only the framing + the motion.
 *
 * Every scripted `document.startViewTransition` is gated by {@link vtOff} (capability + reduced-motion): on
 * a fail the swap is SYNCHRONOUS / instant — no morph, no recede — and the global `prefers-reduced-motion`
 * rule in `globals.css` zeroes the staggered fields + eased borders. The opaque-origin lesson iframe and
 * its trust boundary are never touched here; this flow lives entirely on the library `/` chrome.
 */

type View = 'index' | 'form' | 'generating';

const POLL_MS = 2500;
const MAX_ATTEMPTS = 160; // ~6-7 min, then stop polling and surface a hint (mirrors generating.tsx)

export function LibraryCreate({ head, children }: { head: ReactNode; children: ReactNode }) {
  const router = useRouter();
  const [view, setView] = useState<View>('index');
  // The in-flight run id (set on a 202) — drives the in-place generating shell's status poll.
  const [runId, setRunId] = useState<string | null>(null);

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

  // ── SUBMIT: the form's POST contract is UNCHANGED; on 202 → the chrome-to-chrome handoff ─────────────
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

    // SUCCESS (202 {id}): the chrome-to-chrome handoff. The topic text MORPHS form → generating header via
    // the shared `specimen-topic` name and the form root RECEDES (the `begin-generate` typed transition,
    // keyed in globals.css). An <input>'s value can't be a VT shared element across a value→text change, so
    // we morph a positioned text-TWIN span echoing the typed topic (the scratch prototype's technique).
    const morphing = !vtOff();
    let twin: HTMLSpanElement | null = null;
    const input = topicInputRef.current;
    if (morphing && input) {
      const rect = input.getBoundingClientRect();
      twin = document.createElement('span');
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

    setRunId(id);
    void runViewTransition(() => {
      setView('generating');
    }, [BEGIN_GENERATE_TYPE]).then(() => {
      twin?.remove();
    });
  }, [topic, level, depth, audience, submitting]);

  // ── In-place generating shell: poll status, navigate to /curriculum/[id] on ready ─────────────────── // concept-drift-ok: route identifier, deferred rename (ADR-0003)
  // Reuses the generating.tsx poller PATTERN (the same status endpoint + the same pure stage-rail core)
  // but, because the generating shell renders in-place on `/`, it NAVIGATES (router.replace) to the reader
  // route when the run lands rather than router.refresh()ing the library.
  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [research, setResearch] = useState<ResearchEvent[]>([]);
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    if (view !== 'generating' || !runId) return;
    let active = true;
    let attempts = 0;
    const timer = setInterval(async () => {
      attempts += 1;
      if (attempts > MAX_ATTEMPTS) {
        clearInterval(timer);
        if (active) setStalled(true);
        return;
      }
      try {
        const res = await fetch(`/api/curriculum/${encodeURIComponent(runId)}/status`, { // concept-drift-ok: route identifier, deferred rename (ADR-0003)
          cache: 'no-store',
        });
        if (!res.ok) return;
        const body = (await res.json()) as {
          ready?: boolean;
          steps?: StepEvent[];
          research?: ResearchEvent[];
        };
        if (!active) return;
        if (body.steps) setSteps(body.steps);
        if (body.research) setResearch(body.research);
        if (body.ready) {
          clearInterval(timer);
          router.replace(`/curriculum/${encodeURIComponent(runId)}`); // concept-drift-ok: route identifier, deferred rename (ADR-0003)
        }
      } catch {
        // transient network error — keep polling
      }
    }, POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [view, runId, router]);

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

  // GENERATING is a clean, focused screen — the library header (the "Lessons" title + the tap hint) is
  // DROPPED here (matching the prototype + SPEC §3c/§4), so no stale "Tap a built lesson" copy sits above
  // a lesson that is mid-generation. The head only renders in the index/form views below. The SHARED
  // live-research view (the B view — Figma 1:2) renders the research node-graph + the LIVE RESEARCH panel
  // + the rail; the typed topic LANDED here via the `specimen-topic` shared element (GeneratingView puts
  // that name on its topic span), so the submit handoff morph still has its destination.
  if (view === 'generating') {
    return (
      <section className="generating-shell">
        <GeneratingView topic={topic.trim()} steps={steps} research={research} stalled={stalled} />
      </section>
    );
  }

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
