import type { Settings } from './settings';
import type { PageStatus, SitemapHub } from './sitemap';

// The pipeline's stage contracts. Each stage is a pure (input) => Promise<output>
// over these types; the engine/LLM wiring lives elsewhere. This file is the spine
// a reviewer can read to understand the whole ANALYSIS -> SYNTHESIS flow.

// ── input ──────────────────────────────────────────────────────────────────
export interface TopicRequest {
  topic: string;
  settings: Settings;
}

// ── ANALYSIS ─────────────────────────────────────────────────────────────────
/** Planner (Opus): decompose the topic into a coverage outline + research questions. */
export interface Plan {
  scope: string;
  subtopics: string[];
  researchQuestions: string[];
}

export interface Source {
  url: string;
  title: string;
  license?: string;
}

/** A grounded claim citing a source by index into `Research.sources`. */
export interface Finding {
  claim: string;
  sourceIndex: number;
}

/** Researcher (Sonnet, fanned out per question): grounded retrieval with provenance. */
export interface Research {
  subtopic: string;
  sources: Source[];
  findings: Finding[];
}

export interface ConceptNode {
  slug: string;
  title: string;
  summary: string;
}

/** Graph-builder (Opus): a prerequisite DAG over concept nodes. */
export interface PrereqGraph {
  nodes: ConceptNode[];
  /** Directed edges [from, to] meaning "from is a prerequisite of to". */
  edges: Array<[from: string, to: string]>;
}

/** A node after the grounding/coverage gate decides how (or whether) to build it. */
export interface GatedNode extends ConceptNode {
  /** 0..1 confidence that retrieval covers this node well enough to build it. */
  coverageConfidence: number;
  route: PageStatus; // 'built' | 'text' | 'soon'
}

export interface GatedGraph {
  nodes: GatedNode[];
  edges: Array<[from: string, to: string]>;
  /** Topological order of node slugs; the gate rejects a non-DAG. */
  topoOrder: string[];
}

// ── SYNTHESIS ────────────────────────────────────────────────────────────────
export type InteractionKind = 'canvas' | 'svg' | 'html';

/** Spec (Sonnet): the plan for one page, including its accessibility contract. */
export interface PageSpec {
  nodeSlug: string;
  learningGoal: string;
  interactionKind: InteractionKind;
  /** Text-alternative + keyboard requirements — a generation target, not a retrofit. */
  a11yContract: string;
  citations: Source[];
}

/** Code (Sonnet): the generated standalone page. */
export interface PageArtifact {
  nodeSlug: string;
  html: string;
  spec: PageSpec;
}

/** Critic (Opus, one pass): a binary rubric verdict over an artifact. */
export interface CritiquedArtifact extends PageArtifact {
  passed: boolean;
  critique: string;
}

/** Hub assembler: the final tiered SITEMAP plus the pages it references. */
export interface PipelineResult {
  hub: SitemapHub;
  pages: CritiquedArtifact[];
}
