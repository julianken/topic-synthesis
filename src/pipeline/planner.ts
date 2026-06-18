import { PlanSchema, type Plan, type TopicRequest } from '../domain/stages';
import type { LlmCallRecord } from '../llm/client';
import { STAGE_MODELS } from '../llm/models';
import { defaultDeps, type StageDeps } from './deps';

const PLANNER_SYSTEM =
  'You are a curriculum architect. Decompose a topic into a focused learning scope, the ' +
  'key subtopics a learner must master, and the open research questions whose grounded ' +
  'answers the curriculum must teach. Tailor everything to the level and audience.';

function plannerPrompt(req: TopicRequest): string {
  const { topic, settings } = req;
  return [
    `Topic: ${topic}`,
    `Level: ${settings.level}   Depth: ${settings.depth}/5   Audience: ${settings.audience}`,
    '',
    'Produce a one-sentence scope, the essential subtopics (about 5-12), and the research',
    'questions (about 5-12) whose grounded answers the pages will teach.',
  ].join('\n');
}

export interface PlanOutput {
  plan: Plan;
  records: LlmCallRecord[];
}

/** Planner (Opus): topic + settings → coverage outline + research questions. */
export async function plan(req: TopicRequest, deps: StageDeps = defaultDeps): Promise<PlanOutput> {
  const { object, record } = await deps.completeObject({
    model: STAGE_MODELS.planner,
    system: PLANNER_SYSTEM,
    prompt: plannerPrompt(req),
    schema: PlanSchema,
  });
  return { plan: object, records: [record] };
}
