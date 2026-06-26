import { z } from 'zod';
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
 * The bounded number of `completeObject` attempts `specV11` makes: ONE initial call plus up to two
 * self-repair retries. The repair exists because `LessonSpecSchema`'s `.superRefine` constraints (a
 * primitive component MUST carry an `answerable`; the spec MUST have ≥1 predict-gate + ≥1 self-check,
 * or a `documentedReasonAbsent`) are NOT expressible in the JSON Schema the AI SDK sends the model —
 * the model gets NO structural signal for them, so it intermittently emits a spec that the prompt
 * asks for but the JSON Schema can't force, and the strict-schema validation throws (surfaced live by
 * TS-12b: `No object generated: response did not match schema` → the lesson degraded to 'soon'). On a
 * validation failure we re-call with the Zod error appended so the model self-corrects the missing
 * primitive/answerable. Bounded so a persistently-failing model fails loud rather than looping.
 */
const SPEC_V11_MAX_ATTEMPTS = 3 as const;

/**
 * The repair feedback appended to the prompt on a retry. Derived from a Zod error (the returned
 * object failed `LessonSpecSchema.safeParse`) or the AI SDK's structured-output validation throw (its
 * `Output.object` `parseCompleteOutput` throws `NoObjectGeneratedError` → `TypeValidationError` →
 * `ZodError` on the same schema). Either way the model sees the SPECIFIC unmet refine — the structural
 * signal the JSON Schema couldn't carry — followed by an explicit restatement of both refine rules.
 */
function repairFeedback(error: string): string {
  return [
    '',
    'Your previous response did NOT satisfy the LessonSpec contract. Fix EXACTLY this and re-emit',
    'the full corrected spec:',
    error,
    '',
    'Reminder: every predict-gate AND every self-check component object MUST include an answerable',
    'with a non-empty prompt AND a non-empty answer. The spec MUST contain at least one predict-gate',
    'component AND at least one self-check component (each with its answerable), OR a non-empty',
    'documentedReasonAbsent explaining why those primitives are pedagogically wrong for this lesson.',
  ].join('\n');
}

/** Walk an error's `.cause` chain (bounded) to find the first `ZodError`. The AI SDK wraps a
 *  structured-output validation failure TWO levels deep — `NoObjectGeneratedError.cause` is a
 *  `TypeValidationError`, whose `.cause` is the actual `ZodError`. Walking by `.cause` (rather than
 *  importing the SDK's error classes) keeps the AI-SDK import surface in `src/llm/` only and is
 *  resilient to the SDK's wrapping depth. Returns undefined if no ZodError is on the chain. */
function findZodError(err: unknown): z.ZodError | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current != null; depth++) {
    if (current instanceof z.ZodError) return current;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Extract a model-facing repair message from a thrown `completeObject` error. When the chain carries
 *  the underlying `ZodError` (the live path: `NoObjectGeneratedError` → `TypeValidationError` →
 *  `ZodError`), `z.prettifyError` renders it into the same readable per-field form as the
 *  returned-but-invalid path — so the model sees the unmet refine, not the opaque "response did not
 *  match schema". Falls back to the raw error message for any other throw. */
function errorToFeedback(err: unknown): string {
  const zerr = findZodError(err);
  if (zerr) return z.prettifyError(zerr);
  return err instanceof Error ? err.message : String(err);
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
 *
 * SELF-REPAIR RETRY (surfaced by TS-12b's first live v11 render): `LessonSpecSchema`'s two
 * `.superRefine` constraints (a primitive carries an `answerable`; the spec has both pedagogy
 * primitives or a `documentedReasonAbsent`) are NOT in the JSON Schema the AI SDK sends the model, so
 * the model gets no structural signal for them and intermittently emits a spec that fails validation
 * → `completeObject` throws → the lesson degraded to 'soon'. We re-call up to `SPEC_V11_MAX_ATTEMPTS`
 * times, appending the Zod validation error to the prompt so the model self-corrects the missing
 * primitive/answerable. Every attempt that RETURNS threads its `LlmCallRecord` cost (a throwing
 * attempt carries no record). The contract is unchanged — repair makes the model meet it, never
 * weakens it. This is arm-scoped: `defaultStages.spec` (the blob `spec`) is untouched.
 */
export async function specV11(
  input: SpecInput,
  deps: StageDeps = defaultDeps,
  model: StageModel = STAGE_MODELS.spec,
): Promise<SpecV11Output> {
  const basePrompt = specV11Prompt(input);
  const records: LlmCallRecord[] = [];
  let prompt = basePrompt;
  let lastError: unknown;

  for (let attempt = 0; attempt < SPEC_V11_MAX_ATTEMPTS; attempt++) {
    let object: LessonSpec;
    try {
      const result = await deps.completeObject({
        model,
        system: SPEC_V11_SYSTEM,
        prompt,
        schema: LessonSpecSchema,
      });
      records.push(result.record); // this attempt produced a (paid) call — thread its cost
      object = result.object;
    } catch (err) {
      // The real client's `completeObject` validates with the SAME schema (refines included) and
      // THROWS on a refine miss before returning, so the live failure path is a throw (no record to
      // thread). Feed the Zod detail back and retry; on the last attempt, re-throw.
      lastError = err;
      if (attempt + 1 >= SPEC_V11_MAX_ATTEMPTS) throw err;
      prompt = basePrompt + repairFeedback(errorToFeedback(err));
      continue;
    }

    // ≤1-component-per-section: enforced by `LessonSpecSchema` on parse (singular `component`, an
    // over-fill stripped), but run the deterministic clamp FIRST so a non-validating injection point
    // (a test's Zod-bypassing fake, or a future passthrough schema) that over-fills a section is
    // collapsed to its first component BEFORE re-validation — otherwise `safeParse` would strip the
    // off-schema `components` array to a component-less section and spuriously fail the primitives
    // refine. On already-validated input this is a no-op. First component wins (brief/reading order).
    const clamped = { ...object, sections: (object.sections as LooseSection[]).map(clampSection) };

    // A returned object can still violate a refine on a non-validating injection point. Re-validate
    // the CLAMPED candidate so the repair fires uniformly whether the failure came back as a throw OR
    // as an invalid return (e.g. a fake that omits the answerable on a primitive).
    const parsed = LessonSpecSchema.safeParse(clamped);
    if (!parsed.success) {
      lastError = parsed.error;
      if (attempt + 1 >= SPEC_V11_MAX_ATTEMPTS) throw parsed.error;
      prompt = basePrompt + repairFeedback(z.prettifyError(parsed.error));
      continue;
    }

    // Anti-fabrication: keep only citations pointing at a brief-findings source (the blob arm's
    // discipline, applied to the sectioned spec's citations). The sectioned `LessonSpec` carries no
    // per-section source field, so `citations` is the only grounded-source list to filter.
    const offered = new Set(input.brief.findings.map((f) => f.source.url));
    const citations = parsed.data.citations.filter((c) => offered.has(c.url));
    return { spec: { ...parsed.data, citations }, records };
  }

  // Unreachable: the loop returns on success and throws on the last failing attempt. Throw the last
  // seen error defensively so a future edit to the loop bound can't silently fall through.
  throw lastError instanceof Error
    ? lastError
    : new Error('specV11: exhausted repair attempts without a valid LessonSpec');
}
