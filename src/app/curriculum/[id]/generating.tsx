'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

const POLL_MS = 2500;
const MAX_ATTEMPTS = 160; // ~6-7 min, then stop polling and surface a hint

/**
 * Polls the curriculum status while a run is in flight. When the row lands it calls
 * router.refresh(), which re-runs the hub server component — now getCurriculum returns the
 * curriculum and the hub renders. After MAX_ATTEMPTS it stops and shows a "still working" hint
 * (covers both a slow run and a bad id, without polling forever).
 */
export function GeneratingPoller({ id }: { id: string }) {
  const router = useRouter();
  const [stalled, setStalled] = useState(false);
  const attempts = useRef(0);

  useEffect(() => {
    let active = true;
    const timer = setInterval(async () => {
      attempts.current += 1;
      if (attempts.current > MAX_ATTEMPTS) {
        clearInterval(timer);
        if (active) setStalled(true);
        return;
      }
      try {
        const res = await fetch(`/api/curriculum/${encodeURIComponent(id)}/status`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const body = (await res.json()) as { ready?: boolean };
        if (body.ready && active) {
          clearInterval(timer);
          router.refresh();
        }
      } catch {
        // transient network error — keep polling
      }
    }, POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [id, router]);

  return (
    <div className="generating" role="status" aria-live="polite">
      <span className="generating__spinner" aria-hidden="true" />
      <span>
        {stalled
          ? 'Still working — this is taking longer than usual. Leave this open, or check back soon.'
          : 'Working…'}
      </span>
    </div>
  );
}
