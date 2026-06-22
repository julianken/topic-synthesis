import { describe, expect, it } from 'vitest';
import { cheapModels, registryId, STAGE_MODELS, type Stage } from './models';
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

describe('cheapModels (the single source of truth for the cheap profile)', () => {
  it('runs ANALYSIS on Haiku and SYNTHESIS on Sonnet (so a single lesson actually builds)', () => {
    const m = cheapModels();
    expect(m.planner.model).toBe('claude-haiku-4-5'); // analysis → Haiku
    expect(m.researcher.model).toBe('claude-haiku-4-5');
    expect(m.graph.model).toBe('claude-haiku-4-5');
    expect(m.brief.model).toBe('claude-haiku-4-5');
    expect(m.spec.model).toBe('claude-sonnet-4-6'); // synthesis → Sonnet
    expect(m.code.model).toBe('claude-sonnet-4-6');
    expect(m.critic.model).toBe('claude-sonnet-4-6');
  });

  it('covers every stage in STAGE_MODELS (a full, total map — no missing stage)', () => {
    const m = cheapModels();
    for (const stage of Object.keys(STAGE_MODELS) as Stage[]) {
      expect(m[stage], `cheapModels() missing ${stage}`).toBeDefined();
    }
  });

  it('every cheap stage model has pricing configured', () => {
    for (const model of Object.values(cheapModels())) {
      const id = registryId(model);
      expect(MODEL_PRICING[id], `missing pricing for ${id}`).toBeDefined();
    }
  });
});
