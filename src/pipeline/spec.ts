import { PageSpecSchema, type GatedNode, type PageSpec, type Source } from '../domain/stages';
import type { Settings } from '../domain/settings';
import type { LlmCallRecord } from '../llm/client';
import { STAGE_MODELS } from '../llm/models';
import { defaultDeps, type StageDeps } from './deps';

export interface SpecInput {
  node: GatedNode;
  settings: Settings;
  /** Grounded sources available to cite for this node (from the research). */
  sources: Source[];
}

const SPEC_SYSTEM =
  'You are an instructional designer. Plan ONE interactive learning page for a concept: its ' +
  'single learning goal, the best interaction kind, an accessibility contract (text alternative ' +
  '+ keyboard support stated up front, not retrofitted), and which sources it cites.';

function specPrompt(input: SpecInput): string {
  const { node, settings, sources } = input;
  const list = sources.map((s, i) => `[${i}] ${s.title} — ${s.url}`).join('\n');
  return [
    `Concept: ${node.title} (slug: ${node.slug})`,
    `Summary: ${node.summary}`,
    `Audience: ${settings.audience} (level ${settings.level}, depth ${settings.depth}/5).`,
    '',
    'Available grounded sources to cite:',
    list || '(none)',
    '',
    'Plan the page: one learning goal, the interaction kind (canvas | svg | html), a concrete',
    'accessibility contract, and the citations (choose from the sources above).',
    `Set nodeSlug to "${node.slug}".`,
  ].join('\n');
}

export interface SpecOutput {
  spec: PageSpec;
  records: LlmCallRecord[];
}

/** Spec (Sonnet): a gated node → the plan for one accessible, interactive page. */
export async function spec(input: SpecInput, deps: StageDeps = defaultDeps): Promise<SpecOutput> {
  const { object, record } = await deps.completeObject({
    model: STAGE_MODELS.spec,
    system: SPEC_SYSTEM,
    prompt: specPrompt(input),
    schema: PageSpecSchema,
  });
  // Keep only citations pointing at a real offered source — the same anti-fabrication
  // discipline the researcher applies, so the spec can't (re)introduce an invented citation.
  const offered = new Set(input.sources.map((s) => s.url));
  const citations = object.citations.filter((c) => offered.has(c.url));
  return { spec: { ...object, citations }, records: [record] };
}
