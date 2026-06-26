import { isLessonSpec, type LessonSpec, type PageArtifact, type PageSpec } from '../domain/stages';
import type { LlmCallRecord } from '../llm/client';
import { STAGE_MODELS, type StageModel } from '../llm/models';
import { defaultDeps, type StageDeps } from './deps';

/**
 * CODE_SYSTEM (Sonnet) — the v11 lesson-workspace contract (TS-12). It teaches the model the
 * LOCKED two-column teaching workspace from DESIGN.md `## Lesson layout` (DESIGN.md wins on any
 * design conflict — this prompt references that bar, it does NOT fork it) and states the three
 * hard, non-negotiable structural requirements the downstream graded critic (TS-7) statically
 * gates on and serve-time injection (TS-19) relies on:
 *   1. the named CSS-grid column-line literal `[screen-start] [read] [gap] [panel] [scrub]`,
 *   2. `var(--token)`-only theming with NO competing `:root` color/geometry literal block, and
 *   3. an inline `var(--token, <fallback>)` self-contained fallback so a doc still renders when no
 *      `:root` token block is injected at serve time (the no-injection path).
 *
 * One-pass emission (TS-5 verdict, #87): a real v11-shaped generated emission measured ~59–60% of
 * `maxTokens: 32000` with teaching density surviving, so this stays one `deps.complete` call and the
 * cap is NOT raised. The model does NOT reliably emit exact named tracks from a prose description
 * (TS-5 caveat 3: it dropped `[scrub]` for TCP), so the literal is stated VERBATIM and as a hard
 * requirement, paired with TS-7's critic which gates on the same literal — the emit-side half of the
 * enforce-the-literal pair. Editing this prompt auto-bumps `PROMPTS_VERSION` (it is hashed in
 * `src/pipeline/prompts.ts`) — the intentional v11 eval-arm change (ADR-0001 §5).
 */
export const CODE_SYSTEM = [
  'You are a front-end engineer. Generate ONE standalone, self-contained HTML document (inline',
  'CSS + JS, no external dependencies, assets, or network requests) that teaches the concept as the',
  'LOCKED v11 two-column teaching workspace. Output ONLY the HTML document.',
  '',
  'LAYOUT — the two-column workspace (DESIGN.md `## Lesson layout` is the source of truth):',
  '- A frozen reading spine (measure ~62ch, `var(--measure)`) on the left holding the prose, plus an',
  '  always-full apparatus panel (`var(--panel-w)`) docked beside it. Two columns MAX — never one,',
  '  never three. The whole reading+gap+panel assembly is width-capped (`var(--frame-max)`) and',
  '  centered with equal gutters; nothing is pinned to the true viewport edge.',
  '- STABLE SPINE (HARD rule, wins all conflicts): the reading column holds the EXACT same horizontal',
  '  position and width for every paragraph and across every section boundary — zero left-right',
  '  jitter. Each `<section>` declares its own grid (a per-section subgrid) so the spine stays stable.',
  '- A lone section with no apparatus center-aligns its TEXT within the fixed column; it never moves',
  '  the column.',
  '',
  'NAMED GRID (HARD, non-negotiable — emit the literal, do not paraphrase): the workspace grid MUST',
  'set `grid-template-columns` using the EXACT named column-line literal',
  '`[screen-start] [read] [gap] [panel] [scrub]` — verbatim, including the `[scrub]` line. The',
  '`[scrub]` track is REQUIRED (it reserves the in-iframe dot-scrubber rail inside the capped frame);',
  'omitting it is a hard failure. Place the literal in the grid container’s `grid-template-columns`.',
  '',
  'THEMING — `var(--token)` only (HARD): reference design tokens via `var(--token, <fallback>)` for',
  'ALL color and geometry. Do NOT emit a competing `:root { … }` color/geometry literal block — no',
  '`:root` rule that re-defines or hardcodes the design-system tokens (serve-time re-theming injects',
  'the canonical `:root` block, and a hardcoded one would defeat it). Instead, give every `var()` an',
  'INLINE FALLBACK — `var(--token, <fallback>)` — so the document still renders styled when no',
  '`:root` token block is injected (the self-contained no-injection path). Reference only these',
  'design-system tokens (DESIGN.md §0): colors `--bg-app`, `--bg-surface`, `--bg-raised`, `--border`,',
  '`--text`, `--text-muted`, `--text-faint`, `--accent`, `--accent-dim`, `--ok`, `--warn`, `--err`;',
  'geometry `--measure`, `--panel-w`, `--col-gap`, `--edge-gap`, `--scrub-w`, `--frame-max`.',
  '',
  'APPARATUS (DESIGN.md decision 1 — rendered apparatus, path B): densify each section with curated',
  'apparatus that ADDS what the prose does not already state (never decorative filler), capped at',
  '≤3 key-term glosses and ≤1 teaching mini-figure PER SECTION — never a dashboard. Glosses are',
  'rendered in the apparatus panel beside the term dotted in the prose; citations render beside their',
  'text in the panel, never a lone card in a void.',
  '',
  'RESPONSIVE: collapse to a single column at `@media (max-width: 900px)` (≤~900px), where the',
  'apparatus reflows directly under the prose it annotates; no horizontal overflow at 390px.',
  '',
  'ACCESSIBILITY: satisfy the stated accessibility contract EXACTLY — keyboard operability and the',
  'text alternative are generation targets, stated up front, not retrofitted.',
].join('\n');

