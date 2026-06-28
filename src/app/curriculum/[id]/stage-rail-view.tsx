'use client';

import { type CSSProperties, useEffect, useState } from 'react';
import {
  deriveRail,
  formatDuration,
  STAGE_RAIL,
  type RailStage,
  type StepEvent,
} from './stage-rail'; // concept-drift-ok: route identifier, deferred rename (ADR-0003)

/**
 * The SHARED generating view (Figma frame 1:2) — the ONE stage-rail design used by BOTH the
 * `/curriculum/[id]` generating route (`generating.tsx`) AND the library `/` in-place generating shell
 * (`library-create.tsx`'s submit handoff). Factored here so the two surfaces can NEVER diverge: the rail
 * markup, the per-stage states, the live timer, the column strip, the pipeline-progress ledger, and the
 * legend all live in this one module, and each surface passes only its own framing (the topic header copy
 * + the `specimen-topic` view-transition-name on the in-place shell).
 *
 * BEHAVIOR is unchanged from the issue-#61 / TS-23 poller: it renders `deriveRail(steps)` — the SAME
 * owner-scoped `steps` the status poll already returns — onto the FIXED six-stage rail
 * (`plan · research · brief · spec · code · critic`, NO graph; see `stage-rail.ts`). Nothing here reads or
 * fabricates research findings / graph-question content (which are NOT on the live data path — surfacing
 * them would be a UX lie and concept drift); the view shows only the real per-stage timing the engine
 * records. The poll loop + the owner-scoped status contract stay in the calling surfaces, verbatim.
 *
 * VISUAL is the Figma 1:2 frame, expressed in §0 tokens via `var(--token)` (Inter/JetBrains-Mono chrome,
 * the radial app-bg + frosted surfaces, the pipeline green `--pipeline`, the brand cyan `--accent`):
 *   - a generating HEADER bar (wordmark + the static "plan → critic" sub-line · the live current-stage
 *     status on the right);
 *   - the six-column STAGE STRIP (`PLAN … CRITIC`, `01..06`, each with a state-bar underline);
 *   - the TOPIC HEADER (eyebrow · topic · meta — the topic is the `specimen-topic` morph destination);
 *   - the PIPELINE-PROGRESS ledger (inline step pills with timing + the live-timer note);
 *   - the LEGEND (solid/dashed/dotted = ran / in progress / pending).
 */

const TICK_MS = 250; // how often the live in-progress timer re-renders

/** The per-state affordance glyph + screen-reader word, so state reads by ICON + TEXT, never color alone
 *  (DESIGN.md §Accessibility). The glyph is aria-hidden; the word is the accessible state name. */
const RAIL_AFFORDANCE: Record<RailStage['state'], { icon: string; word: string }> = {
  pending: { icon: '○', word: 'Pending' },
  running: { icon: '◐', word: 'In progress' },
  done: { icon: '✓', word: 'Done' },
  error: { icon: '✗', word: 'Failed' },
};

/** The right-of-header status sub-line per the running stage's identity. Mirrors the Figma 1:2 header's
 *  "Researching" + "web-grounded · extracting claims" — a short user-facing gloss of what each stage does
 *  while it runs. Pure copy keyed on the engine stage `name`; no internal/dev terms. */
const STAGE_GLOSS: Record<string, string> = {
  plan: 'decomposing the topic',
  research: 'web-grounded · gathering sources',
  brief: 'shaping the lesson goal',
  spec: 'laying out the lesson',
  code: 'building the interactive page',
  critic: 'reviewing for quality',
};

export interface GeneratingViewProps {
  /** The lesson topic (the morph anchor + the big title). */
  topic: string;
  /** The subject eyebrow above the topic (e.g. "LESSON"); kept neutral pre-persist (no category yet). */
  eyebrow: string;
  /** The meta line under the topic (e.g. "intermediate · depth 1 · building one lesson"). */
  meta: string;
  /** The latest poll's owner-scoped step events (drives the whole rail). */
  steps: StepEvent[];
  /** Whether the poll has stalled (surfaces the "still working" hint). */
  stalled: boolean;
  /** The `view-transition-name` for the topic text (the in-place shell passes `specimen-topic`). */
  topicVtName?: string;
}

