import { z } from 'zod';
import type { LessonBrief } from '../domain/stages';
import type { LlmCallRecord } from '../llm/client';
import { STAGE_MODELS, type StageModel } from '../llm/models';
import { defaultDeps, type StageDeps } from '../pipeline/deps';

/**
 * The LLM-judge over a `LessonBrief` — a post-pipeline QUALITY scorer for the Analysis phase,
 * NOT a pipeline stage (it scores the brief, it doesn't produce it; the `Stage` union stays the
 * closed 7-member set — planner/researcher/graph/brief/spec/code/critic). It lives in `src/trace/`
 * because it produces the analysis-row scores the
 * trace records, and it imports only the LLM client / `StageDeps` — NEVER `@eleatic/eval` — so the
 * `eleatic-only-in-trace` import fence is unaffected and `reduce.ts` stays pure (it consumes the
 * judge's numbers via `TraceMeta`, it never calls the judge).
 *
 * It runs ONLY on the eval/`--trace` path: the deployed app injects `noopSink` and never invokes it,
 * so no judge spend happens in production. Its `LlmCallRecord` is surfaced to the caller so the CLI
 * folds the judge's cost into the run's row-cost-sums-to-run-cost accounting (a judge span on the
 * `_analysis` phase) — judge spend never escapes the trace's cost invariant.
 */

export const JUDGE_SYSTEM =
  'You are a strict instructional-quality judge. Score a lesson brief on three axes, each a number ' +
  'in [0,1]: groundedness (every key point and claim is supported by the cited findings — penalize ' +
  'unsupported or invented claims), goalClarity (the learning goal is sharp, singular, and ' +
  'teachable — penalize vague or compound goals), and audienceFit (the goal and key points match ' +
  'the stated audience framing). Be discriminating: reserve high scores for briefs that clearly ' +
  'satisfy the axis. Return only the three numbers.';

/** The judge's verdict — three quality sub-scores in [0,1]. Keys become the analysis-row scores. */
export const JudgeVerdictSchema = z.object({
  groundedness: z.number().min(0).max(1),
  goalClarity: z.number().min(0).max(1),
  audienceFit: z.number().min(0).max(1),
});
export type JudgeVerdict = z.infer<typeof JudgeVerdictSchema>;

function judgePrompt(brief: LessonBrief): string {
  const findings = brief.findings
    .map((f) => `  - ${f.claim}  [${f.source.title} — ${f.source.url}]`)
    .join('\n');
  return [
    `Audience: ${brief.audience}`,
    `Learning goal: ${brief.learningGoal}`,
    '',
    'Key points:',
    ...brief.keyPoints.map((p) => `  - ${p}`),
    '',
    'Cited findings (claim + source):',
    findings || '  (none)',
    '',
    'Score groundedness, goalClarity, and audienceFit — each a number in [0,1].',
  ].join('\n');
}

export interface JudgeResult {
  /** The quality sub-scores (groundedness/goalClarity/audienceFit), merged onto the `_analysis` row. */
  scores: Record<string, number>;
  /** The judge call's cost/token record — the caller folds it into the cost invariant. */
  record: LlmCallRecord;
}

/**
 * Judge a `LessonBrief` for quality (groundedness / goal clarity / audience fit). Mirrors a pipeline
 * stage's shape — `(input, deps, model)` over an injected `StageDeps` so a test injects a fake
 * `completeObject` and runs with no live model — but it is invoked from the CLI/eval path, never from
 * `runPipeline`/`runLesson`. Returns the numeric sub-scores plus the call's `LlmCallRecord`.
 *
 * `model` defaults to `STAGE_MODELS.critic` (opus), but the CLI now threads the run's RESOLVED judge
 * model through `reduceRunTrace` (#57 SUGGESTION #2) — so a `--cheap` run judges on the cheap CRITIC
 * model (Sonnet, per `cheapModels()`) instead of always paying for opus while the rest of that run is
 * on its cheap tier.
 */
export async function judgeBrief(
  brief: LessonBrief,
  deps: StageDeps = defaultDeps,
  model: StageModel = STAGE_MODELS.critic,
): Promise<JudgeResult> {
  const { object, record } = await deps.completeObject({
    model,
    system: JUDGE_SYSTEM,
    prompt: judgePrompt(brief),
    schema: JudgeVerdictSchema,
  });
  return { scores: { ...object }, record };
}
