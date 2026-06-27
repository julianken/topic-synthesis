import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Settings } from './settings';
import type { PageStatus, SitemapHub } from './sitemap';

// The pipeline's stage contracts. The ANALYSIS stages cross the LLM boundary, so
// their outputs are Zod schemas (validated by `completeObject`); types are inferred
// from the schemas so the two can't drift. The assembled/gate outputs that never
// come from an LLM stay plain TS types. This file is the spine a reviewer can read
// to follow the whole ANALYSIS -> SYNTHESIS flow.

// ── input (not an LLM output) ────────────────────────────────────────────────
export interface TopicRequest {
  topic: string;
  settings: Settings;
}

// ── ANALYSIS (LLM-boundary outputs → Zod schemas) ────────────────────────────
/** Planner (Opus): decompose the topic into a coverage outline + research questions. */
export const PlanSchema = z.object({
  scope: z.string(),
  subtopics: z.array(z.string()),
  researchQuestions: z.array(z.string()),
});
export type Plan = z.infer<typeof PlanSchema>;

export const SourceSchema = z.object({
  url: z.string(),
  title: z.string(),
  license: z.string().optional(),
});
export type Source = z.infer<typeof SourceSchema>;

/** A grounded claim citing a source by index into `Research.sources`. */
export const FindingSchema = z.object({
  claim: z.string(),
  sourceIndex: z.number().int().nonnegative(),
});
export type Finding = z.infer<typeof FindingSchema>;

/** Researcher (Sonnet, fanned out per question): grounded retrieval with provenance. */
export const ResearchSchema = z.object({
  subtopic: z.string(),
  sources: z.array(SourceSchema),
  findings: z.array(FindingSchema),
});
export type Research = z.infer<typeof ResearchSchema>;

/** The researcher's structuring pass: findings cited by index into the REAL retrieved
 *  sources (the source list comes from the web search, not from the model). */
export const FindingsSchema = z.object({
  findings: z.array(FindingSchema),
});
export type Findings = z.infer<typeof FindingsSchema>;

/** A concept node with the graph-builder's coverage judgement (0..1). */
export const GraphNodeSchema = z.object({
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  /** 0..1 confidence that retrieval covers this node well enough to build it. */
  coverageConfidence: z.number().min(0).max(1),
});
export type GraphNode = z.infer<typeof GraphNodeSchema>;

/** A prerequisite edge: `from` is a prerequisite of `to`. Modeled as an object
 *  (not a tuple) so the JSON schema stays portable across providers (Gemini). */
export const PrereqEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
});
export type PrereqEdge = z.infer<typeof PrereqEdgeSchema>;

/** Graph-builder (Opus): a prerequisite DAG over concept nodes + coverage.
 *  DORMANT(curriculum-wrapper — ADR-0003 / epic #52): consumed ONLY by the dormant curriculum path
 *  (`graph` → `coverage-gate` → `runPipeline`); the live single-lesson path never produces one.
 *  RETAINED for the wrapper milestone. See ADR-0003. */
export const PrereqGraphSchema = z.object({
  nodes: z.array(GraphNodeSchema),
  edges: z.array(PrereqEdgeSchema),
});
export type PrereqGraph = z.infer<typeof PrereqGraphSchema>;

// ── grounding/coverage gate (pure, deterministic — assembled, not from an LLM) ─
/** A node after the gate decides how (or whether) to build it. */
export interface GatedNode extends GraphNode {
  route: PageStatus; // 'built' | 'text' | 'soon'
}

/** DORMANT(curriculum-wrapper — ADR-0003 / epic #52): the gated prerequisite graph the
 *  coverage-gate emits for the dormant curriculum path (`runPipeline`) ONLY. RETAINED for the
 *  wrapper milestone. See ADR-0003. */
export interface GatedGraph {
  nodes: GatedNode[];
  edges: PrereqEdge[];
  /** Topological order of node slugs; the gate rejects a non-DAG. */
  topoOrder: string[];
}

