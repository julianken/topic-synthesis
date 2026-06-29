'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { GeneratingView } from './generating-view';
import type { StepEvent } from './stage-rail';
import type { CodeProgress, ResearchEvent } from '../../../store/repo'; // concept-drift-ok: code identifier, deferred rename (ADR-0003)

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
  const [codeProgress, setCodeProgress] = useState<CodeProgress | null>(null);
  const attempts = useRef(0);

  useEffect(() => {
    let active = true;
    // Guards (issue #162 B2): `inFlight` serializes requests — if a response is slower than POLL_MS, the
    // next interval tick is SKIPPED rather than firing a second overlapping request, and a skipped tick
    // never increments `attempts` (no double-count). `active` ignores any in-flight response after unmount.
    let inFlight = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const poll = async (): Promise<void> => {
      if (!active || inFlight) return;
      inFlight = true;
      try {
        attempts.current += 1;
        if (attempts.current > MAX_ATTEMPTS) {
          if (timer) clearInterval(timer);
          if (active) setStalled(true);
          return;
        }
        const res = await fetch(`/api/lesson/${encodeURIComponent(id)}/status`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const body = (await res.json()) as {
          ready?: boolean;
          steps?: StepEvent[];
          research?: ResearchEvent[];
          code?: CodeProgress | null;
        };
        if (!active) return;
        if (body.steps) setSteps(body.steps);
        if (body.research) setResearch(body.research);
        // The live code-phase progress (PR-4 / #180): null until the code stream emits / once pruned. The
        // view itself only RENDERS the bar while the `code` rail stage is running, so a stale value is inert.
        setCodeProgress(body.code ?? null);
        if (body.ready) {
          if (timer) clearInterval(timer);
          router.refresh();
        }
      } catch {
        // transient network error — keep polling
      } finally {
        inFlight = false;
      }
    };

    // B1 (issue #162): fire the FIRST poll IMMEDIATELY on mount — so the dispatch marker / first steps
    // surface within ~100ms instead of after a full POLL_MS of blank "Generating…". Then poll on the
    // interval as before; the `inFlight` guard keeps the immediate poll and the first tick from overlapping.
    void poll();
    timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [id, router]);

  return <GeneratingView steps={steps} research={research} codeProgress={codeProgress} stalled={stalled} />;
}
