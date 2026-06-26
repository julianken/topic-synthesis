import {
  CriticVerdictSchema,
  type CritiquedArtifact,
  derivePassed,
  GradedCriticVerdictSchema,
  isLessonSpec,
  type PageArtifact,
} from '../domain/stages';
import type { LlmCallRecord } from '../llm/client';
import { STAGE_MODELS, type StageModel } from '../llm/models';
import { defaultDeps, type StageDeps } from './deps';

export const CRITIC_SYSTEM =
  'You are a strict reviewer. Judge whether a generated learning page meets its spec: it ' +
  'teaches the learning goal, is genuinely interactive, satisfies the accessibility contract, ' +
  'and is self-contained. Pass only if all hold. Give a terse critique either way.';

/** Render the arm-scoped spec's pedagogy descriptor: the blob arm's flat `interactionKind`, or
 *  the v11 `LessonSpec`'s ordered section kinds. `a11yContract` is on both arms, so the prompts
 *  read it directly; only `interactionKind`/`sections` differ, so they go through here. */
function specDescriptor(spec: PageArtifact['spec']): string {
  if (isLessonSpec(spec)) return `Section kinds: ${spec.sections.map((s) => s.kind).join(', ')}`;
  return `Interaction kind: ${spec.interactionKind}`;
}

function criticPrompt(artifact: PageArtifact): string {
  return [
    `Learning goal: ${artifact.learningGoal}`,
    specDescriptor(artifact.spec),
    `Accessibility contract: ${artifact.spec.a11yContract}`,
    '',
    'Generated HTML:',
    '```html',
    artifact.html,
    '```',
    '',
    'Does it meet the spec? Return passed (boolean) and a terse critique.',
  ].join('\n');
}

export interface CriticOutput {
  artifact: CritiquedArtifact;
  records: LlmCallRecord[];
}

/** Critic (Opus, one pass): judge an artifact against its spec → pass/fail + critique. */
export async function critique(
  artifact: PageArtifact,
  deps: StageDeps = defaultDeps,
  model: StageModel = STAGE_MODELS.critic,
): Promise<CriticOutput> {
  const { object, record } = await deps.completeObject({
    model,
    system: CRITIC_SYSTEM,
    prompt: criticPrompt(artifact),
    schema: CriticVerdictSchema,
  });
  const critiqued: CritiquedArtifact = { ...artifact, passed: object.passed, critique: object.critique };
  return { artifact: critiqued, records: [record] };
}

// ── graded critic (the v11 StageBundle.critic arm — program decision 7) ────────
/**
 * The ledger-aware GRADED critic system prompt (TS-7). It grades the v2 schema's nine named
 * sub-criteria — four learning-efficacy axes + five statically-checkable ledger-conformance
 * proxies — each on a 0..1 scale with a terse note, against the LOCKED acceptance bar in
 * DESIGN.md → `## Lesson layout` (which wins on any conflict; this prompt REFERENCES it, it
 * does NOT restate it). Two hard guardrails, both program decisions:
 *  - It grades ONLY what is statically visible in the HTML/CSS source + teaching quality it can
 *    read off that source. It claims NO rendered-geometry measurement — no `getBoundingClientRect`,
 *    no computed pixel width/overflow — because the repo has no headless renderer (program
 *    decision 5 / R-anti-invention). Layout axes are SOURCE proxies (grid-line names, media
 *    queries, `:root` overrides), never measured boxes.
 *  - It does NOT decide overall pass/fail and is given NO best-prior version to compare against:
 *    `passed` is DERIVED from the sub-scores by `derivePassed` (program decision 3), and
 *    regression-vs-best-prior is the offline `--baseline` bench, never an in-run input.
 *
 * KNOWN LIMITATION (`findingsGrounded`): the brief's denormalized `findings` are NOT threaded into
 * the critic input — `PageArtifact` carries no findings (they live on `LessonBrief`), and
 * `gradedCriticPrompt` shows only the goal + a11y contract + HTML. So `findingsGrounded` currently
 * grades source-INTERNAL claim plausibility (does the prose read as invented?), not actual grounding
 * against a supplied evidence list. Threading the brief findings into the critic input is a future
 * critic-input contract extension (NOT TS-8 — TS-8 is only the write-path / `critic_scores` JSONB
 * migration and does NOT touch the critic prompt); it belongs to a later issue under the
 * graded-critic epic #80 — see `docs/plans/lesson-workspace.md` (the `findingsGrounded` /
 * "claims grounded in brief findings" sub-criterion). Until then the offline calibration step
 * (`npm run critic:calibrate`) is what surfaces whether this axis carries real signal.
 *
 * It is one of the system prompts folded into `PROMPTS_VERSION` (`src/pipeline/prompts.ts`), so
 * editing the graded rubric makes the graded arm a distinct `workflow_version` eval arm.
 */