// ── the Analysis → Synthesis seam: the LessonBrief contract ──────────────────
/**
 * A finding denormalized for the brief: the grounded claim text PLUS its source
 * inline (not an index into a separate array). The brief is the single object that
 * crosses the Analysis→Synthesis seam, so it must be self-contained — Synthesis
 * (spec) needs no parallel `sources` array to resolve a citation.
 */
export const BriefFindingSchema = z.object({
  claim: z.string(),
  source: SourceSchema,
});
export type BriefFinding = z.infer<typeof BriefFindingSchema>;

/**
 * The Analysis→Synthesis contract. The `brief` stage (Analysis) produces ONE
 * LessonBrief from `plan + research[]`; the `spec` stage (Synthesis) consumes it.
 * It is the single source of truth for "what to teach": `learningGoal` lives here
 * (moved off `PageSpec`), and the grounded `findings` (claim + source) reach
 * Synthesis through it — fixing the fact-starvation where findings were dropped at
 * the graph stage and never reached the spec.
 */
export const LessonBriefSchema = z.object({
  /** The single thing the lesson must teach (moved off PageSpec — owned by Analysis). */
  learningGoal: z.string(),
  /** The essential points a learner must come away with. */
  keyPoints: z.array(z.string()),
  /** Grounded claims with their sources inline, so the brief is self-contained. */
  findings: z.array(BriefFindingSchema),
  /** Audience framing so Synthesis gets the framing without re-reading Settings. */
  audience: z.string(),
});
export type LessonBrief = z.infer<typeof LessonBriefSchema>;

/**
 * A stable schema-hash anchor for the LessonBrief contract. Derived from the
 * schema's JSON-Schema projection (deterministic for a given shape) — NOT a
 * hand-bumped const, so it tracks the contract automatically. This is the single
 * import point for the contract-aware workflow_version (folds it into the persisted
 * `workflow_version`) and validate-on-resume (the later issues of this refocus);
 * neither has to re-derive a hash. The hash changes iff the brief's shape changes.
 */
export const LESSON_BRIEF_SCHEMA_HASH: string = createHash('sha256')
  .update(JSON.stringify(z.toJSONSchema(LessonBriefSchema)), 'utf8')
  .digest('hex')
  .slice(0, 16);

// ── SYNTHESIS ────────────────────────────────────────────────────────────────
export const INTERACTION_KINDS = ['canvas', 'svg', 'html'] as const;
export type InteractionKind = (typeof INTERACTION_KINDS)[number];

/** Spec (Sonnet): the plan for one page, including its accessibility contract.
 *  `learningGoal` is NOT here — it moved to `LessonBrief` (Analysis owns "what to
 *  teach"; the spec owns "how to present it").
 *
 *  This is the FLAT spec shape — the BLOB arm's contract (`defaultStages.spec`, the
 *  reachable kill-switch / fallback — no longer the live default; the live default is now the
 *  v11-graded arm via `LIVE_ARM`, TS-15b/#107). It is RETAINED unchanged so the blob path is byte-for-
 *  byte the same; the v11 arm's richer pedagogy descriptor is `LessonSpecSchema` below
 *  (TS-10), a SECTIONED contract the v11 `spec` prompt (TS-11) fills. The two coexist as
 *  the two arms of `PageArtifact.spec` — neither is the other's pedagogy descriptor. */
export const PageSpecSchema = z.object({
  nodeSlug: z.string(),
  interactionKind: z.enum(INTERACTION_KINDS),
  /** Text-alternative + keyboard requirements — a generation target, not a retrofit. */
  a11yContract: z.string(),
  citations: z.array(SourceSchema),
});
export type PageSpec = z.infer<typeof PageSpecSchema>;

