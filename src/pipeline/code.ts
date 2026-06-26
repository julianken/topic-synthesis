import type { PageArtifact, PageSpec } from '../domain/stages';
import type { LlmCallRecord } from '../llm/client';
import { STAGE_MODELS, type StageModel } from '../llm/models';
import { defaultDeps, type StageDeps } from './deps';

export const CODE_SYSTEM =
  'You are a front-end engineer. Generate ONE standalone, self-contained HTML document ' +
  '(inline CSS + JS, no external dependencies or network requests) that teaches the concept ' +
  'interactively and satisfies the accessibility contract exactly. Output only the HTML document.';

// TS-11 will give `code` a v11 LessonSpec branch (sectioned apparatus); today `code` is the
// BLOB-arm stage and takes the flat PageSpec — so its input type stays PageSpec, NOT the union.
function codePrompt(spec: PageSpec, learningGoal: string): string {
  return [
    `Learning goal: ${learningGoal}`,
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
/** Strip a Markdown code fence the model sometimes wraps the HTML in (```html … ```),
 *  despite being told to output only the document — otherwise the artifact is malformed. */
export function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:html)?\s*\n([\s\S]*?)\n```$/);
  return fenced?.[1]?.trim() ?? trimmed;
}

export async function code(
  spec: PageSpec,
  learningGoal: string,
  deps: StageDeps = defaultDeps,
  model: StageModel = STAGE_MODELS.code,
): Promise<CodeOutput> {
  const { text, record } = await deps.complete({
    model,
    system: CODE_SYSTEM,
    prompt: codePrompt(spec, learningGoal),
    // A full standalone interactive page can exceed a smaller cap; the cheap profile builds `code`
    // on Sonnet (not Haiku) precisely so this budget is available. Truncation degrades a single
    // lesson to 'soon', so give the page room to finish.
    maxTokens: 32000,
  });
  const artifact: PageArtifact = {
    nodeSlug: spec.nodeSlug,
    html: stripCodeFence(text),
    learningGoal,
    spec,
  };
  return { artifact, records: [record] };
}
