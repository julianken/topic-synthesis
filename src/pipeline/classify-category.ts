import { z } from 'zod';
import type { LlmCallRecord } from '../llm/client';
import { STAGE_MODELS, type StageModel } from '../llm/models';
import { defaultDeps, type StageDeps } from './deps';

/**
 * The subject-CATEGORY classifier — the data source for the Figma `6:2` poster-card eyebrow (node
 * `6:41`, "BIOLOGY" / "MATHEMATICS" / …). It is DELIBERATELY ISOLATED from the lesson pipeline:
 *
 *  - NOT a `StageBundle` stage and NOT wired into the core `runLesson` stages (plan/research/brief/
 *    spec/code/critic). It does NOT touch the `LessonBrief` contract or `LESSON_BRIEF_SCHEMA_HASH`,
 *    so it can never change the eval arm or feed Synthesis. It is a thin presentation-metadata helper
 *    invoked at the run TAIL (see `runLesson`), after the lesson is already synthesized.
 *  - FAIL-SAFE: `classifyCategory` NEVER throws. Any error/timeout/invalid output → `category: null`
 *    and the run continues unaffected. A null category just omits the card eyebrow (show nothing >
 *    guess/leak), it never degrades the lesson. The owner reverted a prior pipeline change for making
 *    generation slower/flakier — this helper is built so a classifier fault can't do that.
 *  - CHEAP: ONE short structured call on the cheap analysis-tier model (Haiku by default — the same
 *    `cheapModels()` analysis tier every cheap entrypoint uses), bounded to a tiny token budget.
 *  - COPY-APPROPRIATE: the output is a REAL subject label DERIVED from the topic (BIOLOGY, PHYSICS,
 *    MATHEMATICS, …), validated to be a short alphabetic word and SCRUBBED of internal identifiers
 *    (never the `interactionKind` svg/canvas/html enum, never an ADR/issue/code token). If a label
 *    can't be derived to that standard, the helper returns null.
 */

/** The widest a real subject label runs (e.g. "ENVIRONMENTAL SCIENCE"). A model that floods past this
 *  is treated as an invalid answer → null, never truncated into a misleading partial. */
const MAX_CATEGORY_LEN = 24;

/** Internal render-backend / config identifiers that must NEVER reach the user-facing eyebrow even if
 *  a model emits one. A copy-appropriateness backstop on top of the alpha-only validator below. */
const FORBIDDEN_TOKENS: ReadonlySet<string> = new Set([
  'SVG',
  'CANVAS',
  'HTML',
  'ADR',
  'TS',
  'PR',
  'BLOB',
  'V11',
  'SPEC',
  'CRITIC',
  'LESSON',
  'NULL',
  'NONE',
  'UNKNOWN',
  'GENERAL',
  'MISC',
  'OTHER',
]);

/** The classifier's structured-output schema. Exported so the e2e stub deps can recognize it by
 *  reference (the stub picks its canned object by schema identity) and return a valid canned category. */
export const CATEGORY_SCHEMA = z.object({
  /** The single subject label, e.g. "Biology". The model is asked for one word/short phrase. */
  category: z.string(),
});

export const CLASSIFY_CATEGORY_SYSTEM =
  'You label a learning topic with its single broad academic SUBJECT, the kind that would head a ' +
  'library shelf — e.g. Biology, Chemistry, Physics, Mathematics, Computer Science, History, ' +
  'Economics, Linguistics. Reply with ONLY that subject as one or two plain words. Do not restate ' +
  'the topic, do not invent a niche label, and never answer with a generic filler like "General", ' +
  '"Other", or "Misc". If no clear academic subject fits, reply with the single word NONE.';

function classifyPrompt(topic: string): string {
  return `Topic: ${topic}\n\nWhat single academic subject does this topic belong to?`;
}

/**
 * Normalize + VALIDATE a raw model answer into a card-ready uppercase subject label, or null. Pure +
 * exported so the copy-appropriateness rules are unit-tested without a live model. A label survives
 * only if it is a short, purely-alphabetic word/phrase that is not a forbidden internal token — so a
 * code identifier, a sentence, an empty/over-long string, or a generic filler all collapse to null.
 */
export function normalizeCategory(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_CATEGORY_LEN) return null;
  // Alphabetic words separated by single spaces only — rejects punctuation, digits, slashes, code-ish
  // identifiers (`interactionKind`, `ts-17`), URLs, and multi-sentence answers in one check.
  if (!/^[A-Za-z]+(?: [A-Za-z]+)*$/.test(trimmed)) return null;
  const upper = trimmed.toUpperCase();
  // No internal/render-backend token may reach the eyebrow, and no generic filler.
  for (const word of upper.split(' ')) {
    if (FORBIDDEN_TOKENS.has(word)) return null;
  }
  return upper;
}

export interface CategoryResult {
  /** The validated uppercase subject label, or null when none could be safely derived. */
  category: string | null;
  /** The classifier call's trace row(s) — empty on the fail-safe path so cost accounting stays honest. */
  records: LlmCallRecord[];
}

/**
 * Derive the topic's subject category via ONE cheap, bounded structured call — FAIL-SAFE: it never
 * throws. On any failure (SDK error, timeout, schema miss, invalid/forbidden label) it returns
 * `{ category: null, records: [] }`, so the caller persists the run with `category = null` and
 * generation is unaffected. `deps` defaults to the live client; tests inject a fake `completeObject`.
 * `model` defaults to the cheap analysis tier (Haiku), never the synthesis arm.
 */
export async function classifyCategory(
  topic: string,
  deps: StageDeps = defaultDeps,
  model: StageModel = STAGE_MODELS.researcher,
): Promise<CategoryResult> {
  try {
    const { object, record } = await deps.completeObject({
      model,
      system: CLASSIFY_CATEGORY_SYSTEM,
      prompt: classifyPrompt(topic),
      schema: CATEGORY_SCHEMA,
      // A subject label is a handful of tokens; a tiny budget keeps the call cheap and fast.
      maxTokens: 64,
    });
    const category = normalizeCategory(object.category);
    // Keep the cost record EVEN when the label was rejected — the call really happened. Only the truly
    // failed (thrown) path drops to []: there's no honest record for a call that never returned.
    return { category, records: [record] };
  } catch {
    // Swallow EVERYTHING — a classifier fault must never surface into the run. No record: the call
    // failed, so there is no real cost row to thread.
    return { category: null, records: [] };
  }
}
