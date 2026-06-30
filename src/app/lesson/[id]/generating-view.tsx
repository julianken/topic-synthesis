'use client';

import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { fitColumn, type FitResult } from './fit-column';
import { buildLedger, buildResearchGraph, type LedgerFinding } from './research-graph';
import { deriveRail, DISPATCH_LABEL, formatDuration, isStarting, type RailStage, type StepEvent } from './stage-rail';
import { SPECIMEN_TOPIC_NAME } from '../../library-morph';
import type { CodeProgress, ResearchEvent } from '../../../store/repo';

const TICK_MS = 250; // how often the live in-progress timer re-renders

/**
 * The SHARED live-research GENERATING view — a FULL-WIDTH, COLUMN-LOCKED TABLE (the owner-approved,
 * measured-sound layout in `.superpowers/generating-layout/`; supersedes the prior side-rail B view #154).
 * ONE component for BOTH the reader route's generating state (`/lesson/[id]` — when the run is in
 * flight) and the create-form's in-place generating shell (`/`), so the two never diverge.
 *
 * The deliverable in one sentence (SPEC §"The deliverable"): the generating view is a 6-column GRID whose
 * columns ARE the pipeline phases (Plan · Research · Brief · Spec · Code · Critic), each column HEADED BY
 * and X-aligned under its top-stepper header, with the LIVE RESEARCH evidence relocated to a FULL-WIDTH
 * card band directly below the graph. Top-to-bottom:
 *
 *   1. A TOP CHROME band — a left wordmark + a right live phase label (a shimmer "Researching…" derived
 *      from the running rail stage).
 *   2. The TOPIC HEADER — an optional eyebrow (the REAL subject category where truthfully known, else
 *      omitted), "Generating <topic>…" as the large H1, and an optional `<level> · depth <n> · building
 *      one lesson` settings sub-line. `topic`/`level`/`depth`/`category` are OPTIONAL and each degrades
 *      honestly when unknown (never fabricated).
 *   3. The TABLE — the STEPPER (the six column headers, sharing ONE `repeat(6,1fr)` track set with the
 *      plane so every node X-centers under its header BY CONSTRUCTION, SPEC §2.1) over a PLANE of one
 *      column CELL per phase. Plan/Brief/Spec/Code/Critic are single nodes; Research is the in-column FAN,
 *      deterministically CAPPED by the fit-math (SPEC §2.3) so it never overflows its column at any count —
 *      the overflow sinks DOWNWARD into the research band as queued cards with a `+K below` chip. An SVG
 *      overlay draws the plan→rᵢ→brief→…→critic edges from MEASURED node rects (SPEC §3).
 *   4. The FULL-WIDTH LIVE RESEARCH band — "LIVE RESEARCH · N/M extracted" over an `auto-fill` card grid:
 *      the grounded findings (claim + source host, copy-safe) PLUS any overflowed research questions as
 *      queued pending cards (the column chip's downward sink). Empty/parked when research hasn't started.
 *   5. The COMPACT PROGRESS bar — all six phases as a dot-separated inline list with per-step durations +
 *      the running step's LIVE ticking timer (the shipped #61 timeline), and a single caption line.
 *   6. The bottom STATE LEGEND — solid/dashed/dotted = ran/in progress/pending.
 *
 * REAL DATA ONLY: every node/finding/source is derived from the feed the run emitted — `steps`
 * (getStepEvents) drives the stepper + per-column node state + the progress bar; `research`
 * (getResearchEvents, Stage 1 / #153) drives the Research column nodes + the LIVE RESEARCH band. Nothing
 * is fabricated. Motion is the §0 catalog ONLY (the `rail-reveal` stagger + the `--tr-state` primitive),
 * reduced-motion-gated by the global rule in `globals.css`. NO JS animation lib. This component never
 * touches the opaque-origin lesson iframe or its trust boundary.
 */