// ── the typed sectioned LessonSpec (TS-10 — the v11 Synthesis pedagogy contract) ──
/**
 * The ordered pedagogical section kinds, mirroring the locked DESIGN.md `## Lesson layout`
 * per-section composition (DESIGN.md wins on any design conflict — cited here, NOT restated).
 * A lesson is a DOCUMENT of these typed sections, so the pedagogy a critic grades is the
 * pedagogy the spec is required to PLAN — no longer invisible behind one `interactionKind`
 * enum + a prose `a11yContract`. Exactly these seven, in this canonical order.
 */
export const SECTION_KINDS = [
  'hook',
  'concrete-case',
  'concept',
  'worked-example',
  'intuition',
  'self-check',
  'takeaways',
] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

/**
 * The apparatus-component kinds a section may carry. The two LOAD-BEARING pedagogy
 * primitives — `predict-gate` (a predict-then-reveal interactive) and `self-check` (an
 * answerable retrieval check) — sit alongside the visual kinds reframed from
 * `INTERACTION_KINDS` (`canvas`/`svg`/`html`). The literal per-section apparatus CAP
 * (≤3 glosses + ≤1 mini-figure, DESIGN.md `## Lesson layout` decision 1 — the SoT) is
 * deliberately NOT modeled here: PATH B — glosses + mini-figures are rendered apparatus the
 * TS-12 `code` stage emits FROM THE BRIEF, so that cap is enforced at the TS-12 code PROMPT,
 * not as a `LessonSpec` field. A future typed-gloss refactor (first-class `LessonSpec` gloss
 * fields with a schema `.max(3)`/`.max(1)`) is deferred + GAPS-tracked. This contract models
 * STRUCTURE only: the section taxonomy + the ≤1-apparatus-component-per-section invariant.
 */
export const APPARATUS_KINDS = ['predict-gate', 'self-check', 'canvas', 'svg', 'html'] as const;
export type ApparatusKind = (typeof APPARATUS_KINDS)[number];

/**
 * One apparatus component on a section: its kind plus a STATED teaching purpose. The
 * `teachingPurpose` is schema-constrained `z.string().min(1)` — a non-empty stated purpose,
 * so a parse error catches an apparatus carrying NO stated reason to exist. This is the
 * schema-level encoding of the ledger's apparatus rule ("apparatus must ADD what the prose
 * doesn't already state — never filler", DESIGN.md `## Lesson layout`). NOTE: whether a
 * non-empty purpose is GENERIC ("an interactive widget") rather than specific is a CRITIC
 * judgement (the TS-7 graded arm — `apparatusAddsBeyondProse`), NOT a schema regex — the
 * schema only proves a purpose was stated; TS-7 owns the empty/generic-purpose finding.
 */
export const ComponentSchema = z.object({
  kind: z.enum(APPARATUS_KINDS),
  /**
   * A non-empty stated teaching purpose. Empty OR whitespace-only → parse error; GENERIC → a
   * TS-7 critic finding. `.trim()` runs before `.min(1)` so a "   " purpose can't sneak past the
   * guard as a non-empty primitive (Zod trims, then length-checks).
   */
  teachingPurpose: z.string().trim().min(1),
  /**
   * An answerable item, REQUIRED on `self-check`/`predict-gate` components and optional
   * elsewhere. It carries a non-empty `prompt` + `answer` pair (typed, not free prose) so the
   * "answerable item" requirement is checkable — a self-check with an empty/whitespace-only
   * prompt or answer is not a real retrieval check (`.trim().min(1)` rejects both). A
   * `.superRefine` below requires it on the primitive kinds.
   */
  answerable: z
    .object({
      prompt: z.string().trim().min(1),
      answer: z.string().trim().min(1),
    })
    .optional(),
});
export type Component = z.infer<typeof ComponentSchema>;

/**
 * One section of the lesson: its kind, its prose, and AT MOST ONE optional apparatus
 * component (the ≤1-apparatus-component-per-section invariant this contract defines; TS-11
 * enforces it at emission). `prose` is the section's reading-spine text — the SYNTHESIS
 * material the `code` stage renders into the frozen reading column.
 */