/**
 * Build the per-spec `code` prompt. `code` takes the ARM-SCOPED `PageSpec | LessonSpec` union
 * (TS-12 — per the TS-10 review note: `code` narrows internally rather than the caller pre-throwing
 * a v11 spec); `isLessonSpec` narrows it. The v11 sectioned arm feeds the ordered typed sections
 * (kind + prose + the ≤1 apparatus component, with the answerable items the predict-gate/self-check
 * carry) so the workspace renders the planned pedagogy; the live BLOB arm keeps its flat
 * interaction-kind/a11y descriptor. Both arms inherit the workspace LAYOUT contract from CODE_SYSTEM
 * — the named grid, `var()`-only theming, the per-section cap, and the collapse query are stated
 * ONCE in the system prompt and apply whichever arm fed the spec.
 */
function codePrompt(spec: PageSpec | LessonSpec, learningGoal: string): string {
  const citations = spec.citations.map((c) => c.url).join(', ') || '(none)';
  if (isLessonSpec(spec)) {
    // The v11 sectioned arm: render the planned typed sections in reading order. Each section is the
    // reading-spine prose plus AT MOST ONE apparatus component (its kind + stated teaching purpose +,
    // on a predict-gate/self-check, the answerable { prompt, answer } the predict-then-reveal/check
    // is built from). Glosses + mini-figures are the rendered per-section apparatus (≤3 / ≤1 — the cap
    // in CODE_SYSTEM), NOT a spec field (path B). At least one predict-gate (predict → reveal) and one
    // self-check are present in the plan; render the predict-gate as a real predict-then-reveal gate.
    const sections = spec.sections
      .map((s, i) => {
        const c = s.component;
        const apparatus = c
          ? `\n    apparatus: ${c.kind} — purpose: ${c.teachingPurpose}` +
            (c.answerable
              ? `\n    answerable: prompt="${c.answerable.prompt}" answer="${c.answerable.answer}"`
              : '')
          : '\n    apparatus: (none — prose alone)';
        return `  [${i}] ${s.kind}: ${s.prose}${apparatus}`;
      })
      .join('\n');
    return [
      `Learning goal: ${learningGoal}`,
      `Accessibility contract (MUST satisfy): ${spec.a11yContract}`,
      `Citations: ${citations}`,
      '',
      'Render these typed sections in reading order as the two-column workspace (one `<section>` per',
      'entry, each on the stable spine; apparatus docked in the panel track):',
      sections,
      '',
      'A predict-gate apparatus MUST be a real predict-then-reveal gate (the learner commits a',
      'prediction BEFORE the reveal — never a free/un-gated reveal). A self-check is an answerable',
      'retrieval check with answer-specific feedback.',
    ].join('\n');
  }
  // The live BLOB arm (flat PageSpec): the existing interaction-kind/a11y descriptor, now rendered
  // INTO the v11 workspace (the layout contract lives in CODE_SYSTEM, shared across both arms).
  return [
    `Learning goal: ${learningGoal}`,
    `Interaction kind: ${spec.interactionKind}`,
    `Accessibility contract (MUST satisfy): ${spec.a11yContract}`,
    `Citations: ${citations}`,
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
 * Code (Sonnet): a page/lesson spec → a standalone interactive HTML artifact. HTML is free text
 * (not structured output). The raw HTML is served UNTOUCHED into the opaque-origin sandbox
 * (`sandbox="allow-scripts"` without `allow-same-origin`, under the `default-src 'none'`
 * `ARTIFACT_CSP` — `src/app/artifact/serve.ts`); it is deliberately NOT DOMPurify-sanitized,
 * because sanitization would strip the very inline scripts that make the page interactive — the
 * sandbox boundary is the trust mechanism, not DOMPurify (`serve.ts:9`). A larger output budget is
 * used since a full page can be sizable.
 */
/** Strip a Markdown code fence the model sometimes wraps the HTML in (```html … ```),
 *  despite being told to output only the document — otherwise the artifact is malformed. */
export function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:html)?\s*\n([\s\S]*?)\n```$/);
  return fenced?.[1]?.trim() ?? trimmed;
}

export async function code(
  spec: PageSpec | LessonSpec,
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
    // lesson to 'soon', so give the page room to finish. ONE-PASS (TS-5 verdict, #87): a real
    // v11-shaped emission fits ~59–60% of this cap with teaching density surviving — keep 32000,
    // no two-pass shell-then-fill.
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
