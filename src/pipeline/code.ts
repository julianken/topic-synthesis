import type { PageArtifact, PageSpec } from '../domain/stages';
import type { LlmCallRecord } from '../llm/client';
import { STAGE_MODELS } from '../llm/models';
import { defaultDeps, type StageDeps } from './deps';

const CODE_SYSTEM =
  'You are a front-end engineer. Generate ONE standalone, self-contained HTML document ' +
  '(inline CSS + JS, no external dependencies or network requests) that teaches the concept ' +
  'interactively and satisfies the accessibility contract exactly. Output only the HTML document.';

function codePrompt(spec: PageSpec): string {
  return [
    `Learning goal: ${spec.learningGoal}`,
    `Interaction kind: ${spec.interactionKind}`,
    `Accessibility contract (MUST satisfy): ${spec.a11yContract}`,
    `Citations: ${spec.citations.map((c) => c.url).join(', ') || '(none)'}`,
    '',
    'Generate a complete standalone HTML document (<!doctype html> … </html>) with inline CSS',
    'and JS. No external scripts or network requests. The interaction must be keyboard',
    'accessible and include the text alternative described in the accessibility contract.',
  ].join('\n');
}

export interface CodeOutput {
  artifact: PageArtifact;
  records: LlmCallRecord[];
}

/**
 * Code (Sonnet): a page spec → a standalone interactive HTML artifact. HTML is free text
 * (not structured output). The raw HTML is sanitized (DOMPurify) at store/serve time in the
 * app layer, not here. A larger output budget is used since a full page can be sizable.
 */
export async function code(spec: PageSpec, deps: StageDeps = defaultDeps): Promise<CodeOutput> {
  const { text, record } = await deps.complete({
    model: STAGE_MODELS.code,
    system: CODE_SYSTEM,
    prompt: codePrompt(spec),
    maxTokens: 16000,
  });
  const artifact: PageArtifact = { nodeSlug: spec.nodeSlug, html: text, spec };
  return { artifact, records: [record] };
}