export const SectionSchema = z
  .object({
    kind: z.enum(SECTION_KINDS),
    prose: z.string(),
    component: ComponentSchema.optional(),
  })
  .superRefine((section, ctx) => {
    // A primitive component (predict-gate / self-check) MUST carry an answerable item with a
    // non-empty prompt + answer — that is what makes it a real retrieval check rather than a
    // free reveal. Encoded as a typed field, not free prose, so it is checkable (plan step 5).
    const c = section.component;
    if (!c) return;
    const isPrimitive = c.kind === 'predict-gate' || c.kind === 'self-check';
    if (isPrimitive && !c.answerable) {
      ctx.addIssue({
        code: 'custom',
        message: `a ${c.kind} component must carry an answerable { prompt, answer } item`,
        path: ['component', 'answerable'],
      });
    }
  });
export type Section = z.infer<typeof SectionSchema>;

/**
 * The typed sectioned LessonSpec (TS-10) — the v11 arm's Synthesis pedagogy contract,
 * replacing the flat `interactionKind` descriptor with an ORDERED array of typed sections.
 * `learningGoal` stays OFF the spec (it lives only on `LessonBrief` — Analysis owns "what to
 * teach"); `a11yContract` + `citations` carry forward from `PageSpec` (still generation
 * targets). The LOAD-BEARING pedagogy primitives are NON-OPTIONAL, and the escape hatch is
 * NARROW. A valid spec is one of exactly two shapes (enforced by the `.superRefine` below):
 *   • a FULL lesson: BOTH primitives present — (≥1 `predict-gate` component) AND (≥1 `self-check`
 *     carrying an answerable item) — and NO `documentedReasonAbsent`; or
 *   • a genuine APPARATUS-FREE reference page: NEITHER primitive present AND a non-empty
 *     `documentedReasonAbsent` explaining why.
 * A HALF-apparatus spec (one primitive present, the other missing) is INVALID even WITH a
 * `documentedReasonAbsent` — that string excuses ONLY a true no-apparatus page, never a partial
 * lesson. This closes the TS-12b hole where a non-empty `documentedReasonAbsent` was rescuing a
 * predict-gate-only 1-section lesson (a string lie bypassing the both-primitives requirement). A
 * section-count FLOOR (`MIN_LESSON_SECTIONS`) backs this: even a pure-reference page is multi-
 * section, so a degenerate 1-section spec cannot parse on either shape — "teaches nothing" stays
 * UNPARSEABLE while one deliberate, reviewable exit remains.
 */
/**
 * The minimum section count a valid `LessonSpec` must carry. A real lesson is multi-section by
 * construction: a hook + ≥1 content section + a self-check + takeaways is already four, and even a
 * pure-reference page (the documented-reason exit) is still a multi-section document, never a single
 * blob. The floor is therefore 4 — it makes the degenerate 1-section spec observed in TS-12b (a lone
 * `hook` with a predict-gate, no self-check, rescued by a `documentedReasonAbsent` string)
 * UNPARSEABLE on either valid shape. It is a STRUCTURAL floor, not a richness target: the prompt
 * asks for one section per key point (typically more), and the critic grades depth; this only stops
 * the obviously-degenerate case the schema is the last guard against.
 */
export const MIN_LESSON_SECTIONS = 4 as const;

