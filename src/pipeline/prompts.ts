import { contentHash } from '../domain/identity';
import { BRIEF_SYSTEM } from './brief';
import { CODE_SYSTEM } from './code';
import { CRITIC_SYSTEM, GRADED_CRITIC_SYSTEM } from './critic';
import { GRAPH_SYSTEM } from './graph';
import { PLANNER_SYSTEM } from './planner';
import { RESEARCH_SYSTEM, STRUCTURE_SYSTEM } from './researcher';
import { SPEC_SYSTEM, SPEC_V11_SYSTEM } from './spec';

/**
 * A stable, content-DERIVED version anchor for the stage system prompts — one of the two
 * "pipeline shape" inputs (alongside `LESSON_BRIEF_SCHEMA_HASH`) that the contract-aware
 * `workflow_version` folds in (`src/store/repo.ts`). It replaces the `prompt_hash` column's
 * former literal `'v1'`, which lied: the table comment (`schema.sql`) says the id is "a content
 * hash of the pipeline shape: DAG + PROMPTS + … model snapshots", but prompts were never hashed.
 *
 * Why derive instead of hand-bump: a manual integer drifts the instant someone edits a prompt
 * without bumping it — a second source of truth. Hashing the actual system prompts (keyed by a
 * stable name so reordering the entries can't change the digest) makes the version change
 * automatically and ONLY when a prompt's text changes. Two arms differing only in a prompt thus
 * get distinct `workflow_version`s; an unchanged pipeline keeps a stable id across runs/deploys.
 *
 * Scope: the system prompts are the declarative, run-invariant part of each stage. The per-call
 * `*Prompt(input)` builders are run DATA (topic/research), not pipeline shape, so they're out —
 * folding them in would make the version vary per run and stop meaning "this exact pipeline".
 */
const SYSTEM_PROMPTS: ReadonlyArray<readonly [name: string, text: string]> = [
  ['planner', PLANNER_SYSTEM],
  ['research', RESEARCH_SYSTEM],
  ['structure', STRUCTURE_SYSTEM],
  ['graph', GRAPH_SYSTEM],
  ['brief', BRIEF_SYSTEM],
  ['spec', SPEC_SYSTEM],
  // The v11 SECTIONED spec (the v11 arm's `StageBundle.spec`, TS-11) is a distinct stage prompt from
  // the blob `SPEC_SYSTEM`; folding it in means the v11 arm self-distinguishes by `workflow_version`
  // exactly as the graded critic does. The blob `SPEC_SYSTEM` stays the live default (kill-switch).
  ['spec-v11', SPEC_V11_SYSTEM],
  ['code', CODE_SYSTEM],
  ['critic', CRITIC_SYSTEM],
  // The GRADED critic (the v11 `StageBundle.critic` arm — program decision 7) is a distinct stage
  // prompt from the binary `critic`; folding it in means a graded-arm rubric edit (TS-7's
  // ledger-aware rewrite) yields a distinct `workflow_version` eval arm, exactly as the binary
  // `critic` does. The binary `CRITIC_SYSTEM` stays the live blob-arm default (decision 3).
  ['graded-critic', GRADED_CRITIC_SYSTEM],
];

/** The content hash of every stage system prompt (name-keyed, sorted for order-independence). */
export const PROMPTS_VERSION: string = contentHash(
  ...[...SYSTEM_PROMPTS]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .flatMap(([name, text]) => [name, text]),
).slice(0, 16);
