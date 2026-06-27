'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * The topic-intake form — the library home's SOLE generation entry (TS-17). RELOCATED VERBATIM from the
 * prior intake-only `page.tsx`: the validation, the `POST /api/generate`, and the success
 * `router.push` to the reader route are unchanged — TS-17 folds the intake onto the library page (one
 * cross-document route the morph originates from), it does NOT rewrite the generation contract.
 *
 * A small `'use client'` island embedded in the server-component library page (which owns the
 * session-gated `listLessons` data fetch) — mirroring the `layout.tsx` server + `SessionNav` client split.
 */
export function IntakeForm() {
  const router = useRouter();
  const [topic, setTopic] = useState('');
  const [level, setLevel] = useState('intermediate');
  const [depth, setDepth] = useState(3);
  const [audience, setAudience] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!topic.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topic: topic.trim(), level, depth, audience: audience.trim() }),
      });
      if (!res.ok) throw new Error(`Generation request failed (${res.status}).`);
      const { id } = (await res.json()) as { id: string };
      router.push(`/curriculum/${encodeURIComponent(id)}`); // concept-drift-ok: route identifier, deferred rename (ADR-0003)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setSubmitting(false);
    }
  }

  return (
    <form
      className="intake"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label className="field">
        <span className="field__label">Topic</span>
        <input
          className="field__input"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. Fourier transforms"
          required
          autoFocus
        />
      </label>

      <label className="field">
        <span className="field__label">Level</span>
        <select className="field__input" value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="intro">Intro</option>
          <option value="intermediate">Intermediate</option>
          <option value="advanced">Advanced</option>
        </select>
      </label>

      <label className="field">
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

      <label className="field">
        <span className="field__label">Audience (optional)</span>
        <input
          className="field__input"
          value={audience}
          onChange={(e) => setAudience(e.target.value)}
          placeholder="e.g. self-taught dev"
        />
      </label>

      <button className="btn" type="submit" disabled={submitting || !topic.trim()}>
        {submitting ? 'Generating…' : 'Generate'}
      </button>
      {error ? (
        <p className="intake__error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
