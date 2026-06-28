'use client';

import { type CSSProperties, useEffect, useState } from 'react';
import {
  buildLedger,
  buildResearchGraph,
  type GraphNode,
  type GraphNodeState,
  type LedgerFinding,
} from './research-graph';
import { deriveRail, formatDuration, type RailStage, type StepEvent } from './stage-rail';
import { SPECIMEN_TOPIC_NAME } from '../../library-morph';
import type { ResearchEvent } from '../../../store/repo'; // concept-drift-ok: code identifier, deferred rename (ADR-0003)

const TICK_MS = 250; // how often the live in-progress timer re-renders

/**
 * The SHARED live-research GENERATING view (the B view — Figma frame `1:2`). ONE component for BOTH the
 * reader route's generating state (`/curriculum/[id]`, when the run is in flight) and the create-form's
 * in-place generating shell (`/`), so the two never diverge. It is PRESENTATIONAL — it takes the status
 * poll's owner-scoped `steps` (the per-stage timeline) + `research` (the live-research feed, Stage 1 /
 * #153) + a `stalled` flag, and renders:
 *
 *   1. A "Generating <topic>…" HEADER — the topic in `--interactive`. `topic` is optional: the create-
 *      form path passes the typed topic (it morphs in via the `specimen-topic` shared element); the
 *      reader-route refresh path has no topic pre-persist (the run isn't persisted, `run_owner` carries
 *      no topic — not the pipeline's to surface here), so it degrades to a bare "Generating…".
 *   2. The research NODE-GRAPH — the plan→questions→brief DAG (`research-graph.ts`), nodes lighting as
 *      each question extracts, curved SVG edges. Empty feed ⇒ the honest plan→brief spine.
 *   3. The LIVE RESEARCH PANEL — "LIVE RESEARCH · N/M extracted" + the grounded findings + source hosts.
 *   4. The fixed six-stage RAIL + spinner (the TS-23 ledger, retained) — "step N of 6" + per-stage timing.
 *
 * REAL DATA ONLY: every node/finding/source is derived from the feed the run emitted (the pure
 * `research-graph.ts` core); nothing is fabricated. Motion is the §0 catalog ONLY (the `rail-reveal`
 * stagger, the `--tr-*` primitives) and is reduced-motion-gated by the global rule in `globals.css`.
 * This component never touches the opaque-origin lesson iframe or its trust boundary.
 */
export function GeneratingView({
  topic,
  steps,
  research,
  stalled,
}: {
  topic?: string;
  steps: StepEvent[];
  research: ResearchEvent[];
  stalled: boolean;
}) {
  const rail = deriveRail(steps);
  const planStage = rail.find((s) => s.name === 'plan');
  const briefStage = rail.find((s) => s.name === 'brief');
  const graph = buildResearchGraph(research, planStage, briefStage);
  const ledger = buildLedger(research);

  return (
    <section className="genb" role="status" aria-live="polite">
      <header className="genb__head">
        <p className="eyebrow">Lesson</p>
        <h1 className="genb__title">
          Generating
          {topic ? (
            <>
              {' '}
              <span
                className="genb__topic"
                style={{ viewTransitionName: SPECIMEN_TOPIC_NAME } as CSSProperties}
              >
                {topic}
              </span>
            </>
          ) : null}
          …
        </h1>
        <p className="lead">Researching and building your lesson. This usually takes a minute or two.</p>
      </header>

      <div className="genb__body">
        <ResearchGraphView graph={graph} />
        <LiveResearchPanel
          extracted={ledger.extracted}
          total={ledger.total}
          findings={ledger.findings}
        />
      </div>

      <PipelineRail rail={rail} stalled={stalled} />
    </section>
  );
}

// ── Node-graph ───────────────────────────────────────────────────────────────────────────────────────

/** The per-state node glyph + screen-reader word — so a node reads by ICON + TEXT + border style, never
 *  color alone (DESIGN.md §Accessibility). The glyph is aria-hidden; the word is the accessible state. */
