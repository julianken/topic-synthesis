'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  STAGE_RAIL,
  deriveRail,
  formatDuration,
  type RailStage,
  type StepEvent,
} from './stage-rail';

const POLL_MS = 2500;
const MAX_ATTEMPTS = 160; // ~6-7 min, then stop polling and surface a hint
const TICK_MS = 250; // how often the live in-progress timer re-renders

/** The per-state affordance glyph + screen-reader word, so state reads by ICON + TEXT, never color alone
 *  (DESIGN.md §Accessibility). The glyph is aria-hidden; the word is the accessible state name. */
const RAIL_AFFORDANCE: Record<RailStage['state'], { icon: string; word: string }> = {
  pending: { icon: '○', word: 'Pending' },
  running: { icon: '◐', word: 'In progress' },
  done: { icon: '✓', word: 'Done' },
  error: { icon: '✗', word: 'Failed' },
};

/**
 * Polls the lesson's status while a run is in flight and renders the live generating view as a FIXED
 * six-stage RAIL with a per-stage ledger (TS-23), driven by the SAME owner-scoped `steps` the status
 * poll already returns (issue #61) — no new data path, no durable store, no deploy-topology change (R8).
 *
 * The rail shows ALL SIX live single-lesson stages (`plan → research → brief → spec → code → critic`,
 * NO graph — see `stage-rail.ts`) up front: a not-yet-started stage is `pending` (no timer); the one
 * in-flight stage shows a LIVE elapsed timer (now − startedAt) that freezes into a duration once the
 * next poll reports it finished; a finished stage shows its frozen `finished_at − started_at`; a failed
 * stage is labeled `· failed`. When the lesson row lands (`ready`) it calls `router.refresh()`,
 * re-running the server component so the lesson renders. After MAX_ATTEMPTS it stops and shows a "still
 * working" hint (covers a slow run and a bad id, without polling forever).
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

  // Fold the poll's steps onto the fixed six-stage rail (pure — stage-rail.ts). The rail is ALWAYS the
  // full six positions, so the view shows "where am I in plan → … → critic" from the first paint, even
  // before any step lands (every position pending), not a list that grows one row at a time.
  const rail = deriveRail(steps);

  return (
    <div role="status" aria-live="polite">
      <ol className="rail" aria-label={`Generation progress — ${STAGE_RAIL.length} stages`}>
        {rail.map((stage) => (
          <RailStageRow key={stage.name} stage={stage} />
        ))}
      </ol>
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

/**
 * One rail row (the per-stage ledger entry): a state affordance (icon + screen-reader word), the stage
 * label, and the stage's timing. State is conveyed by ICON + TEXT, not color alone (DESIGN.md
 * §Accessibility) — pending → no time; running → the live ticking timer; done → the frozen duration;
 * error → the `· failed` tag (and a partial duration if it timed an end before failing).
 */
function RailStageRow({ stage }: { stage: RailStage }) {
  const { icon, word } = RAIL_AFFORDANCE[stage.state];
  const running = stage.state === 'running';
  const errored = stage.state === 'error';
  return (
    <li className={`rail__stage rail__stage--${stage.state}`}>
      <span className="rail__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="rail__label">
        {stage.label}
        {/* The accessible state name (visually hidden) so a screen reader hears the state, not just the icon. */}
        <span className="rail__state-sr"> · {word}</span>
        {errored && (
          <span className="rail__tag" aria-hidden="true">
            {' '}
            · failed
          </span>
        )}
      </span>
      <span className="rail__time">
        {running && stage.event ? (
          <LiveTimer startedAt={stage.event.startedAt} />
        ) : (
          <FrozenTime event={stage.event} />
        )}
      </span>
    </li>
  );
}

/** A live elapsed timer for the in-progress stage: re-renders every TICK_MS off the wall clock. */
function LiveTimer({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, []);
  return <>{formatDuration(now - new Date(startedAt).getTime())}</>;
}

/**
 * A non-running stage's timing readout: a pending stage (no event) shows nothing; a finished stage shows
 * its frozen `finished_at − started_at`; an errored stage that timed an end shows that partial duration,
 * else an em-dash.
 */
function FrozenTime({ event }: { event: StepEvent | null }) {
  if (event === null) return null; // pending — no timer, no duration (the rail position is just listed).
  if (event.finishedAt === null) return <>—</>;
  const ms = new Date(event.finishedAt).getTime() - new Date(event.startedAt).getTime();
  return <>{formatDuration(ms)}</>;
}
