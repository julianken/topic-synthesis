// DORMANT(curriculum-wrapper — ADR-0003 / epic #52): the `graph` stage builds the prerequisite DAG
// used ONLY by the curriculum path (`runPipeline`). The live single-lesson path (`runLesson`) never
// calls it. RETAINED for the future curriculum-wrapper milestone; still unit-tested. See ADR-0003.
import { PrereqGraphSchema, type PrereqGraph, type Research } from '../domain/stages';
import type { LlmCallRecord } from '../llm/client';
import { STAGE_MODELS, type StageModel } from '../llm/models';
import { defaultDeps, type StageDeps } from './deps';

export const GRAPH_SYSTEM =
  'You are a learning-science expert. From researched subtopics, build a prerequisite ' +
  'graph of concept nodes: a directed ACYCLIC graph where an edge from A to B means A is ' +
  'a prerequisite of B. Judge how well the research covers each node (0..1).';

function graphPrompt(research: Research[]): string {
  const blocks = research.map((r) => {
    const findings = r.findings.map((f) => `  - ${f.claim}`).join('\n');
    return `## ${r.subtopic} (${r.sources.length} sources)\n${findings || '  (no grounded findings)'}`;
  });
  return [
    'Researched subtopics and their grounded findings:',
    '',
    blocks.join('\n\n'),
    '',
    'Produce concept nodes — each with a slug, title, summary, and coverageConfidence',
    '(0..1) reflecting how well the findings cover it — and prerequisite edges {from, to}',
    'referencing node slugs. The edges MUST form a DAG (no cycles). Set coverageConfidence',
    'low for thinly-covered nodes so the gate can route them to a text/placeholder page.',
  ].join('\n');
}

export interface GraphOutput {
  graph: PrereqGraph;
  records: LlmCallRecord[];
}

/** Graph-builder (Opus): research → prerequisite DAG + per-node coverage confidence. */
export async function buildGraph(
  research: Research[],
  deps: StageDeps = defaultDeps,
  model: StageModel = STAGE_MODELS.graph,
): Promise<GraphOutput> {
  const { object, record } = await deps.completeObject({
    model,
    system: GRAPH_SYSTEM,
    prompt: graphPrompt(research),
    schema: PrereqGraphSchema,
  });
  return { graph: object, records: [record] };
}
