import type { LlmCallRecord } from '../llm/client';
import {
  CriticVerdictSchema,
  FindingsSchema,
  LessonBriefSchema,
  PageSpecSchema,
  PlanSchema,
} from '../domain/stages';
import { CATEGORY_SCHEMA } from './classify-category';
import type { StageDeps } from './deps';

/**
 * A NETWORK-FREE, DETERMINISTIC StageDeps for the e2e harness only.
 *
 * The generate route runs the SAME real `runLesson` pipeline (plan → research → brief → spec → code →
 * critic) over `InlineEngine`, but with these stub LLM-client functions injected instead of the live
 * Vercel-AI-SDK client — so a smoke e2e exercises the actual orchestration (engine memoization, the
 * anti-fabrication source filters, persistRun) end to end with ZERO model spend and ZERO web calls. It
 * returns canned, schema-VALID objects keyed by the Zod schema each stage passes to `completeObject`,
 * and a canned built HTML page from `complete`. The cost is $0 (every `LlmCallRecord` is zero-token).
 *
 * This is wired ONLY behind the `E2E=1` non-prod flag in the generate route — never the default deps —
 * so it can never touch a real run. It lives in `src/pipeline` (a core layer) so the import fence keeps
 * the frontend → core direction; it imports no frontend, no LLM SDK, and no test framework.
 */

const ZERO_RECORD: LlmCallRecord = {
  providerModel: 'e2e:stub',
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  rawUsage: { e2e: true },
  finishReason: 'stop',
};

// One canned source the whole run threads through, so the anti-fabrication filters (researcher index,
// brief/spec source membership) all keep the finding rather than dropping it.
const STUB_SOURCE = { url: 'https://example.com/e2e', title: 'E2E reference source' } as const;

const STUB_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>E2E lesson</title></head><body><main><h1>E2E lesson</h1>
<p>Deterministic stub lesson rendered by the e2e harness (no model spend).</p>
</main></body></html>`;

/** Pick the canned object whose shape matches the schema the stage passed (compared by reference). */
function cannedObject(schema: unknown): unknown {
  if (schema === PlanSchema) {
    return { scope: 'E2E scope', subtopics: ['E2E subtopic'], researchQuestions: ['What is the e2e topic?'] };
  }
  if (schema === FindingsSchema) {
    // sourceIndex 0 is in range of the single canned source returned by searchWeb, so it survives the
    // researcher's index filter.
    return { findings: [{ claim: 'E2E grounded claim.', sourceIndex: 0 }] };
  }
  if (schema === LessonBriefSchema) {
    return {
      learningGoal: 'Understand the e2e topic.',
      keyPoints: ['Key point one.', 'Key point two.'],
      findings: [{ claim: 'E2E grounded claim.', source: STUB_SOURCE }],
      audience: 'self-taught learner',
    };
  }
  if (schema === PageSpecSchema) {
    return {
      nodeSlug: 'e2e-lesson',
      interactionKind: 'html',
      a11yContract: 'Keyboard-operable; text alternatives for all visuals.',
      citations: [STUB_SOURCE],
    };
  }
  if (schema === CriticVerdictSchema) {
    return { passed: true, critique: 'E2E stub: passes the rubric.' };
  }
  if (schema === CATEGORY_SCHEMA) {
    // The isolated, fail-safe card-eyebrow classifier (run-pipeline tail). A canned subject label so a
    // stubbed run persists a real `category` (the dense card renders its eyebrow), deterministic + free.
    return { category: 'Science' };
  }
  throw new Error('e2e-stub-deps: unrecognized schema passed to completeObject');
}

export const e2eStubDeps: StageDeps = {
  // The `code` stage now STREAMS (`streamComplete`); no stage calls the blocking `complete`. Both
  // return the canned page so the harness stays model-free.
  complete: async () => ({ text: STUB_HTML, record: ZERO_RECORD }),
  streamComplete: async () => ({ text: STUB_HTML, record: ZERO_RECORD }),
  // Validate the canned object against the real schema so a contract change that the stub no longer
  // satisfies fails loudly here rather than producing a malformed run.
  completeObject: async ({ schema }: { schema: { parse: (v: unknown) => unknown } }) => ({
    object: schema.parse(cannedObject(schema)) as never,
    record: ZERO_RECORD,
  }),
  // One canned web source; no real network. The researcher cites sourceIndex 0 into this list.
  searchWeb: async () => ({ text: 'E2E search text.', sources: [STUB_SOURCE], record: ZERO_RECORD }),
};
