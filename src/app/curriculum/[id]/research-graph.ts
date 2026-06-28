/**
 * The live-research GENERATING view's NODE-GRAPH + LEDGER — the PURE, node-testable core of the B
 * live-research generating state (Stage 2 of live-research; the data path is Stage 1 / #153).
 *
 * Stage 2 upgrades the flat six-stage rail (TS-23) into the Figma `1:2` live-research view: a research
 * DAG (plan → research questions → brief) whose nodes LIGHT as each question extracts, plus a "LIVE
 * RESEARCH · N/M extracted" panel listing the grounded findings + sources. It is driven ENTIRELY by the
 * EXISTING owner-scoped status poll — the `research` field (`ResearchEvent[]`, Stage 1) for the graph's
 * research column + the panel, and the rail's `plan`/`brief` derived state (from `steps`, via
 * `stage-rail.ts`) for the graph's anchor nodes. No new data path, no durable store, no pipeline change.
 *
 * This module is the view's pure pieces, pulled out of the `.tsx` so they unit-test in vitest's
 * `environment: 'node'` (no DOM — the same discipline `stage-rail.ts` / `lesson-message.ts` use):
 *
 *   1. {@link buildResearchGraph} — folds the poll's `ResearchEvent[]` + the `plan`/`brief` rail states
 *      into a {@link ResearchGraph}: an ordered PLAN anchor, one RESEARCH node per question, and a BRIEF
 *      anchor, each with a derived {@link GraphNodeState}, plus the curved edges plan→rᵢ and rᵢ→brief.
 *   2. {@link buildLedger} — folds the same `ResearchEvent[]` into the panel's {@link Ledger}: the
 *      extraction count (done / total) and one flattened, COPY-SAFE {@link LedgerFinding} per grounded
 *      claim (newest research first), each carrying its claim + the display host of its source.
 *
 * REAL DATA ONLY (AGENTS.md anti-invention + the Stage-1 copy-safe contract): every node, finding, and
 * source is derived from the `ResearchEvent` feed the run actually emitted — a `ResearchEvent` already
 * exposes ONLY learner-facing copy ({question, subtopic, claim, url, title} — never an internal index;
 * `repo.ts` denormalizes `sourceIndex` away before the write). A fabricated node/finding would be a UX
 * lie. When the feed is empty (before any question lands, or a non-owner) the graph degrades to the
 * PLAN→BRIEF spine with no research column and the ledger to a zero count — an honest minimal state,
 * never a fabricated graph.
 *
 * COPY-APPROPRIATENESS: {@link sourceHost} reduces a finding's URL to its bare display host (drops the
 * scheme + a leading `www.`) so the panel reads `britannica.com`, never a raw tracking URL or a leaked
 * identifier; a malformed/empty URL falls back to the source TITLE, then to nothing — show-nothing over
 * leak-or-guess (the library card's `categoryEyebrow` precedent).
 */

import type { RailStage } from './stage-rail';
import type { ResearchEvent } from '../../../store/repo'; // concept-drift-ok: code identifier, deferred rename (ADR-0003)

/** A graph node's lifecycle, mirroring the Figma `1:2` legend (solid ✓ ran · dashed ⟳ in progress ·
 *  dotted ○ pending). Color-independent — the view conveys it by border style + icon + text. */
export type GraphNodeState = 'pending' | 'running' | 'done' | 'error';

/** Which kind of node this is, so the view can label/route it (the plan + brief anchors vs a research
 *  question). The `kind` also keys the node's eyebrow ("PLAN" / "RESEARCH" / "BRIEF"). */
export type GraphNodeKind = 'plan' | 'research' | 'brief';

/** One node in the research DAG. `id` is layout-stable (the column kind + index), `title` is the node's
 *  learner-facing copy (the topic decomposition line, the research QUESTION, or the brief framing), and
 *  `detail` the sub-line (the count / "answered" / "extracting claims…"). All copy is REAL feed data. */
