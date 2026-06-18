export type Provider = 'anthropic' | 'openai' | 'google' | 'local';
export type Stage = 'planner' | 'researcher' | 'graph' | 'spec' | 'code' | 'critic';

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
 * (planner, graph-builder, critic); Sonnet for the high-volume stages
 * (researchers, first-draft spec + code). A workflow_version overrides this map —
 * that override IS the A/B arm.
 */
export const STAGE_MODELS: Record<Stage, StageModel> = {
  planner: { provider: 'anthropic', model: 'claude-opus-4-8', params: { effort: 'high' } },
  researcher: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  graph: { provider: 'anthropic', model: 'claude-opus-4-8', params: { effort: 'high' } },
  spec: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  code: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  critic: { provider: 'anthropic', model: 'claude-opus-4-8', params: { effort: 'high' } },
};
