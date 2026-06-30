import type { PageArtifact, PageSpec } from '../domain/stages';
import { DEFAULT_CODE_DEADLINE_MS, type LlmCallRecord, withResilientRetry } from '../llm/client';
import { STAGE_MODELS, type StageModel } from '../llm/models';
import { defaultDeps, type StageDeps } from './deps';

/** The `code` output budget. A full standalone interactive page can be sizable; the cheap profile builds
 *  `code` on Sonnet (not Haiku) precisely so this budget is available. */
const CODE_MAX_TOKENS = 32_000;

/**
 * The raised cap for the LENGTH-retry (issue #187): one more attempt when a generation truncates at
 * `CODE_MAX_TOKENS`. Bounded WELL under both models' 64K output cap, so the retry has real headroom.
 *
 * Deliberately NO Sonnet→Haiku failover here (research re-scope, issue #187): both `claude-sonnet-4-6`
 * and `claude-haiku-4-5` cap at 64K output and `code` already budgets 32K, so a Haiku attempt adds NO
 * headroom — it would re-trip `finishReason==='length'` (verbosity/instruction-following, not a ceiling)
 * or ship a worse page, while wasting ~$0.16 of Haiku spend on top of the Sonnet attempt. A model
 * failover is reserved for the small structured ANALYSIS stages only — never for `code`.
 */
const CODE_RETRY_MAX_TOKENS = 48_000;

/**
 * CODE_SYSTEM (Sonnet) — the blob-arm synthesis prompt. Beyond generating the standalone interactive
 * lesson it instructs ONE content-internal addition: the decision-12 coordinate-only `postMessage`
 * SENDER (PR-F) that lets the reader CHROME light up its reading-progress bar, section-jump, and the
 * apparatus panel WITHOUT ever reading this opaque-origin frame's DOM. The receive side is
 * `src/app/lesson/[id]/lesson-message.ts` (`validateMessage` — identity-checked, untrusted-data sanitized).
 * The sender is the ONLY pipeline change PR-F makes; it lands INSIDE the sandboxed HTML and
 * does NOT relax the sandbox or the `ARTIFACT_CSP` (the trust boundary is the sandbox, not this prompt).
 * Editing this prompt auto-bumps `PROMPTS_VERSION` (it is hashed in `src/pipeline/prompts.ts`).
 */
export const CODE_SYSTEM = [
  'You are a front-end engineer. Generate ONE standalone, self-contained HTML document (inline CSS +',
  'JS, no external dependencies, assets, or network requests) that teaches the concept interactively',
  'and satisfies the accessibility contract EXACTLY (keyboard operability + the stated text',
  'alternative are generation targets, stated up front, not retrofitted). Output ONLY the HTML',
  'document. Organize the lesson into `<section>` blocks, each with a heading.',
  '',
  'PROGRESS + APPARATUS postMessage (HARD, non-negotiable — decision-12 path a, PR-F): emit a small',
  'inline script that posts COORDINATE-ONLY data to the parent so the (host) reader shell can render a',
  'reading-progress bar, a section-jump rail, and an apparatus panel WITHOUT reading this frame. The',
  'sender MUST:',
  '  (1) build `sections` — an array of `{ id, title }` from the rendered `<section>` headings (give',
  '      each `<section>` a stable `id`; `title` is the heading TEXT), and a `scrollProgress` scalar in',
  '      0..1 (how far the reader has scrolled, 0 at top, 1 at bottom);',
  '  (2) build `apparatus` — an object serializing the apparatus the lesson ALREADY contains, as plain',
  '      DATA (strings only, NEVER DOM nodes, NEVER HTML markup): `glosses` = `[{ term, definition }]`',
  '      (the key terms + their plain-text definitions), `figures` = `[{ caption }]` (each figure’s',
  '      plain-text caption — NOT the figure itself), `sources` = `[{ title, url }]` (each cited',
  '      source’s title + its absolute http(s) URL), `checks` = `[{ prompt, answer }]` (each',
  '      self-check’s question + its plain-text answer), and `takeaways` = `[string]` (the recap',
  '      bullets). OMIT any field the lesson has none of — every field is optional; send only what the',
  '      lesson genuinely contains, never a fabricated or placeholder value;',
  '  (3) post the EXACT shape `{ type: "lesson:progress", sections, scrollProgress, apparatus }` to',
  '      `window.parent` via `window.parent.postMessage(msg, targetOrigin)`. Compute `apparatus` ONCE',
  '      and include it in EVERY post (so the panel never flickers between data and empty);',
  '  (4) target a KNOWN origin string, NEVER "*" — derive it from `document.referrer`',
  '      (`new URL(document.referrer).origin`), falling back to the literal opaque-origin token "null"',
  '      when there is no referrer;',
  '  (5) post once on load AND on scroll (rAF-throttled or debounced). It reads ONLY this document and',
  '      sends coordinates + serialized text — never HTML, never a DOM node reference. Wrap the posting',
  '      in a try/catch so a frame-less standalone open is harmless.',
].join('\n');

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
  // PR-1: a periodic live-progress hook the streaming call fires per delta — the live code-phase UI
  // (PR-4 / #180) wires it; every other caller leaves it undefined and is unaffected. The payload carries
  // `maxTokens` (the resolved cap = the 32000 below) so the consuming sink computes a bounded fraction
  // without re-hardcoding it.
  onProgress?: (p: { outputTokens: number; elapsedMs: number; phase: 'prefill' | 'generating'; maxTokens: number }) => void,
): Promise<CodeOutput> {
  // ONE deadline shared across EVERY attempt (transient retries + the length-retry) + their backoffs, so
  // total elapsed is bounded by a single #186 deadline rather than resetting per attempt (issue #187).
  const signal = AbortSignal.timeout(DEFAULT_CODE_DEADLINE_MS);
  const { text, record } = await withResilientRetry(
    () =>
      deps.streamComplete(
        {
          model,
          system: CODE_SYSTEM,
          prompt: codePrompt(spec, learningGoal),
          // Truncation degrades a single lesson to 'soon', so give the page room to finish. We STREAM it
          // (PR-1) to capture per-call timing (ttftMs/genMs) + drive the live progress hook.
          maxTokens: CODE_MAX_TOKENS,
          // Salvage a NEAR-MISS truncation: one raised-cap retry on finishReason==='length' (#187).
          retryAtMaxTokens: CODE_RETRY_MAX_TOKENS,
          signal,
        },
        onProgress,
      ),
    // Smart transient retry (429/529/5xx) with full-jitter backoff, all inside the one shared deadline.
    { signal },
  );
  const artifact: PageArtifact = {
    nodeSlug: spec.nodeSlug,
    html: stripCodeFence(text),
    learningGoal,
    spec,
  };
  return { artifact, records: [record] };
}
