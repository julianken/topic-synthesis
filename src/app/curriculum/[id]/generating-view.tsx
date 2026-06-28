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
 * reader route's generating state (`/curriculum/[id]` — concept-drift-ok: route identifier, deferred rename, ADR-0003 — when
 * the run is in flight) and the create-form's
 * in-place generating shell (`/`), so the two never diverge. It is PRESENTATIONAL — it takes the status
 * poll's owner-scoped `steps` (the per-stage timeline) + `research` (the live-research feed, Stage 1 /
 * #153) + a `stalled` flag + the run's settings where they're known, and renders, matching Figma `1:2`:
 *
 *   1. A TOP STAGE STEPPER (`.genb__stepper`) — the six pipeline stages as a row of `NAME / 0N` columns
 *      with an under-bar whose style encodes state (solid ✓ ran · dashed ⟳ in progress · dotted pending).
 *   2. The TOPIC HEADER (`.genb__head`) — an eyebrow (the REAL subject category where known, else omitted),
 *      the topic as the large H1, and a `<level> · depth <n> · building one lesson` settings sub-line where
 *      those values are known. `topic`/`level`/`depth`/`category` are all OPTIONAL: the create-form path
 *      passes the typed topic + settings; the reader-route refresh path has none pre-persist (the run isn't
 *      persisted, `run_owner` carries no settings), so each degrades honestly (bare "Generating…", no
 *      sub-line, no eyebrow) — never a fabricated value. The subject category is classified at the run TAIL
 *      and is NOT in the live poll, so the eyebrow is shown only when a caller can truthfully supply it.
 *   3. The research NODE-GRAPH — the plan→questions→brief DAG (`research-graph.ts`), nodes lighting as
 *      each question extracts, curved SVG edges. Empty feed ⇒ the honest plan→brief spine.
 *   4. The LIVE RESEARCH PANEL — "LIVE RESEARCH · N/M extracted" + the grounded findings + source hosts.
 *   5. The COMPACT HORIZONTAL PROGRESS PILL (`.genb__progress`) — one bordered row of `stage Xs glyph`
 *      segments (`plan 2.1s ✓ · research 11.4s ⟳ · brief — · …`) + a single mono caption line for the
 *      in-progress stage with its LIVE ticking timer. Same real per-step data as the old vertical rail, in
 *      the frame's compact form.
 *   6. The bottom STATE LEGEND (`.genb__legend`) — solid/dashed/dotted = ran/in progress/pending.
 *
 * REAL DATA ONLY: every node/finding/source is derived from the feed the run emitted (the pure
 * `research-graph.ts` core); nothing is fabricated. Motion is the §0 catalog ONLY (the `rail-reveal`
 * stagger, the `--tr-*` primitives) and is reduced-motion-gated by the global rule in `globals.css`.
 * This component never touches the opaque-origin lesson iframe or its trust boundary.
 */
export function GeneratingView({
  topic,
  level,
  depth,
  category,
  steps,
  research,
  stalled,
}: {
  topic?: string;
  /** The run's level (intro/intermediate/advanced), where known — create-form path only. */
  level?: string;
  /** The run's depth (1..5), where known — create-form path only. */
  depth?: number;
  /** The REAL subject category (e.g. BIOLOGY), where truthfully known. Classified at the run TAIL, so it
   *  is NOT in the live poll — omitted (not fabricated) on every live path today. */
  category?: string;
  steps: StepEvent[];
  research: ResearchEvent[];
  stalled: boolean;
}) {
  const rail = deriveRail(steps);
  const planStage = rail.find((s) => s.name === 'plan');
  const briefStage = rail.find((s) => s.name === 'brief');
  const graph = buildResearchGraph(research, planStage, briefStage);
  const ledger = buildLedger(research);

  // The settings sub-line ("<level> · depth <n> · building one lesson"), shown only when the run's level +
  // depth are known to this caller (the create-form path). Mirrors the persisted reader route's meta line.
  const settingsLine =
    level && typeof depth === 'number'
      ? `${level} · depth ${String(depth)} · building one lesson`
      : null;

  return (
    <section className="genb" role="status" aria-live="polite">
      <StageStepper rail={rail} />

      <header className="genb__head">
        {category ? <p className="genb__eyebrow">{category}</p> : null}
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
        {settingsLine ? <p className="genb__settings">{settingsLine}</p> : null}
      </header>

      <div className="genb__body">
        <ResearchGraphView graph={graph} />
        <LiveResearchPanel
          extracted={ledger.extracted}
          total={ledger.total}
          findings={ledger.findings}
        />
      </div>

      <ProgressPill rail={rail} stalled={stalled} />

      <StateLegend />
    </section>
  );
}

