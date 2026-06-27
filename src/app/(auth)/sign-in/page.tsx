'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { signInWithGoogle } from '../../auth/client';
import { GoogleG } from './google-g';

export default function SignIn() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auth flow (verbatim — DESIGN.md §Sign-in: the Google consent popup is the one external surface):
  // signInWithGoogle() → POST /api/auth/session (mints the httpOnly session cookie) → router.push('/').
  async function go() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const idToken = await signInWithGoogle();
      const res = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Sign-in was rejected.');
      }
      router.push('/');
    } catch (err) {
      // A user-closed popup is not an error worth shouting about.
      const message = err instanceof Error ? err.message : 'Sign-in failed.';
      setError(/popup-closed|cancelled/i.test(message) ? null : message);
      setBusy(false);
    }
  }

  return (
    <main className="signin">
      <div className="signin__card">
        <div className="signin__badge" aria-hidden="true">
          ✦
        </div>
        <p className="signin__wordmark">
          topic·<span className="signin__wordmark-accent">synthesis</span>
        </p>
        <h1 className="signin__title">Sign in to your lessons</h1>
        <p className="signin__lead">
          Generate interactive, source-grounded lessons from any topic. Private to your account.
        </p>
        <button
          type="button"
          className="signin__google"
          onClick={() => void go()}
          disabled={busy}
        >
          <GoogleG />
          {busy ? 'Signing in…' : 'Continue with Google'}
        </button>
        {error ? (
          <p className="signin__error" role="alert">
            {error}
          </p>
        ) : null}
        <p className="signin__foot">
          Allowlisted Google sign-in · ADR-0002
          <br />
          no spend before a verified session
        </p>
      </div>
    </main>
  );
}