const NODE_AFFORDANCE: Record<GraphNodeState, { icon: string; word: string }> = {
  pending: { icon: '○', word: 'pending' },
  running: { icon: '⟳', word: 'in progress' },
  done: { icon: '✓', word: 'ran' },
  error: { icon: '✗', word: 'skipped' },
};

/**
 * The research DAG, rendered as a three-column flow (plan · research fan-out · brief) over an SVG edge
 * layer of curved (quadratic-bézier) connectors — matching the Figma `1:2` graph overlay. The columns
 * are a CSS grid so the layout reflows to a single column on mobile (the SVG edges hide there — a graph
 * of stacked nodes needs no crossing connectors, and the per-node state still tells the whole story).
 *
 * The edges are drawn in a `viewBox`-relative coordinate space (0..100 × 0..100) so they scale with the
 * grid without measuring the DOM — the plan node anchors mid-left, the research nodes fan down the
 * middle, the brief anchors mid-right; each rᵢ gets a curve from plan and a curve to brief. A settled
 * edge (source ran) is drawn in `--pipeline`; a pending one stays faint. Under reduced motion nothing
 * animates (the global rule zeroes the node reveal); the SVG is decorative (`aria-hidden`) — the node
 * list carries the accessible content.
 */
function ResearchGraphView({ graph }: { graph: ReturnType<typeof buildResearchGraph> }) {
  const n = graph.research.length;
  // Vertical center for each research row in the 0..100 viewBox (evenly spaced; single node centers).
  const rowY = (i: number): number => (n <= 1 ? 50 : 8 + (i * 84) / (n - 1));
  const PLAN_X = 16;
  const PLAN_Y = 50;
  const R_X = 50;
  const BRIEF_X = 84;
  const BRIEF_Y = 50;

  return (
    <div className="genb__graph">
      {n > 0 && (
        <svg
          className="genb__edges"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {graph.research.map((r, i) => {
            const y = rowY(i);
            // plan → rᵢ : control point pulled toward the middle for a smooth S.
            const planPath = `M ${String(PLAN_X)} ${String(PLAN_Y)} C ${String((PLAN_X + R_X) / 2)} ${String(PLAN_Y)}, ${String((PLAN_X + R_X) / 2)} ${String(y)}, ${String(R_X)} ${String(y)}`;
            const briefPath = `M ${String(R_X)} ${String(y)} C ${String((R_X + BRIEF_X) / 2)} ${String(y)}, ${String((R_X + BRIEF_X) / 2)} ${String(BRIEF_Y)}, ${String(BRIEF_X)} ${String(BRIEF_Y)}`;
            const planActive = graph.plan.state === 'done';
            const briefActive = r.state === 'done';
            return (
              <g key={r.id}>
                <path
                  className={`genb__edge${planActive ? ' genb__edge--active' : ''}`}
                  d={planPath}
                />
                <path
                  className={`genb__edge${briefActive ? ' genb__edge--active' : ''}`}
                  d={briefPath}
                />
              </g>
            );
          })}
        </svg>
      )}

      <div className="genb__cols">
        <div className="genb__col genb__col--plan">
          <GraphNodeCard node={graph.plan} />
        </div>
        <ul className="genb__col genb__col--research" aria-label="Research questions">
          {graph.research.length > 0 ? (
            graph.research.map((node) => (
              <li key={node.id}>
                <GraphNodeCard node={node} />
              </li>
            ))
          ) : (
            <li className="genb__col-empty">Planning research questions…</li>
          )}
        </ul>
        <div className="genb__col genb__col--brief">
          <GraphNodeCard node={graph.brief} />
        </div>
      </div>
    </div>
  );
}

/** One graph node card: a state affordance (icon + visually-hidden state word), the kind eyebrow, the
 *  node's title line, and its status sub-line. State is icon + text + border style, never color alone. */
function GraphNodeCard({ node }: { node: GraphNode }) {
  const { icon, word } = NODE_AFFORDANCE[node.state];
  return (
    <article className={`gnode gnode--${node.state} gnode--${node.kind}`}>
      <p className="gnode__eyebrow">
        <span className="gnode__icon" aria-hidden="true">
          {icon}
        </span>{' '}
        {node.eyebrow}
        <span className="genb__sr"> · {word}</span>
      </p>
      <p className="gnode__title">{node.title}</p>
      <p className="gnode__detail">{node.detail}</p>
    </article>
  );
}