export function GeneratingView({
  topic,
  level,
  depth,
  category,
  steps,
  research,
  codeProgress,
  stalled,
}: {
  topic?: string | undefined;
  /** The run's level (intro/intermediate/advanced), where known — from `run_owner` via the status poll's
   *  `meta` (run-lifecycle #225) or the page's SSR props. */
  level?: string | undefined;
  /** The run's depth (1..5), where known — from `run_owner` (the status poll's `meta` / SSR props). */
  depth?: number | undefined;
  /** The REAL subject category (e.g. BIOLOGY), where truthfully known. Classified at the run TAIL, so it
   *  is NOT in the live poll — omitted (not fabricated) on every live path today. */
  category?: string | undefined;
  steps: StepEvent[];
  research: ResearchEvent[];
  /** The live code-phase progress (PR-4 / #180): a learner-safe `{ fraction, elapsedMs }` (or null when
   *  code hasn't streamed / once pruned). The bar is rendered ONLY when the `code` rail stage is running. */
  codeProgress?: CodeProgress | null;
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

  // The DISPATCH WINDOW (issue #162): the dispatch marker has landed but no real pipeline step has yet —
  // the cold-starting Job hasn't reached `plan`. Surfaces the single leading "Starting…" indicator; flips
  // false the instant a real step appears (so it yields to the rail — never two concurrent live timers).
  const starting = isStarting(steps);

  // The live phase label (the alive-copy affordance, SPEC §6): the running stage's label, derived from the
  // same rail state — NOT a second source of truth. During the dispatch window it reads "Starting…"; once
  // a real stage runs it reads that stage's label; otherwise it falls back to a neutral "Working".
  const running = rail.find((s) => s.state === 'running');
  const livePhase = running ? running.label : starting ? DISPATCH_LABEL : 'Working';

  return (
    <section className="gen" role="status" aria-live="polite">
      {/* TOP CHROME — wordmark left, the live phase label (shimmer) right. */}
      <div className="gen-top">
        <div className="gen-top__mark">
          topic·synthesis
          <small>this lesson&rsquo;s generation pipeline · plan → critic</small>
        </div>
        <div className="gen-top__live">
          <b className="gen-shimmer" data-text={livePhase} data-testid="gen-live-phase">
            {livePhase}
          </b>
          <small>web-grounded · extracting claims</small>
        </div>
      </div>

      {/* TOPIC HEADER. */}
      <header className="gen-topic">
        {category ? <p className="gen-topic__eyebrow">{category}</p> : null}
        <h1 className="gen-topic__title">
          Generating
          {topic ? (
            <>
              {' '}
              {/* `id="genTopic"` is the receiver hook the cross-document morph guard reads (run-lifecycle
                  #225): on the `.gen` generating destination there is NO `#readerPanel`, so the morph
                  receiver targets THIS element instead, letting the create-form→generating topic morph run
                  (it pairs with the form's `specimen-topic` text-twin). Absent when the topic is unknown →
                  the receiver finds no destination → a clean instant-swap, never a half-morph. */}
              <span
                id="genTopic"
                className="gen-topic__topic"
                style={{ viewTransitionName: SPECIMEN_TOPIC_NAME } as CSSProperties}
              >
                {topic}
              </span>
            </>
          ) : null}
          …
        </h1>
        {settingsLine ? <p className="gen-topic__settings">{settingsLine}</p> : null}
      </header>

      {/* THE TABLE — the stepper (column headers) over the column-locked plane, then the full-width band. */}
      <PhaseTable rail={rail} graph={graph} ledger={ledger} codeProgress={codeProgress ?? null} />

      <ProgressBar rail={rail} starting={starting} stalled={stalled} />

      <StateLegend />
    </section>
  );
}

// ── The canonical six phases (the live runLesson stage set; NO graph/gate/hub) ──────────────────────────

/** The six engine step names of `runLesson`, in pipeline order — the table's COLUMNS = the stepper's
 *  headers. `graph` is omitted: it fires only on the dormant `runPipeline` path, so surfacing it would
 *  fabricate a phase — the same RETAINED discipline as `stage-rail.ts`. concept-drift-ok: documents the
 *  NO-graph omission (decision 9 / ADR-0003). */
const PHASES = ['plan', 'research', 'brief', 'spec', 'code', 'critic'] as const;
type Phase = (typeof PHASES)[number];

/** The display label for each phase column header + spine node (Title Case). */
const PHASE_LABEL: Record<Phase, string> = {
  plan: 'Plan',
  research: 'Research',
  brief: 'Brief',
  spec: 'Spec',
  code: 'Code',
  critic: 'Critic',
};

/** The static phase descriptor (the spine node's title) + meta sub-line for the non-research phases — the
 *  honest phase descriptor + state (SPEC §"Wire to the REAL data"). The titles describe what the phase
 *  does; the live state comes from `steps`. Research's node titles come from the real feed, not here. */
const PHASE_DESCRIPTOR: Record<Exclude<Phase, 'research'>, { title: string; meta: string }> = {
  plan: { title: 'Decompose the topic into research questions', meta: 'topic → questions' },
  brief: { title: 'Assemble the LessonBrief', meta: 'goal · key points · findings' },
  spec: { title: 'Emit the lesson spec', meta: 'sectioned · pedagogy' },
  code: { title: 'Synthesize the HTML lesson', meta: 'standalone · sandboxed' },
  critic: { title: 'Grade the lesson', meta: 'pass / fail verdict' },
};

/** A phase column's rendered state, mapped from the rail's per-stage lifecycle to the table's three-state
 *  border vocabulary (solid ran · dashed running · dotted pending). `error` reads as `ran` for the table's
 *  border style but the rail/legend carry the failed word separately. */
type CellState = 'ran' | 'running' | 'pending';

function cellStateOf(state: RailStage['state']): CellState {
  if (state === 'done') return 'ran';
  if (state === 'running') return 'running';
  if (state === 'error') return 'ran'; // the step ran (and failed) — the border reads solid; pill flags it
  return 'pending';
}

/** The per-state glyph + screen-reader word — state by ICON + TEXT + border style, never color alone
 *  (DESIGN.md §Accessibility). */
const CELL_AFFORDANCE: Record<CellState, { glyph: string; word: string }> = {
  ran: { glyph: '✓', word: 'ran' },
  running: { glyph: '⟳', word: 'in progress' },
  pending: { glyph: '○', word: 'pending' },
};

// ── DOM helpers for the fit-math (the PURE math lives in ./fit-column) ───────────────────────────────────

/** Read a CSS length custom property off an element, resolved to px via an off-screen probe — so the
 *  fit-math reads the SAME tokens the CSS uses (no hardcoded px). */
function tokenPx(el: HTMLElement, name: string): number {
  const probe = document.createElement('div');
  const value = getComputedStyle(el).getPropertyValue(name).trim();
  probe.style.cssText = `position:absolute;visibility:hidden;height:${value || name}`;
  el.appendChild(probe);
  const px = probe.getBoundingClientRect().height;
  probe.remove();
  return px;
}

/** Measure the rendered height of the overflow chip (its real font/padding/border, not a magic px) in a
 *  real `.gen-cell` context so it inherits the same metrics, then remove it. */
function measureChipH(gridEl: HTMLElement): number {
  const cell = document.createElement('div');
  cell.className = 'gen-cell';
  cell.style.cssText = 'position:absolute;visibility:hidden;left:-9999px;top:0;width:200px;height:auto;';
  const chip = document.createElement('div');
  chip.className = 'gen-overflow';
  chip.textContent = '+9 below';
  cell.appendChild(chip);
  gridEl.appendChild(cell);
  const h = chip.getBoundingClientRect().height;
  cell.remove();
  return h;
}

// ── The phase table (stepper headers + the column-locked plane + the full-width research band) ───────────

/**
 * The TABLE: the STEPPER (six column headers) sharing one `repeat(6,1fr)` track set with the PLANE (the
 * node grid), so each node X-centers under its header BY CONSTRUCTION (SPEC §2.1 — the column lock is a
 * property of the shared Grid tracks, not JS arithmetic). The research column is the in-column FAN, capped
 * by the fit-math (computed from the LIVE CSS tokens in a layout effect); the overflow + every finding
 * sink into the FULL-WIDTH research band below the plane. An SVG overlay draws the measured edges.
 */
function PhaseTable({
  rail,
  graph,
  ledger,
  codeProgress,
}: {
  rail: RailStage[];
  graph: ReturnType<typeof buildResearchGraph>;
  ledger: ReturnType<typeof buildLedger>;
  /** The live code-phase progress (PR-4 / #180) — surfaced ONLY on the Code column node while it runs. */
  codeProgress: CodeProgress | null;
}) {
  const planeRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // The fit-math result, computed from the LIVE CSS tokens once the plane mounts + on resize. SSR/first
  // paint uses a conservative fallback (everything visible) until the layout effect measures (SPEC §3.4).
  const researchCount = graph.research.length;
  const [fit, setFit] = useState<FitResult>(() => ({
    visible: researchCount,
    overflow: 0,
    nodeH: 0,
  }));
  // The per-cell single-node height, read from the live token (0 until measured → CSS fallback applies).
  const [singleH, setSingleH] = useState(0);

  // The visible research nodes (the column fan) + the overflowed ones (the band's queued sink). These are
  // derived from `fit.visible`, which is set by the layout effect below — NOT a dependency of any effect
  // (a fresh array each render would otherwise re-fire an effect forever).
  const visibleResearch = graph.research.slice(0, fit.visible);
  const overflowResearch = fit.overflow > 0 ? graph.research.slice(fit.visible) : [];

  // ── The fit-math, recomputed from the LIVE CSS tokens on mount + resize. Re-runs ONLY when the research
  //    COUNT changes (a stable primitive) — never on a fresh-array identity churn. Each setter is guarded
  //    to write only on a real change, so a duplicate compute can't trigger an update loop. ──────────────
  const recompute = useCallback(() => {
    const plane = planeRef.current;
    const gridEl = gridRef.current;
    if (!plane || !gridEl) return;
    // On the mobile collapse the plane is block-flow (no fixed height) — skip the fit cap (all show).
    if (window.matchMedia('(max-width: 60rem)').matches) {
      setFit((prev) =>
        prev.visible === researchCount && prev.overflow === 0 && prev.nodeH === 0
          ? prev
          : { visible: researchCount, overflow: 0, nodeH: 0 },
      );
      setSingleH((prev) => (prev === 0 ? prev : 0));
      return;
    }
    const planeH = tokenPx(plane, '--gen-plane-h');
    const colPad = tokenPx(plane, '--gen-col-pad');
    const colH = planeH - 2 * colPad; // the usable (inset) column budget the fan is centered in
    const gap = tokenPx(plane, '--gen-node-gap');
    const minH = tokenPx(plane, '--gen-node-min-h');
    const maxH = tokenPx(plane, '--gen-node-max-h');
    const chipH = measureChipH(gridEl);
    const next = fitColumn(colH, researchCount, gap, minH, maxH, chipH);
    setFit((prev) =>
      prev.visible === next.visible && prev.overflow === next.overflow && prev.nodeH === next.nodeH
        ? prev
        : next,
    );
    const sh = tokenPx(plane, '--gen-node-single-h');
    setSingleH((prev) => (prev === sh ? prev : sh));
  }, [researchCount]);

  useLayoutEffect(() => {
    recompute();
    const onResize = (): void => recompute();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [recompute]);

  // ── Measured edges (SPEC §3): read every endpoint from the rendered node rect, recompute on layout +
  //    resize. Drawn beneath the nodes; recomputed via a ResizeObserver so it tracks the fan's height. The
  //    effect re-fires on a STABLE `edgeKey` (the ids + states the edges encode) + the measured heights —
  //    NEVER on a fresh-array identity, so the setEdgeBox write can't feed back into an update loop. The
  //    draw reads its inputs from a ref refreshed each render, so its identity stays stable. ────────────
  const [edgeBox, setEdgeBox] = useState<{ width: number; height: number; paths: EdgePath[] }>({
    width: 0,
    height: 0,
    paths: [],
  });
  // The stable connectivity key: which research nodes are visible + every node's done-state. When it (or
  // the measured layout) is unchanged, the edges don't need redrawing.
  const edgeKey = [
    graph.plan.state === 'done' ? '1' : '0',
    graph.brief.state === 'done' ? '1' : '0',
    railDone(rail, 'spec') ? '1' : '0',
    railDone(rail, 'code') ? '1' : '0',
    visibleResearch.map((r) => `${r.id}:${r.state === 'done' ? 'd' : 'p'}`).join(','),
  ].join('|');

  // Latest edge inputs, read inside the stable drawEdges callback (avoids re-creating it each render).
  const edgeInputs = useRef({ graph, rail, visibleResearch });
  edgeInputs.current = { graph, rail, visibleResearch };

  const drawEdges = useCallback(() => {
    const plane = planeRef.current;
    const gridEl = gridRef.current;
    if (!plane || !gridEl) return;
    if (window.matchMedia('(max-width: 60rem)').matches) {
      setEdgeBox((prev) => (prev.paths.length === 0 && prev.width === 0 ? prev : { width: 0, height: 0, paths: [] }));
      return;
    }
    const { graph: g, rail: rl, visibleResearch: vr } = edgeInputs.current;
    const planeRect = plane.getBoundingClientRect();
    const bend = tokenPx(plane, '--gen-bend');
    const rectOf = (id: string): { left: number; right: number; cy: number } | null => {
      const el = gridEl.querySelector<HTMLElement>(`[data-node="${id}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        left: r.left - planeRect.left,
        right: r.right - planeRect.left,
        cy: r.top - planeRect.top + r.height / 2,
      };
    };
    const out: EdgePath[] = [];
    const pushEdge = (fromId: string, toId: string, active: boolean): void => {
      const s = rectOf(fromId);
      const d = rectOf(toId);
      if (!s || !d) return;
      const ax = s.right;
      const bx = d.left;
      const k = Math.max(bend, (bx - ax) * 0.5); // control handle = half the gap (min = bend)
      out.push({
        id: `${fromId}->${toId}`,
        d: `M ${String(ax)} ${String(s.cy)} C ${String(ax + k)} ${String(s.cy)}, ${String(bx - k)} ${String(d.cy)}, ${String(bx)} ${String(d.cy)}`,
        active,
      });
    };
    const planRan = g.plan.state === 'done';
    vr.forEach((r) => {
      pushEdge('plan', r.id, planRan);
      pushEdge(r.id, 'brief', r.state === 'done');
    });
    pushEdge('brief', 'spec', g.brief.state === 'done');
    pushEdge('spec', 'code', railDone(rl, 'spec'));
    pushEdge('code', 'critic', railDone(rl, 'code'));
    setEdgeBox({ width: planeRect.width, height: planeRect.height, paths: out });
  }, []);

  // The monotonic token that makes a DEFERRED edge draw idempotent (SPEC §3.5): a newer render supersedes
  // an older deferred draw, so a fast N-toggle can't paint a stale edge set onto a settled layout.
  const edgeDrawToken = useRef(0);

  useLayoutEffect(() => {
    const plane = planeRef.current;
    const gridEl = gridRef.current;
    if (!plane || !gridEl) return;

    // SETTLE GATE (SPEC §3.5 — the entrance-race fix). The `.gen-node` cards mount with the `rail-reveal`
    // catalog animation (`translateY(var(--sp-1))` → 0 = a 4px displacement). A draw taken DURING that
    // entrance reads the +4px-displaced rect and anchors every edge 4px off the node center (the measured
    // edge-anchor regression the BUILT-app geometry spec catches). So draw ONLY once the nodes are at rest:
    //   • a double-rAF after layout — under reduced motion the global guard zeroes the duration, so the
    //     entrance has already committed its resting frame by the second rAF (this is the common path);
    //   • each node's `rail-reveal` `animationend` (bubbling to the grid) — the authoritative settled
    //     signal on the animated path; the final redraw reflects all-settled geometry, the token guards a
    //     stale one, and the double-rAF is the bounded fallback if an `animationend` is dropped.
    // A token makes the deferred draw idempotent against a fast re-render (SPEC §3.5).
    const myToken = ++edgeDrawToken.current;
    const run = (): void => {
      if (myToken === edgeDrawToken.current) drawEdges();
    };

    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(run);
    });
    const onAnimEnd = (e: AnimationEvent): void => {
      if (e.animationName === 'rail-reveal') run();
    };
    gridEl.addEventListener('animationend', onAnimEnd);

    const ro = new ResizeObserver(() => drawEdges());
    ro.observe(plane);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      gridEl.removeEventListener('animationend', onAnimEnd);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- edgeKey + the measured heights gate redraws; drawEdges is stable.
  }, [drawEdges, edgeKey, fit.nodeH, fit.visible, singleH]);

  return (
    <div className="gen-table">
      {/* THE STEPPER — the six column headers; same grid track set as the plane → column lock. */}
      <ol className="gen-stepper" aria-label={`Pipeline phases — ${String(PHASES.length)} stages`}>
        {PHASES.map((phase) => {
          const stage = rail.find((s) => s.name === phase);
          const st = cellStateOf(stage ? stage.state : 'pending');
          const count =
            phase === 'research'
              ? `${String(ledger.extracted)}/${String(researchCount)}`
              : '';
          return (
            <li
              key={phase}
              className="gen-step"
              data-state={st}
              data-phase={phase}
              data-testid={`gen-step-${phase}`}
            >
              <span className="gen-step__label">
                {PHASE_LABEL[phase]}
                <span className="gen-sr"> · {CELL_AFFORDANCE[st].word}</span>
              </span>
              <span className="gen-step__bar" aria-hidden="true" />
              <span className="gen-step__count" data-testid={`gen-step-count-${phase}`}>
                {count}
              </span>
            </li>
          );
        })}
      </ol>

      {/* THE PLANE — SVG edges beneath, the node grid above (identical tracks → column lock). */}
      <div className="gen-plane" ref={planeRef}>
        <svg
          className="gen-plane__edges"
          viewBox={`0 0 ${String(edgeBox.width)} ${String(edgeBox.height)}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {edgeBox.paths.map((e) => (
            <path
              key={e.id}
              data-edge={e.id}
              className={`gen-edge${e.active ? ' gen-edge--active' : ''}`}
              d={e.d}
            />
          ))}
        </svg>

        <div className="gen-plane__grid" ref={gridRef} role="list" aria-label="pipeline nodes by phase">
          {PHASES.map((phase, ci) => {
            if (phase === 'research') {
              return (
                <div
                  className="gen-cell"
                  data-phase="research"
                  data-testid="gen-cell-research"
                  style={{ gridColumn: ci + 1 }}
                  key={phase}
                >
                  {visibleResearch.length > 0 ? (
                    visibleResearch.map((r, ri) => (
                      <PhaseNode
                        key={r.id}
                        nodeId={r.id}
                        rIndex={ri}
                        phase="research"
                        state={researchCellState(r.state)}
                        title={r.title}
                        meta={r.detail}
                        height={fit.nodeH}
                      />
                    ))
                  ) : (
                    <PhaseNode
                      nodeId="research-empty"
                      phase="research"
                      state="pending"
                      title="Planning research questions…"
                      meta="awaiting the plan"
                      height={fit.nodeH}
                    />
                  )}
                  {fit.overflow > 0 ? (
                    <p className="gen-overflow" aria-hidden="true">
                      +{fit.overflow} below
                    </p>
                  ) : null}
                </div>
              );
            }
            const stage = rail.find((s) => s.name === phase);
            const st = cellStateOf(stage ? stage.state : 'pending');
            const descriptor = PHASE_DESCRIPTOR[phase];
            // The live code-phase bar (PR-4 / #180): ONLY on the Code node, ONLY while code is running, and
            // ONLY when a real progress sample is present — so it appears mid-code and disappears the instant
            // code flips to done/error (a stale row is then inert).
            const progress = phase === 'code' && st === 'running' ? codeProgress : null;
            return (
              <div className="gen-cell" data-phase={phase} style={{ gridColumn: ci + 1 }} key={phase}>
                <PhaseNode
                  nodeId={phase}
                  phase={phase}
                  state={st}
                  title={descriptor.title}
                  meta={descriptor.meta}
                  height={singleH}
                  progress={progress}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* THE FULL-WIDTH LIVE RESEARCH band — evidence + the overflow sink. */}
      <LiveResearchBand
        extracted={ledger.extracted}
        total={researchCount}
        findings={ledger.findings}
        overflow={overflowResearch.map((r, k) => ({
          id: r.id,
          rLabel: `R${String(fit.visible + k + 1)}`,
          question: r.title,
        }))}
      />
    </div>
  );
}

/** Did the named rail stage finish (done)? — drives the spine edges' active state. */
function railDone(rail: RailStage[], name: string): boolean {
  const s = rail.find((x) => x.name === name);
  return s ? s.state === 'done' : false;
}

/** Map a research GRAPH node's state to the table's three-state border vocabulary. */
function researchCellState(state: 'pending' | 'running' | 'done' | 'error'): CellState {
  if (state === 'done') return 'ran';
  if (state === 'running') return 'running';
  if (state === 'error') return 'ran';
  return 'pending';
}

interface EdgePath {
  id: string;
  d: string;
  active: boolean;
}

// ── One table node (a phase cell card) ───────────────────────────────────────────────────────────────────

/** One node in the plane — a `[label] [title] [meta]` card whose BORDER STYLE + glyph + sr-word encode
 *  state (never color alone). `data-node` is the layout-stable id the edge measurer keys off. The fit-math
 *  sets `--node-h` (research) or the single-node height; CSS falls back to its floor when height is 0
 *  (pre-measure / SSR). */
function PhaseNode({
  nodeId,
  rIndex,
  phase,
  state,
  title,
  meta,
  height,
  progress,
}: {
  nodeId: string;
  rIndex?: number;
  phase: Phase;
  state: CellState;
  title: string;
  meta: string;
  height: number;
  /** The live code-phase progress (PR-4 / #180), present ONLY for the Code node while it runs — renders the
   *  bounded "Writing the lesson…" bar. Null/absent everywhere else (the node renders without a bar). */
  progress?: CodeProgress | null;
}) {
  const { glyph, word } = CELL_AFFORDANCE[state];
  const label = phase === 'research' && typeof rIndex === 'number' ? `R${String(rIndex + 1)}` : PHASE_LABEL[phase];
  const style = height > 0 ? ({ '--node-h': `${String(height)}px` } as CSSProperties) : undefined;
  return (
    <article
      className="gen-node"
      data-node={nodeId}
      data-state={state}
      style={style}
      aria-label={`${PHASE_LABEL[phase]} node, ${word}: ${title}`}
    >
      <p className="gen-node__label">
        <span>{label}</span>
        <span className="gen-node__glyph" aria-hidden="true">
          {glyph}
        </span>
        <span className="gen-sr"> · {word}</span>
      </p>
      <p className="gen-node__title">{title}</p>
      {/* While code streams, the live bar REPLACES the static "standalone · sandboxed" descriptor in the
          node's last grid row — keeping the 3-row [label][title][meta|bar] grid uncrammed (no 4th row that
          would squeeze a 2-line title into the meta) and reading better (live state over static copy). */}
      {progress ? <CodeProgressBar fraction={progress.fraction} /> : <p className="gen-node__meta">{meta}</p>}
    </article>
  );
}

/**
 * The live CODE-PHASE progress bar (PR-4 / issue #180), rendered inside the Code column node while `code`
 * streams. A learner-safe BAR ONLY — the bounded `fraction` (0..~0.95, already clamped IN THE SINK) as the
 * fill width — with a text label ("Writing the lesson…") so state is conveyed by LABEL + bar, never color
 * alone (§Accessibility). It is a `role="progressbar"` with `aria-valuenow` = a rounded "how far along"
 * percent for AT — a coordinate about the artifact's growth, NEVER a token/cost magnitude (no numeric
 * readout is shown). The fill transition rides the §0 catalog `--tr-progress` primitive (reduced-motion-gated
 * by the global rule); no JS animation. The bar lives entirely within the node's FIXED height
 * (`overflow:hidden`), so the column-lock + spine-uniformity geometry is unchanged.
 */
function CodeProgressBar({ fraction }: { fraction: number }) {
  const clamped = Math.max(0, Math.min(1, fraction));
  const pct = Math.round(clamped * 100);
  return (
    <div
      className="gen-codebar"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label="Writing the lesson…"
      data-testid="gen-codebar"
    >
      <span className="gen-codebar__label">Writing the lesson…</span>
      <span className="gen-codebar__track" aria-hidden="true">
        <span className="gen-codebar__fill" style={{ width: `${String(pct)}%` }} />
      </span>
    </div>
  );
}

// ── The full-width LIVE RESEARCH band ──────────────────────────────────────────────────────────────────

interface OverflowCard {
  id: string;
  rLabel: string;
  question: string;
}

/**
 * The relocated LIVE RESEARCH band (SPEC §6.B): a header — a pulse dot + "LIVE RESEARCH" + an "N / M
 * extracted" count — over a FULL-WIDTH `auto-fill` card grid. It renders (1) the grounded findings as
 * evidence cards (a ✓ once the question landed, a ⟳ while extracting; claim + an em-dash source HOST,
 * copy-safe), and (2) any OVERFLOWED research questions as QUEUED pending cards (the column chip's
 * downward sink, carrying their R{n} label + a "queued" sub-label). When research hasn't started (no
 * findings AND nothing overflowed) it shows a single muted parked row, never a conspicuous void.
 */
function LiveResearchBand({
  extracted,
  total,
  findings,
  overflow,
}: {
  extracted: number;
  total: number;
  findings: LedgerFinding[];
  overflow: OverflowCard[];
}) {
  const empty = findings.length === 0 && overflow.length === 0;
  return (
    <section className="gen-research" aria-label="Live research findings" data-testid="gen-research-band">
      <div className="gen-research__head">
        <span className="gen-research__pulse" aria-hidden="true" />
        <span className="gen-research__title">LIVE RESEARCH</span>
        <span className="gen-research__count" data-testid="gen-research-count">
          {String(extracted)} / {String(total)} extracted
        </span>
      </div>
      {empty ? (
        <p className="gen-research__parked">
          Research has not started — findings will appear here as claims are extracted.
        </p>
      ) : (
        <ul className="gen-research__grid">
          {findings.map((f, i) => (
            <li
              className={`gen-finding${f.extracting ? ' gen-finding--extracting' : ''}`}
              key={f.key}
              style={{ '--rail-i': i } as CSSProperties}
            >
              <span className="gen-finding__glyph" aria-hidden="true">
                {f.extracting ? '⟳' : '✓'}
              </span>
              <div>
                <p className="gen-finding__claim">{f.claim}</p>
                {f.host ? <p className="gen-finding__src">↳ {f.host}</p> : null}
              </div>
            </li>
          ))}
          {overflow.map((o, i) => (
            <li
              className="gen-finding gen-finding--queued"
              key={o.id}
              style={{ '--rail-i': findings.length + i } as CSSProperties}
            >
              <span className="gen-finding__glyph" aria-hidden="true">
                ○
              </span>
              <div>
                <p className="gen-finding__rlabel">{o.rLabel}</p>
                <p className="gen-finding__claim">{o.question}</p>
                <p className="gen-finding__queued">queued — overflowed from the graph column</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── The compact progress bar (the honest per-step timeline — issue #61) ──────────────────────────────────

/** The per-state glyph + sr-word for the progress segments (state by icon + text, never color alone). */
const SEG_AFFORDANCE: Record<RailStage['state'], { glyph: string; word: string }> = {
  pending: { glyph: '—', word: 'pending' },
  running: { glyph: '⟳', word: 'in progress' },
  done: { glyph: '✓', word: 'done' },
  error: { glyph: '✗', word: 'failed' },
};

/**
 * The compact PROGRESS bar (SPEC §4): all six phases as a dot-separated inline list with per-step
 * durations + the running step's LIVE ticking timer, then a single caption line. The SAME real per-step
 * data the shipped #61 timeline carries — names, durations, the current-stage glyph, and the live timer.
 */
function ProgressBar({ rail, starting, stalled }: { rail: RailStage[]; starting: boolean; stalled: boolean }) {
  const running = rail.find((s) => s.state === 'running');
  return (
    <div className="gen-progress">
      <p className="gen-progress__label">Pipeline progress</p>
      <ol className="gen-progress__steps" aria-label={`Generation progress — ${String(rail.length)} stages`}>
        {rail.map((stage, i) => (
          <ProgressSegment key={stage.name} stage={stage} last={i === rail.length - 1} />
        ))}
      </ol>
      <ProgressCaption running={running ?? null} starting={starting} stalled={stalled} />
    </div>
  );
}

/** One progress segment — the stage name (lowercase), its timing, and its state glyph — plus the `·`
 *  divider after it (except the last). The running segment shows a LIVE elapsed timer; a finished one its
 *  frozen duration; a not-started one an em-dash. */
function ProgressSegment({ stage, last }: { stage: RailStage; last: boolean }) {
  const { glyph, word } = SEG_AFFORDANCE[stage.state];
  const running = stage.state === 'running';
  const showTime = stage.state !== 'pending';
  return (
    <li className={`gen-pstep gen-pstep--${stage.state}`}>
      <span className="gen-pstep__name">
        {stage.name}
        <span className="gen-sr"> · {word}</span>
      </span>
      {showTime ? (
        <span className="gen-pstep__time">
          {running && stage.event ? (
            <LiveTimer startedAt={stage.event.startedAt} />
          ) : (
            <FrozenTime event={stage.event} />
          )}
        </span>
      ) : null}
      <span className="gen-pstep__glyph" aria-hidden="true">
        {glyph}
      </span>
      {!last ? (
        <span className="gen-pstep__sep" aria-hidden="true">
          ·
        </span>
      ) : null}
    </li>
  );
}

/** The single caption line under the bar: names the in-progress stage with its live elapsed timer; in the
 *  dispatch window (issue #162) it reads "Starting…"; when nothing is in flight it falls back to "Working…"
 *  (or the stalled hint). */
function ProgressCaption({
  running,
  starting,
  stalled,
}: {
  running: RailStage | null;
  starting: boolean;
  stalled: boolean;
}) {
  if (stalled) {
    return (
      <p className="gen-progress__caption" data-testid="gen-progress-caption">
        Still working — this is taking longer than usual. Leave this open, or check back soon.
      </p>
    );
  }
  if (running && running.event) {
    return (
      <p className="gen-progress__caption" data-testid="gen-progress-caption">
        {running.name} · <LiveTimer startedAt={running.event.startedAt} /> and counting — live timer
        ticks until the step lands
      </p>
    );
  }
  // Pre-`plan` dispatch window: the run is starting up (the Job is cold-booting); no stage runs yet, so
  // there is NO live timer here — just the honest "Starting…" copy, never a second ticking timer.
  if (starting) {
    return (
      <p className="gen-progress__caption" data-testid="gen-progress-caption">
        Starting…
      </p>
    );
  }
  return (
    <p className="gen-progress__caption" data-testid="gen-progress-caption">
      Working…
    </p>
  );
}

// ── The bottom state legend ──────────────────────────────────────────────────────────────────────────────

/** The bottom STATE LEGEND: solid — ran · dashed — in progress · dotted — pending, each a short sample
 *  bar in the matching border style (the same vocabulary the §Accessibility rule mandates). */
function StateLegend() {
  return (
    <dl className="gen-legend" aria-label="State legend">
      <div className="gen-legend__row">
        <span className="gen-legend__bar gen-legend__bar--solid" aria-hidden="true" />
        <dt className="gen-legend__term">solid</dt>
        <dd className="gen-legend__def">— ran</dd>
      </div>
      <div className="gen-legend__row">
        <span className="gen-legend__bar gen-legend__bar--dashed" aria-hidden="true" />
        <dt className="gen-legend__term">dashed</dt>
        <dd className="gen-legend__def">— in progress</dd>
      </div>
      <div className="gen-legend__row">
        <span className="gen-legend__bar gen-legend__bar--dotted" aria-hidden="true" />
        <dt className="gen-legend__term">dotted</dt>
        <dd className="gen-legend__def">— pending</dd>
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
