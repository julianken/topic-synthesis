import { z } from 'zod';
import {
  LessonBriefSchema,
  type LessonBrief,
  type Plan,
  type Research,
} from '../domain/stages';
import type { Settings } from '../domain/settings';
import type { LlmCallRecord } from '../llm/client';
import { STAGE_MODELS, type StageModel } from '../llm/models';
import { defaultDeps, type StageDeps } from './deps';

export interface BriefInput {
  plan: Plan;
  research: Research[];
  settings: Settings;
}

export const BRIEF_SYSTEM =
  'You are an instructional architect. From a topic plan and the grounded research, write ' +
  'ONE lesson brief: the single learning goal, the key points a learner must master, and the ' +
  'grounded findings (each a claim with its supporting source) that the lesson should teach. ' +
  'State only claims supported by a provided source — never invent a source.';

function briefPrompt(input: BriefInput): string {
  const { plan, research, settings } = input;
  const blocks = research.map((r) => {
    // Render each finding with its source inline so the model emits a self-contained
    // {claim, source} — the brief carries no separate sources array across the seam.
    const findings = r.findings
      .map((f) => {
        const src = r.sources[f.sourceIndex];
        return src ? `  - ${f.claim}  [${src.title} — ${src.url}]` : `  - ${f.claim}`;
      })
      .join('\n');
    return `## ${r.subtopic}\n${findings || '  (no grounded findings)'}`;
  });
  return [
    `Scope: ${plan.scope}`,
    `Subtopics: ${plan.subtopics.join(', ')}`,
    `Audience: ${settings.audience} (level ${settings.level}, depth ${settings.depth}/5).`,
    '',
    'Grounded research findings (cite ONLY these sources, by their title/url):',
    '',
    blocks.join('\n\n'),
    '',
    'Produce a lesson brief: one learningGoal, the keyPoints, and the findings — each finding a',
    'claim plus the source (title + url) drawn from the grounded research above. Use the audience',
    'framing. Do not invent a source not present in the research.',
  ].join('\n');
}

export interface BriefOutput {
  brief: LessonBrief;
  records: LlmCallRecord[];
}

/**
 * The validate-on-resume schema for the `brief` engine step (issue #50). The step memoizes the whole
 * `BriefOutput` envelope, so the validator must match THAT shape — but the load-bearing arm is
 * `brief: LessonBriefSchema`, the Analysis→Synthesis contract: a cached brief whose shape no longer
 * matches the current `LessonBriefSchema` (e.g. after a deploy changed the contract mid-run) fails
 * this parse, so `GcpEngine.durableStep` treats it as a cache miss and re-runs — a stale-shape brief
 * can never feed `spec`. `records` is the LLM-call metadata envelope, validated loosely (not the
 * contract under deploy-drift risk; `rawUsage` is `unknown`). This arms a REAL check, not a no-op.
 */
export const BriefOutputSchema: z.ZodType<BriefOutput> = z.object({
  brief: LessonBriefSchema,
  records: z.array(
    z.object({
      providerModel: z.string(),
      inputTokens: z.number(),
      outputTokens: z.number(),
      costUsd: z.number(),
      rawUsage: z.unknown(),
      finishReason: z.string(),
    }),
  ),
});

/**
 * Brief (Opus, Analysis): plan + research[] → ONE LessonBrief, the single object that
 * crosses the Analysis→Synthesis seam. Mirrors planner/graph — `(input, deps, model)`,
 * a Zod-validated output, unit-testable with no live model. Applies the same
 * anti-fabrication discipline the researcher/spec use: a finding whose source is not
 * present in the input research[] is dropped, so the brief can't carry an invented citation.
 */
export async function brief(
  input: BriefInput,
  deps: StageDeps = defaultDeps,
  model: StageModel = STAGE_MODELS.brief,
): Promise<BriefOutput> {
  const { object, record } = await deps.completeObject({
    model,
    system: BRIEF_SYSTEM,
    prompt: briefPrompt(input),
    schema: LessonBriefSchema,
  });
  // Anti-fabrication: keep only findings whose source url is among the REAL retrieved
  // sources across the input research[]. Same teeth as the researcher's index filter and
  // the spec's citation filter — a hallucinated source can't survive into the seam.
  const offered = new Set(input.research.flatMap((r) => r.sources.map((s) => s.url)));
  const findings = object.findings.filter((f) => offered.has(f.source.url));
  return { brief: { ...object, findings }, records: [record] };
}
