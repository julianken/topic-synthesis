import { describe, expect, it, vi } from 'vitest';
import {
  CriticVerdictSchema,
  FindingsSchema,
  PageSpecSchema,
  PlanSchema,
  PrereqGraphSchema,
} from '../domain/stages';
import type { StageDeps } from '../pipeline/deps';
import { buildRequest, formatSummary, runSkeleton } from './run-skeleton';

const mkRec = () => ({
  providerModel: 'anthropic:claude-opus-4-8',
  inputTokens: 10,
  outputTokens: 10,
  costUsd: 0.01,
  rawUsage: {},
  finishReason: 'stop',
});

// Fake deps dispatched by Zod schema — serves the whole pipeline with no live model.
function fakeDeps(): StageDeps {
  const completeObject = vi.fn(async (opts: { schema: unknown; prompt: string }) => {
    if (opts.schema === PlanSchema) {
      return { object: { scope: 'S', subtopics: ['a'], researchQuestions: ['q1'] }, record: mkRec() };
    }
    if (opts.schema === FindingsSchema) return { object: { findings: [] }, record: mkRec() };
    if (opts.schema === PrereqGraphSchema) {
      return {
        object: {
          nodes: [
            { slug: 'n1', title: 'N1', summary: 's', coverageConfidence: 0.9 },
            { slug: 'n2', title: 'N2', summary: 's', coverageConfidence: 0.3 },
          ],
          edges: [],
        },
        record: mkRec(),
      };
    }
    if (opts.schema === PageSpecSchema) {
      return {
        object: { nodeSlug: 'n1', learningGoal: 'g', interactionKind: 'canvas', a11yContract: 'a', citations: [] },
        record: mkRec(),
      };
    }
    if (opts.schema === CriticVerdictSchema) return { object: { passed: true, critique: 'ok' }, record: mkRec() };
    throw new Error('unexpected schema');
  });
  const searchWeb = vi.fn(async () => ({ text: 't', sources: [], record: mkRec() }));
  const complete = vi.fn(async () => ({ text: '<!doctype html>', record: mkRec() }));
  return { complete, completeObject, searchWeb } as unknown as StageDeps;
}

describe('buildRequest', () => {
  it('parses flags and applies defaults', () => {
    const req = buildRequest(['--topic', 'Fourier transforms', '--level', 'advanced', '--depth', '4']);
    expect(req.topic).toBe('Fourier transforms');
    expect(req.settings.level).toBe('advanced');
    expect(req.settings.depth).toBe(4);
    expect(req.settings.audience).toBe('a self-taught learner'); // default
  });

  it('throws without --topic', () => {
    expect(() => buildRequest([])).toThrow(/topic/);
  });

  it('rejects an invalid level', () => {
    expect(() => buildRequest(['--topic', 'x', '--level', 'expert'])).toThrow(/level/);
  });

  it('does not swallow the next flag as a missing value', () => {
    // `--topic` with no value must throw, not silently take "--level" as the topic
    expect(() => buildRequest(['--topic', '--level', 'intro'])).toThrow(/topic/);
  });
});

describe('runSkeleton + formatSummary', () => {
  it('runs the pipeline and summarizes the curriculum + cost', async () => {
    const run = await runSkeleton({ topic: 'T', settings: { level: 'intro', depth: 2, audience: 'a' } }, fakeDeps());
    const summary = formatSummary(run);
    expect(summary).toContain('Curriculum —');
    expect(summary).toMatch(/\[built\].*n1/); // n1 (0.9) routed built + critic passed
    expect(summary).toMatch(/\[soon\].*n2/); // n2 (0.3) degraded to soon
    expect(summary).toContain('1/1 passed the critic');
    expect(summary).toContain('Total: $');
    expect(run.costUsd).toBeGreaterThan(0);
  });
});
