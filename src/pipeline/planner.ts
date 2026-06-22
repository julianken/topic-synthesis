import { PlanSchema, type Plan, type TopicRequest } from '../domain/stages';
import type { LlmCallRecord } from '../llm/client';
import { STAGE_MODELS, type StageModel } from '../llm/models';
import { defaultDeps, type StageDeps } from './deps';

export const PLANNER_SYSTEM =
  'You are an instructional architect scoping ONE lesson. From a topic, define the focused ' +
  'learning scope of that single lesson, the key subtopics it must cover, and the open research ' +
  'questions whose grounded answers that lesson must teach. Cast a wide net of subtopics and ' +
  'questions so the lesson is well-supported. Tailor everything to the level and audience.';

function plannerPrompt(req: TopicRequest): string {
  const { topic, settings } = req;
  return [
    `Topic: ${topic}`,
    `Level: ${settings.level}   Depth: ${settings.depth}/5   Audience: ${settings.audience}`,
    '',
    'Produce a one-sentence scope for one lesson, the essential subtopics it must cover (about',
    '5-12), and the research questions (about 5-12) whose grounded answers that lesson must teach.',
  ].join('\n');
}

export interface PlanOutput {
  plan: Plan;
  records: LlmCallRecord[];
}

/** Planner (Opus): topic + settings → coverage outline + research questions. */
export async function plan(
  req: TopicRequest,
  deps: StageDeps = defaultDeps,
  model: StageModel = STAGE_MODELS.planner,
): Promise<PlanOutput> {
  const { object, record } = await deps.completeObject({
    model,
    system: PLANNER_SYSTEM,
    prompt: plannerPrompt(req),
    schema: PlanSchema,
  });
  return { plan: object, records: [record] };
}
