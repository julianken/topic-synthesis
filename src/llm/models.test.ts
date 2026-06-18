import { describe, expect, it } from 'vitest';
import { MODELS, STAGE_MODELS } from './models';
import { MODEL_PRICING } from './pricing';

describe('model tiers', () => {
  it('uses Opus for reasoning stages and Sonnet for volume stages', () => {
    expect(STAGE_MODELS.planner).toBe(MODELS.opus);
    expect(STAGE_MODELS.graph).toBe(MODELS.opus);
    expect(STAGE_MODELS.critic).toBe(MODELS.opus);
    expect(STAGE_MODELS.researcher).toBe(MODELS.sonnet);
    expect(STAGE_MODELS.spec).toBe(MODELS.sonnet);
    expect(STAGE_MODELS.code).toBe(MODELS.sonnet);
  });

  it('every stage model has pricing configured', () => {
    for (const model of Object.values(STAGE_MODELS)) {
      expect(MODEL_PRICING[model], `missing pricing for ${model}`).toBeDefined();
    }
  });
});
