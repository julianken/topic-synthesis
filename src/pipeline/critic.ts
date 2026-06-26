import {
  CriticVerdictSchema,
  type CritiquedArtifact,
  derivePassed,
  GradedCriticVerdictSchema,
  type PageArtifact,
} from '../domain/stages';
import type { LlmCallRecord } from '../llm/client';
import { STAGE_MODELS, type StageModel } from '../llm/models';
import { defaultDeps, type StageDeps } from './deps';

export const CRITIC_SYSTEM =
  'You are a strict reviewer. Judge whether a generated learning page meets its spec: it ' +
  'teaches the learning goal, is genuinely interactive, satisfies the accessibility contract, ' +
  'and is self-contained. Pass only if all hold. Give a terse critique either way.';

function criticPrompt(artifact: PageArtifact): string {
  return [
    `Learning goal: ${artifact.learningGoal}`,
    `Interaction kind: ${artifact.spec.interactionKind}`,
    `Accessibility contract: ${artifact.spec.a11yContract}`,
    '',
    'Generated HTML:',
    '```html',
    artifact.html,
    '```',
    '',
    'Does it meet the spec? Return passed (boolean) and a terse critique.',
  ].join('\n');
}

export interface CriticOutput {
  artifact: CritiquedArtifact;
  records: LlmCallRecord[];
}

/** Critic (Opus, one pass): judge an artifact against its spec → pass/fail + critique. */
export async function critique(
  artifact: PageArtifact,
  deps: StageDeps = defaultDeps,
  model: StageModel = STAGE_MODELS.critic,
): Promise<CriticOutput> {
  const { object, record } = await deps.completeObject({
    model,
    system: CRITIC_SYSTEM,
    prompt: criticPrompt(artifact),
    schema: CriticVerdictSchema,
  });
  const critiqued: CritiquedArtifact = { ...artifact, passed: object.passed, critique: object.critique };
  return { artifact: critiqued, records: [record] };
}

// ── graded critic (the v11 StageBundle.critic arm — program decision 7) ────────
/**
 * The graded-critic prompt. PLACEHOLDER — it requests the v2 schema but the ledger-aware
 * grading body (grade each named learning-efficacy + ledger-conformance axis against
 * DESIGN.md → `## Lesson layout`) is TS-7's deliverable. This issue ships the schema + the
 * arm-fn shell + the derived-threshold; TS-7 fleshes out this prompt and seeds the fixture
 * corpus. Do NOT restate the program decisions or the ledger here — link, don't fork.
 */
export const GRADED_CRITIC_SYSTEM =
  'You are a strict learning-design reviewer. Grade a generated lesson page against named ' +
  'learning-efficacy criteria and the statically-checkable lesson-layout ledger, scoring each ' +
  'sub-criterion 0..1 with a terse note. TS-7 fills in the full ledger-aware rubric; until then ' +
  'grade conservatively. (Do NOT decide overall pass/fail — that is derived from the sub-scores.)';

/**
 * The GRADED critic arm fn (program decision 7). Same `(artifact, deps, model) =>
 * Promise<CriticOutput>` signature as `critique`, so it is a drop-in `StageBundle.critic`
 * override for the v11 arm; `defaultStages.critic` stays the binary `critique` (the blob
 * arm is the live default — the decision-3/7 kill-switch). It requests the v2 graded schema,
 * DERIVES `passed` from the sub-scores (overwriting the model's self-asserted boolean — the
 * gate stays computed, not LLM-asserted), and returns a `CritiquedArtifact` carrying the
 * sub-scores under `scores`.
 */
export async function gradedCritique(
  artifact: PageArtifact,
  deps: StageDeps = defaultDeps,
  model: StageModel = STAGE_MODELS.critic,
): Promise<CriticOutput> {
  const { object, record } = await deps.completeObject({
    model,
    system: GRADED_CRITIC_SYSTEM,
    prompt: criticPrompt(artifact),
    schema: GradedCriticVerdictSchema,
  });
  const passed = derivePassed(object);
  const critiqued: CritiquedArtifact = {
    ...artifact,
    passed,
    critique: object.critique,
    scores: { learningEfficacy: object.learningEfficacy, ledgerConformance: object.ledgerConformance },
  };
  return { artifact: critiqued, records: [record] };
}
