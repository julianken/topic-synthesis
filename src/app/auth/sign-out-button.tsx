'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="topbar__signout"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch('/api/auth/session', { method: 'DELETE' }).catch(() => {});
        router.push('/sign-in');
        router.refresh();
      }}
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
