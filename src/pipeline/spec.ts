import { PageSpecSchema, type LessonBrief, type PageSpec } from '../domain/stages';
import type { Settings } from '../domain/settings';
import type { LlmCallRecord } from '../llm/client';
import { STAGE_MODELS, type StageModel } from '../llm/models';
import { defaultDeps, type StageDeps } from './deps';

export interface SpecInput {
  /** The Analysis→Synthesis contract: "what to teach" (learningGoal + grounded findings). */
  brief: LessonBrief;
  settings: Settings;
}

export const SPEC_SYSTEM =
  'You are an instructional designer. Plan ONE interactive learning page for a lesson: the best ' +
  'interaction kind, an accessibility contract (text alternative + keyboard support stated up ' +
  'front, not retrofitted), and which sources it cites. The learning goal is given — design the ' +
  'page that teaches it.';

function specPrompt(input: SpecInput): string {
  const { brief, settings } = input;
  // Feed the grounded findings (claim + source) into the prompt, not just a url/title list,
  // so interaction-kind selection is no longer fact-starved — this is the fact-starvation fix.
  const findings = brief.findings
    .map((f, i) => `[${i}] ${f.claim}  (${f.source.title} — ${f.source.url})`)
    .join('\n');
  return [
    `Learning goal: ${brief.learningGoal}`,
    `Key points: ${brief.keyPoints.join('; ') || '(none)'}`,
    `Audience: ${brief.audience} (level ${settings.level}, depth ${settings.depth}/5).`,
    '',
    'Grounded findings to teach from and cite:',
    findings || '(none)',
    '',
    'Plan the page: the interaction kind (canvas | svg | html), a concrete accessibility',
    'contract, and the citations (choose from the findings’ sources above).',
  ].join('\n');
}

export interface SpecOutput {
  spec: PageSpec;
  records: LlmCallRecord[];
}

/** Spec (Sonnet): a LessonBrief → the plan for one accessible, interactive page. */
export async function spec(
  input: SpecInput,
  deps: StageDeps = defaultDeps,
  model: StageModel = STAGE_MODELS.spec,
): Promise<SpecOutput> {
  const { object, record } = await deps.completeObject({
    model,
    system: SPEC_SYSTEM,
    prompt: specPrompt(input),
    schema: PageSpecSchema,
  });
  // Keep only citations pointing at a real offered source — the same anti-fabrication
  // discipline the researcher/brief apply. The offered set is the brief findings' sources,
  // so the spec can't (re)introduce an invented citation.
  const offered = new Set(input.brief.findings.map((f) => f.source.url));
  const citations = object.citations.filter((c) => offered.has(c.url));
  return { spec: { ...object, citations }, records: [record] };
}
