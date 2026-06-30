import type { LessonBrief } from '../domain/stages';
import { BatchClient, type BatchRequest } from '../llm/batch-client';
import { STAGE_MODELS, type StageModel } from '../llm/models';
import { JUDGE_SYSTEM, JudgeVerdictSchema, judgePrompt, type JudgeResult } from '../trace/judge';

/**
 * The OFFLINE multi-brief judge sweep (issue #188) — the one place the `BatchClient` is wired in.
 *
 * `judgeBrief` (`src/trace/judge.ts`) scores ONE brief per process on the synchronous client; the Batch
 * API's 50% discount only materializes across MANY requests in ONE submission. This driver fans a set of
 * briefs into a single batch, stacks 1-hour prompt caching on the shared `JUDGE_SYSTEM` prefix (so the
 * repeated prefix is billed once at the cached rate), and fans the verdicts back by `custom_id`. It is
 * eval/CLI-only and NEVER touches the live `api/generate → runLesson` path.
 */

/** One brief to judge, tagged with the `custom_id` results fan back to. */
export interface BatchedJudgeInput {
  customId: string;
  brief: LessonBrief;
}

/** A per-brief sweep result: the judge verdict, or an error (a failed batch entry or an unparseable
 *  verdict) — surfaced WITHOUT aborting the sweep, so one bad brief never drops the others. */
export type BatchedJudgeResult =
  | { customId: string; ok: true; result: JudgeResult }
  | { customId: string; ok: false; error: string };

/** The batch path can't constrain output to a Zod object the way `completeObject` does, so the prompt
 *  asks for a strict JSON object and the verdict is parsed + Zod-validated on the way back. */
const JUDGE_JSON_DIRECTIVE =
  '\n\nReturn ONLY a JSON object with exactly these numeric keys, each a number in [0,1], and no other ' +
  'text or markdown: {"groundedness": <number>, "goalClarity": <number>, "audienceFit": <number>}.';

/** Parse a batched judge text response into a verdict. Strips an optional ```json code fence, JSON-parses,
 *  then validates against `JudgeVerdictSchema`. Any failure returns `ok:false` (a failed-entry path). */
function parseVerdict(text: string): { ok: true; verdict: Record<string, number> } | { ok: false; error: string } {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  let raw: unknown;
  try {
    raw = JSON.parse(stripped);
  } catch {
    return { ok: false, error: `judge output was not JSON: ${text.slice(0, 120)}` };
  }
  const parsed = JudgeVerdictSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: `judge verdict failed validation: ${parsed.error.message}` };
  }
  return { ok: true, verdict: { ...parsed.data } };
}

/**
 * Judge a set of briefs in ONE batch. Submits every brief with the shared `JUDGE_SYSTEM` prefix marked
 * for 1-hour prompt caching, runs the batch to completion over the injected `BatchClient`, and returns a
 * `custom_id → result` map. Each succeeded entry's `JudgeResult.record` already carries the BATCH-rate
 * cost (the `BatchClient` computes it), so folding these into a trace ledger reflects the real discounted
 * bill. `model` defaults to `STAGE_MODELS.critic` (the judge's own default); a `--cheap` sweep threads the
 * cheap critic model, matching `judgeBrief`.
 */
export async function judgeBriefsBatched(
  inputs: BatchedJudgeInput[],
  batch: BatchClient,
  model: StageModel = STAGE_MODELS.critic,
): Promise<Map<string, BatchedJudgeResult>> {
  const requests: BatchRequest[] = inputs.map((i) => ({
    customId: i.customId,
    model,
    system: JUDGE_SYSTEM,
    prompt: judgePrompt(i.brief) + JUDGE_JSON_DIRECTIVE,
    cacheSystem: true, // 1-hour caching on the repeated JUDGE_SYSTEM prefix (issue #188 AC #4)
  }));
  const collected = await batch.run(requests);

  const out = new Map<string, BatchedJudgeResult>();
  for (const input of inputs) {
    const entry = collected.get(input.customId);
    if (entry === undefined) {
      out.set(input.customId, { customId: input.customId, ok: false, error: 'no batch result for custom_id' });
      continue;
    }
    if (!entry.ok) {
      out.set(input.customId, { customId: input.customId, ok: false, error: entry.error });
      continue;
    }
    const parsed = parseVerdict(entry.text);
    if (!parsed.ok) {
      out.set(input.customId, { customId: input.customId, ok: false, error: parsed.error });
      continue;
    }
    out.set(input.customId, {
      customId: input.customId,
      ok: true,
      result: { scores: parsed.verdict, record: entry.record },
    });
  }
  return out;
}

/** The total BATCH-rate cost of the succeeded verdicts in a sweep — the saving made visible. */
export function sweepCostUsd(results: Map<string, BatchedJudgeResult>): number {
  let total = 0;
  for (const r of results.values()) {
    if (r.ok) total += r.result.record.costUsd;
  }
  return total;
}
