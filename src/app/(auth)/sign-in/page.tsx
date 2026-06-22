'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { signInWithGoogle } from '../../auth/client';

export default function SignIn() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <main className="wrap">
      <p className="eyebrow">Topic Synthesis</p>
      <h1>Sign in</h1>
      <p className="lead">
        This is a private, invite-only preview. Sign in with the Google account on the allowlist to
        generate and view lessons.
      </p>
      <button className="btn" onClick={() => void go()} disabled={busy}>
        {busy ? 'Signing in…' : 'Continue with Google'}
      </button>
      {error ? (
        <p className="intake__error" role="alert">
          {error}
        </p>
      ) : null}
    </main>
  );
}