export const LessonSpecSchema = z
  .object({
    nodeSlug: z.string(),
    /** The ordered typed sections — the pedagogy descriptor (replaces the flat interactionKind).
     *  Floored at `MIN_LESSON_SECTIONS`: a 1-section spec cannot parse (the TS-12b degenerate case). */
    sections: z.array(SectionSchema).min(MIN_LESSON_SECTIONS),
    /** Text-alternative + keyboard requirements — a generation target, not a retrofit. */
    a11yContract: z.string(),
    citations: z.array(SourceSchema),
    /**
     * The single typed ESCAPE HATCH (program decision 5), NARROWED in TS-12b: a non-empty reason a
     * lesson carries NEITHER load-bearing primitive — a genuinely apparatus-free page (e.g. a
     * pure-definition / glossary / reference page where both a predict-gate and a self-check are
     * pedagogically wrong). It excuses ONLY a true no-apparatus page: it is INVALID when EITHER
     * primitive is present (a half-apparatus lesson + an escape string is the abuse TS-12b found —
     * a predict-gate-only spec set this to a lie to bypass the both-primitives requirement). Omit it
     * whenever any primitive is present. `.trim()` runs before `.min(1)` so a whitespace-only "   "
     * reason cannot silently rescue a primitive-less spec — this field has no downstream critic
     * backstop, so the schema is the only guard.
     */
    documentedReasonAbsent: z.string().trim().min(1).optional(),
  })
  .superRefine((specObj, ctx) => {
    const hasPredictGate = specObj.sections.some((s) => s.component?.kind === 'predict-gate');
    // A self-check primitive: a `self-check` component carrying an answerable item. (A bare
    // `self-check` SECTION with no answerable component does not satisfy the primitive — the
    // answerable item is what makes it a real check; the SectionSchema refine guarantees a
    // `self-check` component always has one, so testing the component kind is sufficient here.)
    const hasSelfCheck = specObj.sections.some(
      (s) => s.component?.kind === 'self-check' && !!s.component.answerable,
    );
    const documented = !!specObj.documentedReasonAbsent; // .trim().min(1) rejects empty AND whitespace-only

    // TS-12b — the escape hatch may ONLY excuse a GENUINE no-apparatus page. A spec is valid iff it
    // is one of exactly two shapes:
    //   • a FULL lesson — BOTH primitives present (predict-gate AND self-check); or
    //   • a true APPARATUS-FREE reference page — NEITHER primitive present AND a documentedReasonAbsent.
    // A HALF-apparatus spec (one primitive present, the other missing) is INVALID even with a
    // documentedReasonAbsent — closing the hole where a non-empty string rescued a predict-gate-only
    // lesson by bypassing the both-primitives requirement.
    const fullLesson = hasPredictGate && hasSelfCheck;
    const apparatusFreeReference = !hasPredictGate && !hasSelfCheck && documented;
    if (!fullLesson && !apparatusFreeReference) {
      ctx.addIssue({
        code: 'custom',
        message:
          'a LessonSpec must EITHER carry BOTH primitives — ≥1 predict-gate component AND ≥1 ' +
          'self-check with an answerable item — OR be a genuine apparatus-free reference page: ' +
          'NEITHER primitive present AND a non-empty documentedReasonAbsent. A half-apparatus spec ' +
          '(one primitive present, the other missing) is invalid; documentedReasonAbsent excuses ' +
          'only a page with NO predict-gate and NO self-check.',
        path: ['documentedReasonAbsent'],
      });
    }
  });
export type LessonSpec = z.infer<typeof LessonSpecSchema>;

/** Code (Sonnet): the generated standalone page (HTML is free text, assembled here).
 *  `learningGoal` is echoed here from the `LessonBrief` (it left `PageSpec`) so the code
 *  and critic stages — which generate/judge against the goal — keep it without re-reading
 *  the brief; the goal's sole declaration site stays `LessonBrief`.
 *
 *  `spec` is the ARM-SCOPED union: the blob arm carries the flat `PageSpec`, the v11
 *  arm (TS-11+) carries the sectioned `LessonSpec`. `a11yContract` is on BOTH arms; the
 *  flat `interactionKind` is blob-only and the `sections` array is v11-only — `isLessonSpec`
 *  narrows between them. (TS-10 is contract-only: no entrypoint emits a `LessonSpec` yet,
 *  so the live artifact is still always a `PageSpec` — the union just lets the new arm slot
 *  in without re-breaking the blob path.) */
