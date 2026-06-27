import { isLessonSpec, type LessonSpec, type PageArtifact, type PageSpec } from '../domain/stages';
import type { LlmCallRecord } from '../llm/client';
import { STAGE_MODELS, type StageModel } from '../llm/models';
import { defaultDeps, type StageDeps } from './deps';

/**
 * CODE_SYSTEM (Sonnet) — the v11 lesson-workspace contract (TS-12, TS-13). It teaches the model the
 * LOCKED two-column teaching workspace from DESIGN.md `## Lesson layout` (DESIGN.md wins on any
 * design conflict — this prompt references that bar, it does NOT fork it) and states the
 * hard, non-negotiable structural requirements the downstream graded critic (TS-7) statically
 * gates on and serve-time injection (TS-19) relies on:
 *   1. the named CSS-grid column-line literal `[screen-start] [read] [gap] [panel] [scrub]`,
 *   2. `var(--token)`-only theming with NO competing `:root` color/geometry literal block, and
 *   3. an inline `var(--token, <fallback>)` self-contained fallback whose FALLBACK VALUES are the
 *      DESIGN.md §0 dark-OKLCH ramp transcribed VERBATIM (color/geometry/font tokens), so the
 *      no-injection path (TS-19 serve-time injection is still unbuilt) renders the dark instrument
 *      aesthetic — NOT a light/parchment or sRGB-hex inversion (TS-15 judge finding); font ROLES
 *      bound correctly (sans body+chrome, serif headings only, mono code).
 * TS-13 adds two content-internal apparatus requirements authored into the SAME one-pass emission:
 *   4. ≥1 PREDICT-THEN-REVEAL gate (the v11 pedagogy primitive — learner commits a prediction before
 *      the answer + answer-specific feedback reveals; a still-locked gate is a critic anti-pattern),
 *   5. the decision-12 `postMessage` SENDER (path a) — a coordinate-only `{type, sections, scroll
 *      Progress}` posted to `window.parent` at a KNOWN target origin (never `'*'`), the cross-iframe
 *      contract TS-20's reader shell later consumes via the receive-side validator in
 *      `src/app/curriculum/[id]/lesson-message.ts` (it never reads this opaque-origin frame's DOM). concept-drift-ok: route/code identifier path, deferred rename (ADR-0003)
 * Neither relaxes the sandbox or the `ARTIFACT_CSP` (Key-decision 1 — new behavior lands INSIDE the
 * sandboxed HTML, never by widening the boundary); `maxTokens` stays 32000 (one-pass, TS-5).
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
  'ALL color, geometry, and font families. Do NOT emit a competing `:root { … }` color/geometry',
  'literal block — no `:root` rule that re-defines or hardcodes the design-system tokens (serve-time',
  're-theming injects the canonical `:root` block, and a hardcoded one would defeat it). Instead,',
  'give every `var()` an INLINE FALLBACK — `var(--token, <fallback>)` — so the document still renders',
  'styled when no `:root` token block is injected (the self-contained no-injection path).',
  '',
  '§0-FAITHFUL FALLBACKS (HARD — the decisive rule): EVERY inline `var(--token, <fallback>)` MUST',
  'carry the EXACT DESIGN.md §0 value as its fallback — the dark-OKLCH instrument aesthetic. Because',
  'the no-injection path renders the FALLBACKS, a wrong fallback ships the wrong palette. Transcribe',
  'these canonical §0 values VERBATIM — do NOT invent light/parchment colors, sRGB hex, or serif',
  'body type. Use ONLY these tokens with ONLY these fallbacks:',
  '  COLOR (OKLCH — dark on dark, never light):',
  '    --bg-app: var(--bg-app, oklch(0.165 0.018 250))         /* near-black app canvas */',
  '    --bg-surface: var(--bg-surface, oklch(0.205 0.020 250)) /* raised surface */',
  '    --bg-raised: var(--bg-raised, oklch(0.215 0.018 250))   /* panel/card */',
  '    --border: var(--border, oklch(0.32 0.020 250))',
  '    --text: var(--text, oklch(0.95 0.008 250))              /* near-white body text */',
  '    --text-muted: var(--text-muted, oklch(0.74 0.015 250))',
  '    --text-faint: var(--text-faint, oklch(0.65 0.016 250))',
  '    --accent: var(--accent, oklch(0.82 0.145 215))          /* cyan-blue, NOT green */',
  '    --accent-dim: var(--accent-dim, oklch(0.70 0.11 215))',
  '    --ok: var(--ok, oklch(0.78 0.15 152))',
  '    --warn: var(--warn, oklch(0.82 0.13 80))',
  '    --err: var(--err, oklch(0.66 0.17 25))',
  '    --kind-svg: var(--kind-svg, oklch(0.80 0.13 295))',
  '    --kind-canvas: var(--kind-canvas, oklch(0.82 0.13 50))',
  '    --kind-html: var(--kind-html, oklch(0.80 0.12 175))',
  '  GEOMETRY:',
  '    --measure: var(--measure, 33rem)',
  '    --panel-w: var(--panel-w, 23rem)',
  '    --col-gap: var(--col-gap, clamp(1.6rem, 2.6vw, 3.4rem))',
  '    --edge-gap: var(--edge-gap, clamp(1.6rem, 2.4vw, 3.2rem))',
  '    --scrub-w: var(--scrub-w, 1.1rem)',
  '    --frame-max: var(--frame-max, 1640px)',
  '  FONT FAMILIES (bind the roles correctly — see TYPOGRAPHY below):',
  '    --sans: var(--sans, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif)',
  '    --serif: var(--serif, "Iowan Old Style", "Charter", "Georgia", serif)',
  '    --mono: var(--mono, ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace)',
  '',
  'TYPOGRAPHY — bind the font ROLES correctly (DESIGN.md §Typography; the observed bug was the roles',
  'INVERTED — do NOT repeat it):',
  '- BODY + ALL CHROME (paragraphs, lists, panel/apparatus text, controls, captions, the whole',
  '  reading column) use the SANS stack: `font-family: var(--sans, ui-sans-serif, system-ui, …)`.',
  '  The body is NEVER serif.',
  '- LESSON + SECTION HEADINGS ONLY (the lesson `h1` and the section `h2`s) use the SERIF stack:',
  '  `font-family: var(--serif, "Iowan Old Style", "Charter", "Georgia", serif)` — a distinct',
  '  reading voice. Serif is for headings ONLY.',
  '- CODE / TOKENS / the live timer + durations use the MONO stack: `var(--mono, ui-monospace, …)`.',
  '',
  'APPARATUS (DESIGN.md decision 1 — rendered apparatus, path B): densify each section with curated',
  'apparatus that ADDS what the prose does not already state (never decorative filler), capped at',
  '≤3 key-term glosses and ≤1 teaching mini-figure PER SECTION — never a dashboard. Glosses are',
  'rendered in the apparatus panel beside the term dotted in the prose; citations render beside their',
  'text in the panel, never a lone card in a void.',
  '',
  'RESPONSIVE: collapse to a single column at `@media (max-width: 900px)` (≤~900px), where the',
  'apparatus reflows directly under the prose it annotates.',
  '',
  'NO HORIZONTAL OVERFLOW at 390px (HARD): nothing may overflow the viewport horizontally at a 390px',
  'width. Long formulas, `.math` blocks, code, and wide apparatus/figure plates MUST wrap',
  '(`overflow-wrap: anywhere` / `word-break: break-word` / `white-space: normal`) or scroll inside',
  'their own box (`overflow-x: auto`, `max-width: 100%`) — NEVER `white-space: nowrap` on content that',
  'then overflows the column. The reading spine and every plate stay within the viewport at 390px.',
  '',
  'STABLE SPINE (HARD rule, restated — wins all conflicts): EVERY reading paragraph has the IDENTICAL',
  'left edge and width across ALL sections — apparatus-paired sections and lone (apparatus-free)',
  'sections alike. A lone section centers its TEXT inside that fixed column (`text-align: center` at',
  'the block level); it NEVER moves or narrows the column. Zero left-right jitter between sections.',
  '',
  'ACCESSIBILITY: satisfy the stated accessibility contract EXACTLY — keyboard operability and the',
  'text alternative are generation targets, stated up front, not retrofitted.',
  '',
  'PREDICT-GATE (HARD, non-negotiable — TS-13): the lesson MUST include AT LEAST ONE predict-then-',
  'reveal gate — an interactive control where the learner COMMITS A PREDICTION (picks/enters an',
  'answer and submits) BEFORE the answer and its feedback are revealed. The reveal is GATED on that',
  'input: nothing about the answer is shown until the learner commits. The feedback MUST be',
  'ANSWER-SPECIFIC — a different message for each wrong choice that addresses THAT misconception, not',
  'a generic "correct/incorrect". Every gate MUST have a reachable reveal path (a still-locked gate',
  'with no way to reveal is a failure). A free, un-gated reveal button (reveal with no prediction',
  'required) does NOT satisfy this. Keyboard-operable, like all controls.',
  '',
  'PROGRESS postMessage (HARD, non-negotiable — TS-13 decision-12 path a): emit a small inline script',
  'that posts COORDINATE-ONLY reading-progress data to the parent so the (future) reader shell can',
  'render a reading-progress bar / section-jump without reading this opaque-origin frame. The sender',
  'MUST: (1) build a section list of `{ id, title }` from the rendered `<section>` headings, and a',
  '`scrollProgress` scalar in 0..1 (how far the reader has scrolled); (2) post the EXACT shape',
  "`{ type: 'lesson:progress', sections, scrollProgress }` to `window.parent` via",
  '`window.parent.postMessage(msg, targetOrigin)`; (3) target a KNOWN origin string, NEVER `"*"` —',
  'derive it from `document.referrer` (`new URL(document.referrer).origin`, falling back to the',
  "literal opaque-origin token `'null'` when there is no referrer); (4) post once on load AND on",
  'scroll (debounced/rAF-throttled). It reads ONLY this document — it sends coordinates, never HTML.',
  'This coordinates the in-iframe dot-scrubber against the reserved `[scrub]` track (it does NOT',
  're-emit the track). Wrap message posting in a `try/catch` so a framing-less standalone open is',
  'harmless.',
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