// ── Top stage stepper ──────────────────────────────────────────────────────────────────────────────────

/** The state's under-bar style class (solid ✓ ran · dashed ⟳ in progress · dotted pending/failed). The
 *  same border-style language as the graph nodes + the bottom legend, so state reads by style, not color. */
const STEPPER_STATE: Record<RailStage['state'], string> = {
  done: 'genb__step--done',
  running: 'genb__step--running',
  pending: 'genb__step--pending',
  error: 'genb__step--error',
};

/** The accessible state word per stepper/pill state (state by text, never color/glyph alone). */
const STATE_WORD: Record<RailStage['state'], string> = {
  pending: 'pending',
  running: 'in progress',
  done: 'ran',
  error: 'failed',
};

/**
 * The top STAGE STEPPER (Figma `1:2` stage columns 1:7..1:53 + the under-bars 66:2..66:7): the six
 * pipeline stages as a row of `NAME / 0N` columns, each with a thin under-bar whose STYLE encodes state
 * (solid ran · dashed in progress · dotted pending) — state by style + the visually-hidden word, never
 * color alone (§Accessibility). The stage name is the engine `name` uppercased (`PLAN`/`RESEARCH`/…), the
 * ordinal its 1-based position. The row scrolls horizontally on a narrow viewport (it never wraps mid-row).
 */
