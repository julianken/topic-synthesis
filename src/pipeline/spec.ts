import {
  type LessonBrief,
  LessonSpecSchema,
  type PageSpec,
  PageSpecSchema,
  SECTION_KINDS,
  type Section,
  type LessonSpec,
} from '../domain/stages';
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
  /**
   * The Synthesis spec is the ARM-SCOPED union (TS-10): the live blob `spec` emits the flat
   * `PageSpec`; the v11 `specV11` (below) emits the sectioned `LessonSpec`. Typing both stages'
   * output to the union keeps a single `StageBundle.spec` signature, so `specV11` is a valid
   * arm OVERRIDE without mutating `defaultStages.spec`. `isLessonSpec` narrows it downstream.
   */
  spec: PageSpec | LessonSpec;
  records: LlmCallRecord[];
}

/** Spec (Sonnet): a LessonBrief → the plan for one accessible, interactive page (the BLOB arm). */
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

// ── the v11 sectioned spec (TS-11 — the prompt half of TS-10's LessonSpec contract) ─────────────

export const SPEC_V11_SYSTEM =
  'You are an instructional designer planning ONE interactive lesson as a DOCUMENT of typed ' +
  'sections in reading order. The lesson contract is sectioned, not a single blob:\n' +
  '- Plan an ORDERED list of sections, one per essential point, drawn from these kinds in this ' +
  'pedagogical arc: hook → concrete-case → concept → worked-example → intuition → self-check → ' +
  'takeaways. Use the kinds that fit the material (not every kind every time), but keep them in ' +
  'this order.\n' +
  '- Each section may carry AT MOST ONE apparatus component (kind ∈ predict-gate | self-check | ' +
  'canvas | svg | html). Never put more than one component on a section. Many sections carry NONE ' +
  '— prose alone is fine.\n' +
  '- Apparatus must ADD what the prose does not already state — never decorative filler. State each ' +
  "component's teaching purpose: the specific thing it makes the learner do or see that the prose " +
  'cannot. A component with no real reason to exist must be omitted, not invented.\n' +
  '- The lesson MUST carry the two load-bearing pedagogy primitives: at least one predict-gate ' +
  '(a predict-then-reveal interactive) AND at least one self-check (an answerable retrieval check). ' +
  'Each primitive component carries an answerable { prompt, answer } pair. Only if a predict-gate or ' +
  'self-check is pedagogically WRONG for this lesson (e.g. a pure-definition reference page) may you ' +
  'omit them — and then you MUST state a non-empty documentedReasonAbsent explaining why.\n' +
  '- State an accessibility contract (text alternative + keyboard support, up front not retrofitted) ' +
  'and cite only the offered sources.';

function specV11Prompt(input: SpecInput): string {
  const { brief, settings } = input;
  // Same grounded-findings feed as the blob arm — claim + source so the sectioning isn't fact-starved.
  const findings = brief.findings
    .map((f, i) => `[${i}] ${f.claim}  (${f.source.title} — ${f.source.url})`)
    .join('\n');
  return [
    `Learning goal: ${brief.learningGoal}`,
    `Key points (one section each, in order): ${brief.keyPoints.join('; ') || '(none)'}`,
    `Audience: ${brief.audience} (level ${settings.level}, depth ${settings.depth}/5).`,
    '',
    'Grounded findings to teach from and cite:',
    findings || '(none)',
    '',
    `Section kinds, in order: ${SECTION_KINDS.join(' → ')}.`,
    'Plan the lesson as an ordered list of typed sections. Each section has a kind, its reading-spine',
    'prose, and AT MOST ONE optional apparatus component with a stated teachingPurpose. Include ≥1',
    'predict-gate and ≥1 self-check (each with an answerable { prompt, answer }), or a',
    'documentedReasonAbsent. Cite only the findings’ sources above; state the accessibility contract.',
  ].join('\n');
}

export interface SpecV11Output {
  spec: LessonSpec;
  records: LlmCallRecord[];
}

/**
 * A section as it MIGHT arrive before the deterministic clamp. NOTE the actual enforcer of the
 * "≤1 component per section" invariant (TS-10's `Section.component` is singular) in production is
 * `LessonSpecSchema` (Zod, TS-10), not this clamp: `completeObject` validates the model output
 * through `SectionSchema` (a plain `z.object`, default strip) before `specV11` runs, so a stray
 * `components` array is dropped on parse and a JSON object cannot carry two `component` keys — the
 * over-fill never survives to here on real parsed data. This `components`-array branch is therefore
 * BELT-AND-SUSPENDERS: it covers the only non-validating injection point — the unit test's
 * Zod-bypassing fake `completeObject` (spec.test.ts AC5) — and a future passthrough/non-stripping
 * schema. The clamp keeps the FIRST component (reading order) and drops the rest, so it is a no-op
 * on validated input and lossless otherwise (the singular `component` is preserved verbatim).
 */
type LooseSection = Omit<Section, 'component'> & {
  component?: Section['component'];
  /** A model that over-fills a section may emit an array here; the clamp collapses it to ≤1. */
  components?: Section['component'][];
};

/** Collapse a possibly-over-filled section to TS-10's ≤1-component-per-section invariant: keep the
 *  first component (singular field wins, else the head of a `components` array) and drop the rest.
 *  On validated `LessonSpecSchema` output the `components` array is already stripped, so this just
 *  passes the singular `component` through — it only fires on a non-validating injection point. */
function clampSection(section: LooseSection): Section {
  const { components, component, ...rest } = section;
  const kept = component ?? components?.[0];
  return kept ? { ...rest, component: kept } : { ...rest };
}

/**
 * Spec v11 (Sonnet): a LessonBrief → the typed sectioned `LessonSpec` (TS-10's contract). The v11
 * ARM's spec stage — it is NOT `defaultStages.spec` (the blob `spec` above stays the live default);
 * it is wired as a `StageBundle.spec` arm override (the arm wiring TS-14 finalizes). It shares the
 * blob arm's anti-fabrication citation filter. The ≤1-component-per-section invariant is enforced
 * by `LessonSpecSchema` itself (path B: TS-10's `Section.component` is singular and `SectionSchema`
 * strips an off-schema over-fill on parse); the deterministic clamp below is belt-and-suspenders for
 * a non-validating injection point, NOT the primary enforcer (the literal ≤3-gloss/≤1-mini-figure
 * DESIGN.md cap is the TS-12 code prompt's concern, and a typed-gloss schema cap is GAPS-deferred).
 */
export async function specV11(
  input: SpecInput,
  deps: StageDeps = defaultDeps,
  model: StageModel = STAGE_MODELS.spec,
): Promise<SpecV11Output> {
  const { object, record } = await deps.completeObject({
    model,
    system: SPEC_V11_SYSTEM,
    prompt: specV11Prompt(input),
    schema: LessonSpecSchema,
  });
  // Anti-fabrication: keep only citations pointing at a brief-findings source (the blob arm's
  // discipline, applied to the sectioned spec's citations). The sectioned `LessonSpec` carries no
  // per-section source field, so `citations` is the only grounded-source list to filter.
  const offered = new Set(input.brief.findings.map((f) => f.source.url));
  const citations = object.citations.filter((c) => offered.has(c.url));
  // ≤1-component-per-section is enforced by `LessonSpecSchema` on parse (singular `component`, an
  // over-fill stripped); this clamp is belt-and-suspenders for a non-validating injection point and
  // is a no-op on validated input. Keep it in brief/reading order (first component wins).
  const sections = (object.sections as LooseSection[]).map(clampSection);
  return { spec: { ...object, sections, citations }, records: [record] };
}