export const GRADED_CRITIC_SYSTEM = [
  'You are a strict learning-design reviewer. Grade ONE generated single-lesson HTML page against',
  'the locked acceptance bar (the lesson-layout ledger). Score each named sub-criterion below from',
  '0 (absent / fails) to 1 (fully met) with a short note citing the evidence you read in the source.',
  'Do NOT inflate: a plausible-looking but vapid lesson must fail the named teaching axes it actually',
  'lacks. You do NOT decide overall pass/fail — that is derived from your sub-scores by the gate.',
  '',
  'LEARNING-EFFICACY axes (judge teaching quality from the source text + structure):',
  '- misconceptionHook: the lesson opens on a real misconception or live question a learner holds,',
  '  not a flat definition dump. Score low for an encyclopedia-style intro.',
  '- retrievalCheck: there is at least one GENUINE predict-then-reveal / retrieval check with',
  "  ANSWER-SPECIFIC feedback (feedback that responds to the learner's answer, not a generic",
  '  "correct!"). A reveal with no prediction step, or canned feedback, scores low.',
  '- findingsGrounded: substantive claims read as well-founded and non-invented given the learning',
  '  goal (NOTE: no external evidence list is provided in this pass; grade source-internal plausibility',
  '  — does the prose read as invented? — not grounding against a supplied corpus).',
  '- apparatusAddsBeyondProse: the panel apparatus (glosses, mini-figures, live readouts) ADDS what',
  '  the prose does not already state — never filler that restates the paragraph beside it.',
  '',
  'LEDGER-CONFORMANCE axes (statically-checkable PROXIES read from the HTML/CSS SOURCE only — you',
  'CANNOT and MUST NOT measure rendered geometry: you have no `getBoundingClientRect`, no computed',
  'pixel width, no overflow check (there is no headless renderer). Grade the source token, not a',
  'pixel box):',
  '- namedGridPresent: the canonical named grid-line set `[screen-start] [read] [gap] [panel] [scrub]`',
  '  appears in a CSS `grid-template-columns` (the `[scrub]` track MUST be present — its absence is a',
  '  demonstrated real failure; score this axis low if `[scrub]` is missing).',
  '- perSectionSubgrid: each `<section>` declares its own subgrid / grid so the reading spine is stable',
  '  across sections (source-checkable: `display:grid` / `grid-template-columns:subgrid` per section).',
  '- collapseQueryPresent: a `@media (max-width: 900px)` (or `≤900px`) single-column collapse query is',
  '  present so the apparatus reflows under the prose on narrow viewports.',
  '- noRootLiteralOverride: the page does NOT hardcode `:root` color/geometry literals that override',
  '  the design-system §0 tokens (a `:root { --…: <literal> }` block re-defining tokens scores low).',
  '- predictGateStructure: interactivity is predict-gate structured (a predict step gates the reveal),',
  '  not a free / un-gated reveal button.',
  '',
  'Also flag in `critique` any DESIGN.md `## Lesson layout` REJECTED anti-pattern you see in the',
  'source — single column, reserved/empty margin, prose-over-component occlusion, per-paragraph',
  'horizontal jitter, lopsided/left-pinned prose, an edge-pinned lone element, clipped figures —',
  'and let it pull down the relevant ledger axis. Grade from the source you are given; assert no',
  'measurement you cannot make from that source.',
].join('\n');

/**
 * The per-call graded-critic prompt. Shows the artifact's goal + a11y contract + the full HTML
 * and asks for the v2 graded verdict. It introduces NO best-prior / regression input (program
 * decision 3) — the critic grades the CURRENT artifact against the ledger only.
 *
 * NOTE: it threads NO brief findings (`PageArtifact` carries none), so `findingsGrounded` is graded
 * source-internally here — see the `GRADED_CRITIC_SYSTEM` doc-comment's KNOWN LIMITATION (the
 * findings-threading contract extension is future work under epic #80, NOT TS-8).
 */
function gradedCriticPrompt(artifact: PageArtifact): string {
  return [
    `Learning goal: ${artifact.learningGoal}`,
    specDescriptor(artifact.spec),
    `Accessibility contract: ${artifact.spec.a11yContract}`,
    '',
    'Grade this lesson page against the named learning-efficacy axes and the statically-checkable',
    'ledger-conformance proxies. Score each sub-criterion 0..1 with a terse note citing source',
    'evidence. Judge only what is visible in the HTML/CSS below — claim no rendered-geometry',
    'measurement. Write a short overall critique naming any rejected anti-pattern you saw.',
    '',
    'Generated HTML:',
    '```html',
    artifact.html,
    '```',
  ].join('\n');
}

/**
 * The GRADED critic arm fn (program decision 7). Same `(artifact, deps, model) =>
 * Promise<CriticOutput>` signature as `critique`, so it is a drop-in `StageBundle.critic`
 * override for the v11 arm; `defaultStages.critic` stays the binary `critique` (the blob
 * arm is the live default — the decision-3/7 kill-switch). It requests the v2 graded schema,
 * DERIVES `passed` from the sub-scores (overwriting the model's self-asserted boolean — the
 * gate stays computed, not LLM-asserted), and returns a `CritiquedArtifact` carrying the
 * sub-scores under `scores`.
 */
export async function gradedCritique(
  artifact: PageArtifact,
  deps: StageDeps = defaultDeps,
  model: StageModel = STAGE_MODELS.critic,
): Promise<CriticOutput> {
  const { object, record } = await deps.completeObject({
    model,
    system: GRADED_CRITIC_SYSTEM,
    prompt: gradedCriticPrompt(artifact),
    schema: GradedCriticVerdictSchema,
  });
  const passed = derivePassed(object);
  const critiqued: CritiquedArtifact = {
    ...artifact,
    passed,
    critique: object.critique,
    scores: { learningEfficacy: object.learningEfficacy, ledgerConformance: object.ledgerConformance },
  };
  return { artifact: critiqued, records: [record] };
}
