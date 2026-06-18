import type { Engine } from '../engine/engine';
import type { StageModel } from '../llm/models';
import type { StoreDeps } from '../store/repo';
import { code } from './code';
import { critique } from './critic';
import type { StageDeps } from './deps';
import { buildGraph } from './graph';
import { plan } from './planner';
import { research } from './researcher';
import { spec } from './spec';

/**
 * The pipeline's swap seams, named in one place. Every workflow component is a pluggable
 * adapter behind a port with a real default, so any component can be switched out for a
 * test OR run as an eval A/B arm — a "workflow_version" is a frozen choice across
 * {stages, models, engine}. See docs/decisions/0001 §5.
 *
 *   Component         Port            Swap for testing / eval
 *   ───────────────   ─────────────   ──────────────────────────────────────────────────
 *   Orchestration     Engine.step     InlineEngine (local) ↔ GcpEngine (Postgres) ↔ a
 *                                      fault-injecting engine for crash-resume tests
 *   Stages            StageBundle     swap one stage, e.g. a fixture `graph` (below)
 *   LLM + web search  StageDeps       real ↔ fakes ↔ recorded cassettes ↔ a cheap model
 *   Per-stage model   StageModel      the A/B arm (RunOptions.models)
 *   Store             StoreDeps       Postgres ↔ in-memory (lives in src/store/repo.ts)
 *
 * Known residual limits, so this doesn't over-claim full swappability:
 *  (i)   StageModel.params (effort/thinking/cacheSystem) are carried on an arm but not yet
 *        applied at the client call site, so two arms differing only in params are runtime-
 *        indistinguishable today;
 *  (ii)  searchWeb is Anthropic-only, so a non-Anthropic researcher arm isn't swappable via
 *        StageModel alone;
 *  (iii) StoreDeps is per-call (post-pipeline persistRun), not threaded through runPipeline.
 */
export type { Engine, StageDeps, StageModel, StoreDeps };

/**
 * The injectable stage set. One field per LLM stage, each typed as that stage's exact
 * signature via `typeof` — a heterogeneous-by-field interface is the only encoding that
 * preserves the six differing signatures with zero `any` and zero casts. Only the LLM
 * stages are injected; the pure deterministic `coverage-gate` and `hub` are not (they take
 * no model/deps and aren't an eval axis). run-pipeline keeps owning the `engine.step(name,
 * key, fn)` keying + record threading — a StageBundle field is only the function called
 * inside that closure, so swapping a stage can't bypass memoization or cost accounting.
 */
export interface StageBundle {
  plan: typeof plan;
  research: typeof research;
  graph: typeof buildGraph;
  spec: typeof spec;
  code: typeof code;
  critic: typeof critique;
}

/** The real stages — the default for every run; a test or eval arm overrides one field. */
export const defaultStages: StageBundle = {
  plan,
  research,
  graph: buildGraph,
  spec,
  code,
  critic: critique,
};
