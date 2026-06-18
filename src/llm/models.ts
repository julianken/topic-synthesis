/** The model tiers topic-synthesis uses, by capability/cost (claude-api skill). */
export const MODELS = {
  opus: 'claude-opus-4-8',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5',
} as const;

export type ModelId = (typeof MODELS)[keyof typeof MODELS];

/**
 * Pipeline stage -> model tier. Opus for the reasoning-heavy stages (planner,
 * graph-builder, critic); Sonnet for the high-volume stages (researchers,
 * first-draft spec + code synthesis). This map IS the per-stage cost lever.
 */
export const STAGE_MODELS = {
  planner: MODELS.opus,
  researcher: MODELS.sonnet,
  graph: MODELS.opus,
  spec: MODELS.sonnet,
  code: MODELS.sonnet,
  critic: MODELS.opus,
} as const;

export type Stage = keyof typeof STAGE_MODELS;