// ── Live-research panel ────────────────────────────────────────────────────────────────────────────────

/**
 * The LIVE RESEARCH ledger panel (Figma `1:2` node `65:2`): a header — a pulse dot + "LIVE RESEARCH" + an
 * "N / M extracted" count — over the flattened grounded findings list. Each finding is a claim (a ✓ once
 * its question landed, a ⟳ while still extracting) + an em-dash source HOST (copy-safe — `research-
 * graph.ts` reduces the URL to its bare host). When the feed is empty the panel shows the count at 0 / 0
 * and an honest "Findings will appear here as research lands." placeholder — never a fabricated finding.
 */
function LiveResearchPanel({
  extracted,
  total,
  findings,
}: {
  extracted: number;
  total: number;
  findings: LedgerFinding[];
}) {
  return (
    <aside className="ledger" aria-label="Live research findings">
      <div className="ledger__head">
        <span className="ledger__pulse" aria-hidden="true" />
        <span className="ledger__title">LIVE RESEARCH</span>
        <span className="ledger__count">
          {String(extracted)} / {String(total)} extracted
        </span>
      </div>
      {findings.length > 0 ? (
        <ul className="ledger__list">
          {findings.map((f, i) => (
            <li
              className={`ledger__item${f.extracting ? ' ledger__item--extracting' : ''}`}
              key={f.key}
              style={{ '--rail-i': i } as CSSProperties}
            >
              <p className="ledger__claim">
                <span className="ledger__mark" aria-hidden="true">
                  {f.extracting ? '⟳' : '✓'}
                </span>{' '}
                {f.claim}
              </p>
              {f.host ? (
                <p className="ledger__source">
                  <span aria-hidden="true">— </span>
                  {f.extracting ? `extracting from ${f.host} …` : f.host}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="ledger__empty">Findings will appear here as research lands.</p>
      )}
    </aside>
  );
}

// ── Pipeline rail (the retained TS-23 six-stage ledger) ──────────────────────────────────────────────────

/** The per-state rail affordance glyph + screen-reader word (state by icon + text, never color alone). */
const RAIL_AFFORDANCE: Record<RailStage['state'], { icon: string; word: string }> = {
  pending: { icon: '○', word: 'Pending' },
  running: { icon: '◐', word: 'In progress' },
  done: { icon: '✓', word: 'Done' },
  error: { icon: '✗', word: 'Failed' },
};

/** The fixed six-stage rail + spinner under the graph — the run's pipeline position (plan → critic). */
function PipelineRail({ rail, stalled }: { rail: RailStage[]; stalled: boolean }) {
  return (
    <div className="genb__rail-wrap">
      <p className="genb__rail-label">PIPELINE PROGRESS</p>
      <ol className="rail" aria-label={`Generation progress — ${String(rail.length)} stages`}>
        {rail.map((stage, i) => (
          <RailStageRow key={stage.name} stage={stage} index={i} />
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

/** One rail row — a state affordance (icon + screen-reader word), the stage label, and its timing. */
function RailStageRow({ stage, index }: { stage: RailStage; index: number }) {
  const { icon, word } = RAIL_AFFORDANCE[stage.state];
  const running = stage.state === 'running';
  const errored = stage.state === 'error';
  return (
    <li
      className={`rail__stage rail__stage--${stage.state}`}
      style={{ '--rail-i': index } as CSSProperties}
    >
      <span className="rail__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="rail__label">
        {stage.label}
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

/** A non-running stage's timing readout: pending ⇒ nothing; finished ⇒ frozen duration; errored-with-end
 *  ⇒ that partial duration, else an em-dash. */
function FrozenTime({ event }: { event: StepEvent | null }) {
  if (event === null) return null;
  if (event.finishedAt === null) return <>—</>;
  const ms = new Date(event.finishedAt).getTime() - new Date(event.startedAt).getTime();
  return <>{formatDuration(ms)}</>;
}
