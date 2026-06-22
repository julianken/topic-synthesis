export type Provider = 'anthropic' | 'openai' | 'google' | 'local';
export type Stage = 'planner' | 'researcher' | 'graph' | 'brief' | 'spec' | 'code' | 'critic';

/**
 * Provider-specific knobs that ride on a StageModel. These have NO portable
 * cross-provider equivalent (effort/thinking/cache are Anthropic concepts), which
 * is why a workflow-version arm differs in more than {provider, model}. They are
 * carried here for the arm config but NOT YET applied at the call site — wiring
 * effort/thinking to providerOptions is deferred (the Anthropic typed-output ↔
 * adaptive-thinking conflict needs a spike first; see docs/research).
 */
export interface StageParams {
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  thinking?: boolean;
  cacheSystem?: boolean;
}

/** What model a stage runs on. A workflow_version arm is `Record<Stage, StageModel>`. */
export interface StageModel {
  provider: Provider;
  model: string;
  params?: StageParams;
}

/** The combined id used to key pricing + the AI SDK provider registry: "<provider>:<model>". */
export function registryId(m: StageModel): string {
  return `${m.provider}:${m.model}`;
}

/**
 * Default per-stage model assignment. Opus for the reasoning-heavy stages
 * (planner, graph-builder, brief, critic); Sonnet for the high-volume stages
 * (researchers, first-draft spec + code). A workflow_version overrides this map —
 * that override IS the A/B arm.
 */
export const STAGE_MODELS: Record<Stage, StageModel> = {
  planner: { provider: 'anthropic', model: 'claude-opus-4-8', params: { effort: 'high' } },
  researcher: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  graph: { provider: 'anthropic', model: 'claude-opus-4-8', params: { effort: 'high' } },
  brief: { provider: 'anthropic', model: 'claude-opus-4-8', params: { effort: 'high' } },
  spec: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  code: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  critic: { provider: 'anthropic', model: 'claude-opus-4-8', params: { effort: 'high' } },
};

const HAIKU: StageModel = { provider: 'anthropic', model: 'claude-haiku-4-5' };
const SONNET: StageModel = { provider: 'anthropic', model: 'claude-sonnet-4-6' };

/** SYNTHESIS stages run on Sonnet even in the cheap profile: Haiku's output cap truncated the
 *  interactive page, and for a SINGLE lesson a truncated `code` stage degrades the whole lesson to
 *  'soon'. Sonnet's larger output budget reliably builds a full page. */
const CHEAP_SYNTHESIS: ReadonlySet<Stage> = new Set(['spec', 'code', 'critic']);

/**
 * The cheap workflow profile, the SINGLE source of truth for it. ANALYSIS stages
 * (planner/researcher/graph/brief) run on Haiku to stay low-cost; SYNTHESIS stages (spec/code/critic)
 * run on Sonnet so a single lesson actually builds (Haiku's output cap truncates the page, degrading
 * the lesson to 'soon'). Used by every cheap entrypoint: `--cheap` (`run-skeleton`), the Job's `CHEAP`
 * env (`run-job`), and the local-dev in-process fallback (`api/generate`) — so all three build on the
 * same Haiku-analysis/Sonnet-synthesis tier. A pure StageModel-map function, no heavy deps: it lives
 * here (alongside `STAGE_MODELS`) as the fence-clean home importable by both `src/app` and `src/eval`.
 */
export function cheapModels(): Record<Stage, StageModel> {
  const models = {} as Record<Stage, StageModel>;
  for (const stage of Object.keys(STAGE_MODELS) as Stage[]) {
    models[stage] = CHEAP_SYNTHESIS.has(stage) ? SONNET : HAIKU;
  }
  return models;
}