/**
 * The full generating frame. `role="status"`/`aria-live="polite"` so the live progress is announced; the
 * fixed six-stage rail is rendered up front (every position from `pending`) so the view reads "step N of 6"
 * from the first paint, before any step lands.
 */
export function GeneratingView({
  topic,
  eyebrow,
  meta,
  steps,
  stalled,
  topicVtName,
}: GeneratingViewProps) {
  const rail = deriveRail(steps);
  const running = rail.find((s) => s.state === 'running');
  const headStatus = running ? STAGE_RAIL.find((s) => s.name === running.name) : undefined;

  return (
    <div className="generating-frame" role="status" aria-live="polite">
      {/* HEADER (Figma 1:2 node 1:81): the pipeline context line on the left + the live current-stage
          status on the right. The Figma frame's wordmark is the global `.appbar` chrome here (layout.tsx's
          SessionNav), so this bar carries only the pipeline label, not a second wordmark. The current
          stage reads from the rail's running position. */}
      <header className="genhead">
        <p className="genhead__sub">This lesson&rsquo;s generation pipeline · plan → critic</p>
        <div className="genhead__status">
          <p className="genhead__stage">{headStatus ? headStatus.label : 'Starting'}</p>
          <p className="genhead__gloss">
            {running ? (STAGE_GLOSS[running.name] ?? 'working') : 'preparing the run'}
          </p>
        </div>
      </header>

      {/* STAGE STRIP (Figma 1:2 node 1:5): the six stages as labeled columns with a number + a state-bar
          underline. The strip is the at-a-glance "where am I" rail; the per-stage timing lives in the
          pipeline-progress ledger below. */}
      <ol className="stagestrip" aria-label={`Generation progress — ${STAGE_RAIL.length} stages`}>
        {rail.map((stage, i) => (
          <li
            key={stage.name}
            className={`stagestrip__col stagestrip__col--${stage.state}`}
            style={{ '--rail-i': i } as CSSProperties}
          >
            <span className="stagestrip__name">{stage.label}</span>
            <span className="stagestrip__num">{String(i + 1).padStart(2, '0')}</span>
            <span className="stagestrip__bar" aria-hidden="true" />
            {/* The accessible state word, so a screen reader hears the state, not just the bar style. */}
            <span className="rail__state-sr"> · {RAIL_AFFORDANCE[stage.state].word}</span>
          </li>
        ))}
      </ol>

      {/* TOPIC HEADER (Figma 1:2 node 63:2): the subject eyebrow, the big topic title (the `specimen-topic`
          morph destination — colored --interactive), and the settings meta line. The topic may be empty on
          a cold deep-link to the generating route (the topic only persists with the run), in which case the
          title reads a neutral "Building your lesson"; the in-place shell always carries the typed topic. */}
      <div className="gentopic">
        <p className="gentopic__eyebrow">{eyebrow}</p>
        <h1 className="gentopic__title">
          Generating{' '}
          {topic ? (
            <span
              className="gentopic__topic"
              style={topicVtName ? ({ viewTransitionName: topicVtName } as CSSProperties) : undefined}
            >
              {topic}
            </span>
          ) : (
            <span className="gentopic__topic">your lesson</span>
          )}
          …
        </h1>
        <p className="gentopic__meta">{meta}</p>
      </div>

      {/* PIPELINE PROGRESS ledger (Figma 1:2 node 65:33): each of the six stages inline as a step pill with
          its state affordance (icon + text, never color alone) and its timing — pending → none; running →
          the live ticking timer; done → the frozen duration; error → · failed. The live-timer note below
          mirrors the Figma "research · 11.4s and counting" fine-print. */}
      <section className="genprogress">
        <p className="genprogress__head">Pipeline progress</p>
        <ol className="genprogress__steps">
          {rail.map((stage, i) => (
            <ProgressStep key={stage.name} stage={stage} index={i} last={i === rail.length - 1} />
          ))}
        </ol>
        <p className="genprogress__note">
          {stalled
            ? 'Still working — this is taking longer than usual. Leave this open, or check back soon.'
            : running && running.event
              ? `${runningStageLabel(running)} · running — the live timer ticks until the step lands`
              : 'Working through the pipeline…'}
        </p>
      </section>

      {/* LEGEND (Figma 1:2 node 1:62): the state-bar vocabulary, so the strip's bar styles are decoded by
          TEXT. The dash glyph is aria-hidden; the words carry the meaning. */}
      <ul className="genlegend" aria-label="State legend">
        <li className="genlegend__item genlegend__item--done">
          <span className="genlegend__mark" aria-hidden="true" />
          <span>
            <strong>solid</strong> — ran
          </span>
        </li>
        <li className="genlegend__item genlegend__item--running">
          <span className="genlegend__mark" aria-hidden="true" />
          <span>
            <strong>dashed</strong> — in progress
          </span>
        </li>
        <li className="genlegend__item genlegend__item--pending">
          <span className="genlegend__mark" aria-hidden="true" />
          <span>
            <strong>dotted</strong> — pending
          </span>
        </li>
      </ul>
    </div>
  );
}