export interface PageArtifact {
  nodeSlug: string;
  html: string;
  learningGoal: string;
  spec: PageSpec | LessonSpec;
}

/** Narrow the arm-scoped `PageArtifact.spec` union: a sectioned v11 `LessonSpec` (which has a
 *  `sections` array) vs the flat blob `PageSpec` (which has `interactionKind`). The blob path
 *  reads `interactionKind` only after this guard says it is a `PageSpec`. */
export function isLessonSpec(spec: PageSpec | LessonSpec): spec is LessonSpec {
  return 'sections' in spec;
}

/** Critic (Opus, one pass): a binary rubric verdict over an artifact.
 *  RETAINED as the blob arm's verdict shape (`defaultStages.critic` = `critique`); the
 *  graded v11 arm uses `GradedCriticVerdictSchema` below (program decision 7 — the v11
 *  graded critic is a `StageBundle.critic` swap, the PROMOTED live default via `LIVE_ARM`,
 *  TS-15b/#107; the binary fn stays the reachable kill-switch). */
export const CriticVerdictSchema = z.object({
  passed: z.boolean(),
  critique: z.string(),
});
export type CriticVerdict = z.infer<typeof CriticVerdictSchema>;

// ── CriticVerdict v2 (GRADED) — named learning-efficacy + ledger-conformance ──
/**
 * A single graded sub-score: a bounded 0..1 number the threshold can reduce, plus a
 * short per-criterion note the prompt (TS-7) writes. 0 = absent/fails, 1 = fully met.
 * The number is graded by the LLM (TS-7's ledger-aware prompt); `passed` is NOT — it is
 * DERIVED from these sub-scores by `derivePassed` (program decision 3 — `passed` is the
 * single gate, computed not LLM-asserted). No sub-score asserts rendered geometry: the
 * layout group below grades only source-static proxies (the repo has no headless renderer,
 * so `getBoundingClientRect`/overflow can't be measured — program decision 5 / R-anti-invention).
 */
export const CriticSubScoreSchema = z.object({
  score: z.number().min(0).max(1),
  note: z.string(),
});
export type CriticSubScore = z.infer<typeof CriticSubScoreSchema>;

/**
 * The named learning-efficacy sub-criteria (program decision 5). A scalar
 * `teachingQuality` hides vapidity, so the teaching score is DECOMPOSED into named axes a
 * vapid lesson fails individually instead of squeaking past one opaque number. The
 * ledger-aware grading prompt is TS-7's deliverable; this is the schema only.
 */
export const LearningEfficacySchema = z.object({
  /** Engages a real misconception / live question, not a flat definition dump. */
  misconceptionHook: CriticSubScoreSchema,
  /** ≥1 genuine predict-then-reveal / retrieval check with ANSWER-SPECIFIC feedback. */
  retrievalCheck: CriticSubScoreSchema,
  /** Claims are grounded in the brief's findings, not invented. */
  findingsGrounded: CriticSubScoreSchema,
  /** Apparatus adds what the prose doesn't state — never filler. */
  apparatusAddsBeyondProse: CriticSubScoreSchema,
});
export type LearningEfficacy = z.infer<typeof LearningEfficacySchema>;

/**
 * The statically-checkable ledger-conformance sub-criteria (program decision 5). These
 * grade the lesson-layout acceptance bar (DESIGN.md → `## Lesson layout`, which wins on any
 * conflict — cited, NOT restated here) using only proxies checkable from the HTML SOURCE.
 * Pixel-exact spine verification is deferred (a TS-4 GAPS row) and is deliberately NOT here.
 */
