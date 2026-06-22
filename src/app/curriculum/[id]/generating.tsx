'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

const POLL_MS = 2500;
const MAX_ATTEMPTS = 160; // ~6-7 min, then stop polling and surface a hint
const TICK_MS = 250; // how often the live in-progress timer re-renders

/** One step's timing, as the status poll returns it (mirrors repo.ts StepEvent). */
interface StepEvent {
  name: string;
  stepKey: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
}

/** Human label per pipeline step name (the engine's `name` arg). Unknown names fall back to the raw name. */
const STEP_LABEL: Record<string, string> = {
  plan: 'Planning',
  research: 'Researching',
  brief: 'Briefing',
  spec: 'Designing',
  code: 'Building',
  critic: 'Reviewing',
};

/** Format a millisecond span as a compact duration, e.g. 820ms → "0.8s", 3210ms → "3.2s". */
function formatDuration(ms: number): string {
  if (ms < 0) return '0.0s';
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Polls the curriculum status while a run is in flight, and renders the live per-step timeline from
 * the poll's `steps` (issue #61). Finished steps show their final `finished_at − started_at`; the
 * one in-progress step (`finishedAt` null, status 'running') shows a LIVE elapsed timer that ticks
 * client-side (now − startedAt) and freezes into a duration once the next poll reports it finished;
 * an 'error' step is labeled. When the curriculum row lands (`ready`) it calls router.refresh(),
 * re-running the lesson server component so the lesson renders. After MAX_ATTEMPTS it stops and shows
 * a "still working" hint (covers a slow run and a bad id, without polling forever).
 */
export function GeneratingPoller({ id }: { id: string }) {
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
        const res = await fetch(`/api/curriculum/${encodeURIComponent(id)}/status`, {
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

  return (
    <div role="status" aria-live="polite">
      {steps.length > 0 && (
        <ol className="timeline">
          {steps.map((step) => (
            <TimelineStep key={`${step.name}:${step.stepKey}`} step={step} />
          ))}
        </ol>
      )}
      <div className="generating">
        <span className="generating__spinner" aria-hidden="true" />
        <span>
          {stalled
            ? 'Still working — this is taking longer than usual. Leave this open, or check back soon.'
            : 'Working…'}
        </span>
      </div>
    </div>
  );
}

/** A single timeline row: the step label + its time (live for a running step, frozen once finished). */
function TimelineStep({ step }: { step: StepEvent }) {
  const label = STEP_LABEL[step.name] ?? step.name;
  const running = step.finishedAt === null && step.status === 'running';
  const errored = step.status === 'error';
  return (
    <li className={`timeline__step timeline__step--${errored ? 'error' : running ? 'running' : 'done'}`}>
      <span className="timeline__label">
        {label}
        {errored && <span className="timeline__tag"> · failed</span>}
      </span>
      <span className="timeline__time">
        {running ? <LiveTimer startedAt={step.startedAt} /> : <FrozenTime step={step} />}
      </span>
    </li>
  );
}

/** A live elapsed timer for the in-progress step: re-renders every TICK_MS off the wall clock. */
function LiveTimer({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, []);
  return <>{formatDuration(now - new Date(startedAt).getTime())}</>;
}

/** A finished (or errored-after-some-work) step's frozen duration; em-dash if it never timed an end. */
function FrozenTime({ step }: { step: StepEvent }) {
  if (step.finishedAt === null) return <>—</>;
  const ms = new Date(step.finishedAt).getTime() - new Date(step.startedAt).getTime();
  return <>{formatDuration(ms)}</>;
}