export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  /** 0-based position within this node's column (the research column fans out; plan/brief are single). */
  row: number;
  state: GraphNodeState;
  /** The node's eyebrow word (PLAN / RESEARCH / BRIEF) — kind, uppercased, for the view. */
  eyebrow: string;
  /** The node's title line — the topic-decomposition copy, the research question, or the brief framing. */
  title: string;
  /** The node's status sub-line — e.g. "3 sub-questions", "answered", "extracting claims…". */
  detail: string;
}

/** A curved edge between two nodes, by node id. The view draws it as a quadratic-bézier SVG path; this
 *  pure module only enumerates the connectivity (plan→rᵢ, rᵢ→brief), not the geometry. */
export interface GraphEdge {
  from: string;
  to: string;
  /** True once the SOURCE node has run (done) — the view can "light" a settled edge vs a pending one. */
  active: boolean;
}

/** The whole derived research DAG: the plan anchor, the fan-out of research nodes, the brief anchor, and
 *  the edges. `researchCount` is the number of research questions (0 ⇒ the degraded plan→brief spine). */
export interface ResearchGraph {
  plan: GraphNode;
  research: GraphNode[];
  brief: GraphNode;
  edges: GraphEdge[];
  researchCount: number;
}

/** One flattened finding for the LIVE RESEARCH panel — a grounded claim + its source's display host.
 *  COPY-SAFE by construction (the `ResearchEvent` it's folded from carries only learner-facing copy). */
export interface LedgerFinding {
  /** Stable per-finding key for the list (question ordinal + finding index) — never rendered. */
  key: string;
  claim: string;
  /** The source's bare display host (e.g. `britannica.com`), or '' when no usable source/title. */
  host: string;
  /** True while this finding's question is still extracting (the panel shows ⟳ vs ✓). */
  extracting: boolean;
}

/** The LIVE RESEARCH panel's derived contents: the extraction count + the flattened findings list. */
export interface Ledger {
  /** Questions whose research has landed (status 'done'). */
  extracted: number;
  /** Total announced questions (the fan-out width). */
  total: number;
  findings: LedgerFinding[];
}

const PLAN_TITLE = 'Decompose the topic into research questions';
const BRIEF_TITLE = 'Lesson brief';

/** Map a `ResearchEvent.status` string to a graph node state. The feed uses 'pending' | 'done' | 'error':
 *  a 'pending' (announced, not yet landed) row is the ⟳ "extracting" node, a 'done' row has ran, an
 *  'error' row was skipped. Any other (never-expected) value, or a finished timestamp without a 'done'
 *  status, is treated charitably as in-flight ('running') so the view never claims a question is done
 *  on bad data. */
function researchNodeState(status: string): GraphNodeState {
  if (status === 'error') return 'error';
  if (status === 'done') return 'done';
  return 'running';
}

/**
 * Derive the research DAG from the live feed + the plan/brief rail states.
 *
 * PURE: reads only its args. The PLAN node's state is the rail's `plan` stage state (the topic
 * decomposition is the `plan` step); the BRIEF node's state is the rail's `brief` stage state. Each
 * RESEARCH node's state comes from its `ResearchEvent` (pending ⇒ running/announced, done ⇒ ran, error
 * ⇒ skipped). The plan node's detail counts the announced questions; the brief node's detail is its
 * stage phase. Edges connect plan→each research and each research→brief; an edge is `active` once its
 * SOURCE node is done. When `research` is empty the graph is the honest PLAN→BRIEF spine (no fan-out).
 */