export const LedgerConformanceSchema = z.object({
  /** The named grid-line set `[screen-start] [read] [gap] [panel] [scrub]` is present (incl. `[scrub]`). */
  namedGridPresent: CriticSubScoreSchema,
  /** Each `<section>` declares its own subgrid (the stable spine, source-checkable). */
  perSectionSubgrid: CriticSubScoreSchema,
  /** The `≤900px` single-column collapse media query is present. */
  collapseQueryPresent: CriticSubScoreSchema,
  /** No hardcoded `:root` color/geometry literal override of the §0 tokens. */
  noRootLiteralOverride: CriticSubScoreSchema,
  /** Interactivity is predict-gate-only structure (predict → reveal), not a free reveal. */
  predictGateStructure: CriticSubScoreSchema,
});
export type LedgerConformance = z.infer<typeof LedgerConformanceSchema>;

/**
 * CriticVerdict v2 (GRADED). Two named sub-score groups (learning-efficacy + ledger-
 * conformance) plus `passed` (DERIVED — see `derivePassed`) and a free-text `critique`. It
 * carries NO `regressionVsBestPrior` (or any best-prior-comparison) field: that comparison
 * is the OFFLINE eleatic `--baseline` bench, never an in-run gate (program decision 3 / R3).
 * `passed` is included so the gate (`synth.artifact?.passed`) and the binary blob arm read
 * the same field whichever critic fn ran — but the graded arm OVERWRITES the LLM's `passed`
 * with the derived value, so it is computed, not taken verbatim from the model.
 */
export const GradedCriticVerdictSchema = z.object({
  passed: z.boolean(),
  critique: z.string(),
  learningEfficacy: LearningEfficacySchema,
  ledgerConformance: LedgerConformanceSchema,
});
export type GradedCriticVerdict = z.infer<typeof GradedCriticVerdictSchema>;

/**
 * The single documented `passed` threshold (program decision 3 / open-question 4 — the one
 * documented threshold). A verdict passes iff EVERY sub-score (both groups) is ≥ this value.
 * An all-axes floor (not a mean) is chosen so a single failing named axis — e.g. a vapid
 * lesson with no real retrieval check — sinks the verdict instead of being averaged away
 * (that all-axes-floor is the whole point of decomposing the teaching score). The literal
 * 0.6 was the documented starting value; TS-15b (issue #107) CONFIRMED it against REAL v11
 * emissions — a clean 3/3 calibration (the owner-accepted real lesson(s) derived `passed = true`
 * and a deliberately-degraded one derived `false` at this threshold) with no fixture-corpus
 * regression — so 0.6 is RETAINED by the real-run evidence, not left as-is by omission. The
 * live default arm is now the v11-graded arm (run-job.ts `LIVE_ARM`). Change the const, not
 * scattered comparisons.
 */
export const CRITIC_PASS_THRESHOLD = 0.6 as const;

/**
 * Derive `passed` from a graded verdict's sub-scores: true iff every sub-score in both the
 * learning-efficacy and ledger-conformance groups is ≥ `CRITIC_PASS_THRESHOLD`. Pure — no
 * I/O, no LLM — so the graded-critic fn computes `passed` rather than trusting the model's
 * self-asserted boolean (program decision 3 — `passed` is the single derived gate).
 */
export function derivePassed(verdict: {
  learningEfficacy: LearningEfficacy;
  ledgerConformance: LedgerConformance;
}): boolean {
  const subScores: CriticSubScore[] = [
    ...Object.values(verdict.learningEfficacy),
    ...Object.values(verdict.ledgerConformance),
  ];
  return subScores.every((s) => s.score >= CRITIC_PASS_THRESHOLD);
}

export interface CritiquedArtifact extends PageArtifact {
  passed: boolean;
  critique: string;
  /** The graded sub-scores, present only when the graded critic arm ran (binary arm omits them). */
  scores?: {
    learningEfficacy: LearningEfficacy;
    ledgerConformance: LedgerConformance;
  };
}

/** Hub assembler: the final tiered SITEMAP plus the pages it references. */
export interface PipelineResult {
  hub: SitemapHub;
  pages: CritiquedArtifact[];
}
