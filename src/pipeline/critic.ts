import { CriticVerdictSchema, type CritiquedArtifact, type PageArtifact } from '../domain/stages';
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
