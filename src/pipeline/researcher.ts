import { FindingsSchema, type Research } from '../domain/stages';
import type { Settings } from '../domain/settings';
import type { LlmCallRecord } from '../llm/client';
import { STAGE_MODELS, type StageModel } from '../llm/models';
import { defaultDeps, type StageDeps } from './deps';

export interface ResearchInput {
  subtopic: string;
  question: string;
  settings: Settings;
  /** Cap on web_search uses for this question (defaults to searchWeb's own default). */
  maxSearches?: number;
}

export const RESEARCH_SYSTEM =
  'You are a research assistant. Use web search to gather current, authoritative ' +
  'information and synthesize a grounded answer. State only claims supported by the pages ' +
  'you actually retrieved — never invent a source.';

export const STRUCTURE_SYSTEM =
  'You extract grounded findings from researched material. Cite ONLY the numbered sources ' +
  'provided, by their index — never invent a source or cite an index that is not listed.';

function searchPrompt(input: ResearchInput): string {
  return [
    `Research question: ${input.question}`,
    `Subtopic: ${input.subtopic}`,
    `Audience: ${input.settings.audience} (level ${input.settings.level}).`,
    'Search the web and synthesize a grounded, citable answer.',
  ].join('\n');
}

function structurePrompt(input: ResearchInput, synthesis: string, sources: { url: string; title: string }[]): string {
  const list = sources.map((s, i) => `[${i}] ${s.title} — ${s.url}`).join('\n');
  return [
    `Subtopic: ${input.subtopic}`,
    '',
    'Retrieved sources — cite ONLY these, by their index:',
    list || '(no sources retrieved)',
    '',
    'Grounded synthesis:',
    synthesis,
    '',
    'Extract the key findings. Each finding is a claim plus the index of the retrieved',
    'source that supports it. Do not invent sources or cite an index not listed above.',
  ].join('\n');
}

export interface ResearchOutput {
  research: Research;
  records: LlmCallRecord[];
}

/**
 * Researcher (Sonnet): web-grounded retrieval, then a structuring pass that pins each
 * finding to a REAL retrieved source. The source list comes from the web search, never
 * the model, and findings that cite an out-of-range index are dropped — so a
 * hallucinated citation can't reach the graph. This is the teeth on the fabrication risk.
 */
export async function research(
  input: ResearchInput,
  deps: StageDeps = defaultDeps,
  model: StageModel = STAGE_MODELS.researcher,
): Promise<ResearchOutput> {
  const search = await deps.searchWeb({
    model,
    system: RESEARCH_SYSTEM,
    prompt: searchPrompt(input),
    ...(input.maxSearches !== undefined ? { maxSearches: input.maxSearches } : {}),
  });
  const structured = await deps.completeObject({
    model,
    system: STRUCTURE_SYSTEM,
    prompt: structurePrompt(input, search.text, search.sources),
    schema: FindingsSchema,
  });
  const findings = structured.object.findings.filter(
    (f) => f.sourceIndex >= 0 && f.sourceIndex < search.sources.length,
  );
  const research: Research = {
    subtopic: input.subtopic,
    sources: search.sources,
    findings,
  };
  return { research, records: [search.record, structured.record] };
}
