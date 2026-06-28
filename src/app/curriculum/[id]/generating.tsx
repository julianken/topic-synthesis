'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { GeneratingView } from './generating-view';
import type { StepEvent } from './stage-rail';
import type { ResearchEvent } from '../../../store/repo'; // concept-drift-ok: code identifier, deferred rename (ADR-0003)

const POLL_MS = 2500;
const MAX_ATTEMPTS = 160; // ~6-7 min, then stop polling and surface a hint

/**
 * Polls the lesson's status while a run is in flight and renders the SHARED live-research generating view
 * (the B view — {@link GeneratingView}, Figma `1:2`): the research node-graph + the LIVE RESEARCH panel +
 * the fixed six-stage rail. Driven by the EXISTING owner-scoped status poll, now reading THREE fields —
 * `steps` (the per-stage timeline, issue #61), `research` (the live-research feed, Stage 1 / #153), and
 * `ready`. No new data path; the route already serves all three behind one `ownsRun` gate.
 *
 * When the lesson row lands (`ready`) it calls `router.refresh()`, re-running the server component so the
 * lesson renders. After MAX_ATTEMPTS it stops and surfaces a "still working" hint (a slow run / a bad id,
 * without polling forever). This reader-route path has NO topic pre-persist (the run isn't persisted yet),
 * so the header degrades to a bare "Generating…"; the create-form path passes the typed topic.
 */
export function GeneratingPoller({ id }: { id: string }) {
  const router = useRouter();
  const [stalled, setStalled] = useState(false);
  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [research, setResearch] = useState<ResearchEvent[]>([]);
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

  return <GeneratingView steps={steps} research={research} stalled={stalled} />;
}