function StageStepper({ rail }: { rail: RailStage[] }) {
  return (
    <ol className="genb__stepper" aria-label={`Generation progress — ${String(rail.length)} stages`}>
      {rail.map((stage, i) => (
        <li key={stage.name} className={`genb__step ${STEPPER_STATE[stage.state]}`}>
          <span className="genb__step-name">
            {stage.name}
            <span className="genb__sr"> · {STATE_WORD[stage.state]}</span>
          </span>
          <span className="genb__step-ord">{String(i + 1).padStart(2, '0')}</span>
          <span className="genb__step-bar" aria-hidden="true" />
        </li>
      ))}
    </ol>
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

// ── Compact horizontal progress pill (the Figma 1:2 PIPELINE PROGRESS) ────────────────────────────────────

/** The per-state glyph + screen-reader word for the pill (state by icon + text, never color alone). */
const PILL_AFFORDANCE: Record<RailStage['state'], { icon: string; word: string }> = {
  pending: { icon: '—', word: 'pending' },
  running: { icon: '⟳', word: 'in progress' },
  done: { icon: '✓', word: 'done' },
  error: { icon: '✗', word: 'failed' },
};

/**
 * The COMPACT HORIZONTAL PROGRESS PILL (Figma `1:2` node `65:33`): one bordered row of `stage Xs glyph`
 * segments, dot-separated (`plan 2.1s ✓ · research 11.4s ⟳ · brief — · …`), then a single mono caption
 * line naming the in-progress stage with its LIVE ticking timer ("research · 11.4s and counting"). This
 * carries the SAME real per-step data the old vertical six-row rail did — the stage names, durations, the
 * current-stage glyph (✓/⟳/—), and the live ticking timer — in the frame's compact horizontal form.
 */
function ProgressPill({ rail, stalled }: { rail: RailStage[]; stalled: boolean }) {
  const running = rail.find((s) => s.state === 'running');
  return (
    <div className="genb__progress">
      <p className="genb__progress-label">PIPELINE PROGRESS</p>
      <ol className="genb__pill" aria-label={`Generation progress — ${String(rail.length)} stages`}>
        {rail.map((stage, i) => (
          <PillSegment key={stage.name} stage={stage} last={i === rail.length - 1} />
        ))}
      </ol>
      <ProgressCaption running={running ?? null} stalled={stalled} />
    </div>
  );
}

/** One pill segment — the stage name, its timing, and its state glyph — plus the `·` divider after it
 *  (except the last). The running segment shows a LIVE elapsed timer; finished shows the frozen duration;
 *  pending/not-started shows an em-dash. */
function PillSegment({ stage, last }: { stage: RailStage; last: boolean }) {
  const { icon, word } = PILL_AFFORDANCE[stage.state];
  const running = stage.state === 'running';
  return (
    <li className={`genb__seg genb__seg--${stage.state}`}>
      <span className="genb__seg-name">
        {stage.name}
        <span className="genb__sr"> · {word}</span>
      </span>
      <span className="genb__seg-time">
        {running && stage.event ? (
          <LiveTimer startedAt={stage.event.startedAt} />
        ) : (
          <FrozenTime event={stage.event} />
        )}
      </span>
      <span className="genb__seg-glyph" aria-hidden="true">
        {icon}
      </span>
      {!last ? (
        <span className="genb__seg-sep" aria-hidden="true">
          ·
        </span>
      ) : null}
    </li>
  );
}

/** The single caption line under the pill: names the in-progress stage with its live elapsed timer
 *  ("research · 11.4s and counting — live timer ticks until the step lands"); when nothing is in flight
 *  it falls back to a generic "Working…" (or the stalled hint). */
function ProgressCaption({ running, stalled }: { running: RailStage | null; stalled: boolean }) {
  if (stalled) {
    return (
      <p className="genb__caption">
        Still working — this is taking longer than usual. Leave this open, or check back soon.
      </p>
    );
  }
  if (running && running.event) {
    return (
      <p className="genb__caption">
        {running.name} · <LiveTimer startedAt={running.event.startedAt} /> and counting — live timer
        ticks until the step lands
      </p>
    );
  }
  return <p className="genb__caption">Working…</p>;
}

// ── Bottom state legend ──────────────────────────────────────────────────────────────────────────────────

/**
 * The bottom STATE LEGEND (Figma `1:2` node `1:62`): solid — ran · dashed — in progress · dotted —
 * pending, each a short sample bar in the matching border style. It tells the reader how to read the
 * graph nodes + the stepper under-bars by STYLE (the same vocabulary the §Accessibility rule mandates).
 */
function StateLegend() {
  return (
    <dl className="genb__legend" aria-label="State legend">
      <div className="genb__legend-row">
        <span className="genb__legend-bar genb__legend-bar--solid" aria-hidden="true" />
        <dt className="genb__legend-term">solid</dt>
        <dd className="genb__legend-def">— ran</dd>
      </div>
      <div className="genb__legend-row">
        <span className="genb__legend-bar genb__legend-bar--dashed" aria-hidden="true" />
        <dt className="genb__legend-term">dashed</dt>
        <dd className="genb__legend-def">— in progress</dd>
      </div>
      <div className="genb__legend-row">
        <span className="genb__legend-bar genb__legend-bar--dotted" aria-hidden="true" />
        <dt className="genb__legend-term">dotted</dt>
        <dd className="genb__legend-def">— pending</dd>
      </div>
    </dl>
  );
}

// ── Shared timers ────────────────────────────────────────────────────────────────────────────────────────

/** A live elapsed timer for the in-progress stage: re-renders every TICK_MS off the wall clock. */
function LiveTimer({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, []);
  return <>{formatDuration(now - new Date(startedAt).getTime())}</>;
}

/** A non-running stage's timing readout: pending ⇒ an em-dash; finished ⇒ frozen duration; errored-with-
 *  end ⇒ that partial duration, else an em-dash. */
function FrozenTime({ event }: { event: StepEvent | null }) {
  if (event === null) return <>—</>;
  if (event.finishedAt === null) return <>—</>;
  const ms = new Date(event.finishedAt).getTime() - new Date(event.startedAt).getTime();
  return <>{formatDuration(ms)}</>;
}
