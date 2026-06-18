import { describe, expect, it } from 'vitest';
import { registryId, STAGE_MODELS } from './models';
import { MODEL_PRICING } from './pricing';

describe('stage models', () => {
  it('assigns Opus to reasoning stages and Sonnet to volume stages', () => {
    expect(STAGE_MODELS.planner.model).toBe('claude-opus-4-8');
    expect(STAGE_MODELS.graph.model).toBe('claude-opus-4-8');
    expect(STAGE_MODELS.critic.model).toBe('claude-opus-4-8');
    expect(STAGE_MODELS.researcher.model).toBe('claude-sonnet-4-6');
    expect(STAGE_MODELS.spec.model).toBe('claude-sonnet-4-6');
    expect(STAGE_MODELS.code.model).toBe('claude-sonnet-4-6');
  });

  it('registryId composes provider:model', () => {
    expect(registryId(STAGE_MODELS.planner)).toBe('anthropic:claude-opus-4-8');
  });

  it('every default stage model has pricing configured', () => {
    for (const m of Object.values(STAGE_MODELS)) {
      const id = registryId(m);
      expect(MODEL_PRICING[id], `missing pricing for ${id}`).toBeDefined();
    }
  });
});
