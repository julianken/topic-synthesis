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
 *  teach"; the spec owns "how to present it"). */
export const PageSpecSchema = z.object({
  nodeSlug: z.string(),
  interactionKind: z.enum(INTERACTION_KINDS),
  /** Text-alternative + keyboard requirements — a generation target, not a retrofit. */
  a11yContract: z.string(),
  citations: z.array(SourceSchema),
});
export type PageSpec = z.infer<typeof PageSpecSchema>;

/** Code (Sonnet): the generated standalone page (HTML is free text, assembled here).
 *  `learningGoal` is echoed here from the `LessonBrief` (it left `PageSpec`) so the code
 *  and critic stages — which generate/judge against the goal — keep it without re-reading
 *  the brief; the goal's sole declaration site stays `LessonBrief`. */
export interface PageArtifact {
  nodeSlug: string;
  html: string;
  learningGoal: string;
  spec: PageSpec;
}

/** Critic (Opus, one pass): a binary rubric verdict over an artifact. */
export const CriticVerdictSchema = z.object({
  passed: z.boolean(),
  critique: z.string(),
});
export type CriticVerdict = z.infer<typeof CriticVerdictSchema>;

export interface CritiquedArtifact extends PageArtifact {
  passed: boolean;
  critique: string;
}

/** Hub assembler: the final tiered SITEMAP plus the pages it references. */
export interface PipelineResult {
  hub: SitemapHub;
  pages: CritiquedArtifact[];
}
