'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { GeneratingView } from './stage-rail-view';
import { type StepEvent } from './stage-rail';

const POLL_MS = 2500;
const MAX_ATTEMPTS = 160; // ~6-7 min, then stop polling and surface a hint

/**
 * Polls the lesson's status while a run is in flight and renders the live generating view (Figma 1:2) via
 * the SHARED {@link GeneratingView} — the SAME stage-rail design the library `/` in-place generating shell
 * (`library-create.tsx`) uses, so the two surfaces can never diverge.
 *
 * BEHAVIOR is unchanged (issue #61 / TS-23): it drives the view from the SAME owner-scoped `steps` the
 * status poll already returns — no new data path, no durable store, no deploy-topology change. The view
 * folds those steps onto the FIXED six-stage rail (`plan → research → brief → spec → code → critic`, NO
 * graph). When the lesson row lands (`ready`) it calls `router.refresh()`, re-running the server component
 * so the lesson renders. After MAX_ATTEMPTS it stops and surfaces a "still working" hint (covers a slow
 * run and a bad id, without polling forever). The poll loop + the owner-scoped status contract are verbatim.
 */
export function GeneratingPoller({
  topic,
  eyebrow,
  meta,
  id,
}: {
  topic: string;
  eyebrow: string;
  meta: string;
  id: string;
}) {
  const router = useRouter();
  const [stalled, setStalled] = useState(false);
  const [steps, setSteps] = useState<StepEvent[]>([]);
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
        const res = await fetch(`/api/curriculum/${encodeURIComponent(id)}/status`, { // concept-drift-ok: route identifier, deferred rename (ADR-0003)
          cache: 'no-store',
        });
        if (!res.ok) return;
        const body = (await res.json()) as { ready?: boolean; steps?: StepEvent[] };
        if (!active) return;
        if (body.steps) setSteps(body.steps);
        if (body.ready) {
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

  return <GeneratingView topic={topic} eyebrow={eyebrow} meta={meta} steps={steps} stalled={stalled} />;
}