export function buildResearchGraph(
  research: ReadonlyArray<ResearchEvent>,
  planStage: RailStage | undefined,
  briefStage: RailStage | undefined,
): ResearchGraph {
  const researchNodes: GraphNode[] = research.map((r, i) => {
    const state = researchNodeState(r.status);
    const detail =
      state === 'done'
        ? r.findingCount && r.findingCount > 0
          ? `${r.findingCount} finding${r.findingCount === 1 ? '' : 's'}`
          : 'answered'
        : state === 'error'
          ? 'skipped'
          : 'extracting claims…';
    return {
      id: `research-${String(i)}`,
      kind: 'research' as const,
      row: i,
      state,
      eyebrow: 'RESEARCH',
      title: r.question,
      detail,
    };
  });

  const planState: GraphNodeState = planStage ? planStage.state : 'pending';
  const planDetail =
    research.length > 0
      ? `${String(research.length)} question${research.length === 1 ? '' : 's'}`
      : planState === 'done'
        ? 'planned'
        : planState === 'running'
          ? 'planning…'
          : 'pending';
  const plan: GraphNode = {
    id: 'plan',
    kind: 'plan',
    row: 0,
    state: planState,
    eyebrow: 'PLAN',
    title: PLAN_TITLE,
    detail: planDetail,
  };

  const briefState: GraphNodeState = briefStage ? briefStage.state : 'pending';
  const briefDetail =
    briefState === 'done'
      ? 'goal · key points · findings'
      : briefState === 'running'
        ? 'forming…'
        : 'goal · key points · findings';
  const brief: GraphNode = {
    id: 'brief',
    kind: 'brief',
    row: 0,
    state: briefState,
    eyebrow: 'BRIEF',
    title: BRIEF_TITLE,
    detail: briefDetail,
  };

  const edges: GraphEdge[] = [
    ...researchNodes.map((n) => ({ from: plan.id, to: n.id, active: plan.state === 'done' })),
    ...researchNodes.map((n) => ({ from: n.id, to: brief.id, active: n.state === 'done' })),
  ];

  return { plan, research: researchNodes, brief, edges, researchCount: researchNodes.length };
}

/**
 * Reduce a URL to a bare display host: drop the scheme and a leading `www.`. Returns '' on a
 * malformed/empty URL so the caller can fall back to the source title, then to nothing (show-nothing
 * over leak-or-guess — the copy-appropriateness gate). Pure; no I/O.
 */
export function sourceHost(url: string | undefined | null): string {
  if (!url) return '';
  try {
    const host = new URL(url).hostname;
    return host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Pick a finding's display source: its URL's host, else a trimmed title, else '' (no source rendered).
 * COPY-SAFE — never returns a raw tracking URL or an internal identifier.
 */
function displaySource(finding: { url: string; title: string }): string {
  const host = sourceHost(finding.url);
  if (host) return host;
  const title = finding.title.trim();
  return title.length > 0 ? title : '';
}

/**
 * Fold the live feed into the LIVE RESEARCH panel: the extraction count (done / total) and a flattened,
 * COPY-SAFE findings list. Findings are ordered NEWEST research first (the most recently-landed question
 * at the top, mirroring the Figma `1:2` ledger where the in-flight extraction sits last), so the panel
 * reads like a live tape. A finding from a still-extracting question is flagged `extracting` (the ⟳
 * marker). Empty feed ⇒ a zero count + no findings (the honest minimal state).
 *
 * PURE: reads only `research`. Each finding's key folds the question ordinal + the finding index so the
 * list is keyable without leaking any internal id.
 */
export function buildLedger(research: ReadonlyArray<ResearchEvent>): Ledger {
  const total = research.length;
  const extracted = research.filter((r) => r.status === 'done').length;

  // Newest research first: reverse the ordinal-ascending feed so the latest landed/extracting question
  // leads. Within a question, findings keep their emitted order.
  const findings: LedgerFinding[] = [];
  for (let qi = research.length - 1; qi >= 0; qi--) {
    const r = research[qi]!;
    const extracting = r.status !== 'done' && r.status !== 'error';
    r.findings.forEach((f, fi) => {
      const claim = f.claim.trim();
      if (claim.length === 0) return; // never render an empty claim row.
      findings.push({
        key: `q${String(qi)}-f${String(fi)}`,
        claim,
        host: displaySource(f),
        extracting,
      });
    });
  }

  return { extracted, total, findings };
}