/** The running stage's human label, for the live-timer note. */
function runningStageLabel(stage: RailStage): string {
  return STAGE_RAIL.find((s) => s.name === stage.name)?.label ?? stage.label;
}

/**
 * One pipeline-progress step pill: a state affordance (icon + screen-reader word), the stage label, and
 * its timing, with a `·` separator after every step but the last (the Figma ledger's interpunct). State is
 * conveyed by ICON + TEXT, not color alone (DESIGN.md §Accessibility).
 */
function ProgressStep({
  stage,
  index,
  last,
}: {
  stage: RailStage;
  index: number;
  last: boolean;
}) {
  const { icon, word } = RAIL_AFFORDANCE[stage.state];
  const running = stage.state === 'running';
  const errored = stage.state === 'error';
  return (
    // `--rail-i` drives the catalog's token-driven staggered reveal in globals.css (delay =
    // index × --dur-fast); under prefers-reduced-motion the global reset zeroes it (DESIGN.md §Motion).
    <li
      className={`genstep genstep--${stage.state}`}
      style={{ '--rail-i': index } as CSSProperties}
    >
      <span className="genstep__label">
        {stage.label.toLowerCase()}
        {/* The accessible state name (visually hidden) so a screen reader hears the state, not the icon. */}
        <span className="rail__state-sr"> · {word}</span>
      </span>
      <span className="genstep__time">
        {running && stage.event ? (
          <LiveTimer startedAt={stage.event.startedAt} />
        ) : (
          <FrozenTime event={stage.event} />
        )}
      </span>
      <span className="genstep__icon" aria-hidden="true">
        {icon}
      </span>
      {errored && (
        <span className="genstep__tag" aria-hidden="true">
          {' '}
          · failed
        </span>
      )}
      {!last && (
        <span className="genstep__sep" aria-hidden="true">
          ·
        </span>
      )}
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
 * A non-running stage's timing readout: a pending stage (no event) shows an em-dash placeholder so the
 * ledger reads as a full six-step list (matching the Figma `brief — · spec —` pending pills); a finished
 * stage shows its frozen `finished_at − started_at`; an errored stage that timed an end shows that partial
 * duration, else an em-dash.
 */
function FrozenTime({ event }: { event: StepEvent | null }) {
  if (event === null) return <>—</>; // pending — the Figma ledger shows a `—` placeholder for not-yet-run.
  if (event.finishedAt === null) return <>—</>;
  const ms = new Date(event.finishedAt).getTime() - new Date(event.startedAt).getTime();
  return <>{formatDuration(ms)}</>;
}
