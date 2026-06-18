import { describe, expect, it, vi } from 'vitest';
import {
  CriticVerdictSchema,
  FindingsSchema,
  PageSpecSchema,
  PlanSchema,
  PrereqGraphSchema,
  type TopicRequest,
} from '../domain/stages';
import type { LlmCallRecord } from '../llm/client';
import { InlineEngine } from '../engine/inline-engine';
import type { StageDeps } from './deps';
import { runPipeline } from './run-pipeline';

const mkRec = (): LlmCallRecord => ({
  providerModel: 'anthropic:x',
  inputTokens: 10,
  outputTokens: 10,
  costUsd: 0.01,
  rawUsage: {},
  finishReason: 'stop',
});

// Fake deps that return stage-appropriate output, dispatched by the Zod schema each
// stage passes — so one fake serves the whole pipeline with no live model.
function fakeDeps(questions: string[] = ['q1', 'q2']): StageDeps {
  const completeObject = vi.fn(async (opts: { schema: unknown; prompt: string }) => {
    if (opts.schema === PlanSchema) {
      return { object: { scope: 'S', subtopics: ['a', 'b'], researchQuestions: questions }, record: mkRec() };
    }
    if (opts.schema === FindingsSchema) {
      return { object: { findings: [{ claim: 'c', sourceIndex: 0 }] }, record: mkRec() };
    }
    if (opts.schema === PrereqGraphSchema) {
      return {
        object: {
          nodes: [
            { slug: 'n1', title: 'N1', summary: 's', coverageConfidence: 0.9 }, // → built
            { slug: 'n2', title: 'N2', summary: 's', coverageConfidence: 0.3 }, // → soon
          ],
          edges: [{ from: 'n1', to: 'n2' }],
        },
        record: mkRec(),
      };
    }
    if (opts.schema === PageSpecSchema) {
      const slug = opts.prompt.match(/slug: (\w+)/)?.[1] ?? 'n1';
      return {
        object: { nodeSlug: slug, learningGoal: 'g', interactionKind: 'canvas', a11yContract: 'a', citations: [] },
        record: mkRec(),
      };
    }
    if (opts.schema === CriticVerdictSchema) {
      return { object: { passed: true, critique: 'ok' }, record: mkRec() };
    }
    throw new Error('unexpected schema');
  });
  const searchWeb = vi.fn(async () => ({
    text: 'synthesis',
    sources: [{ url: 'https://s.example', title: 'S' }],
    record: mkRec(),
  }));
  const complete = vi.fn(async () => ({ text: '<!doctype html><html></html>', record: mkRec() }));
  return { complete, completeObject, searchWeb } as unknown as StageDeps;
}

const req: TopicRequest = { topic: 'T', settings: { level: 'intro', depth: 2, audience: 'a' } };

describe('runPipeline', () => {
  it('runs plan → research → graph → gate → synth → hub and assembles the curriculum', async () => {
    const out = await runPipeline(req, new InlineEngine(), fakeDeps());

    // hub: n1 (coverage 0.9 → built, critic passed) and n2 (coverage 0.3 → soon)
    const pages = out.result.hub.tiers.flatMap((t) => t.categories.flatMap((c) => c.pages));
    const bySlug = (s: string) => pages.find((p) => p.slug === s);
    expect(bySlug('n1')?.status).toBe('built');
    expect(bySlug('n1')?.built).toBe(true);
    expect(bySlug('n2')?.status).toBe('soon');
    expect(bySlug('n2')?.built).toBe(false);

    // only the built-routed node is synthesized into a page (soon nodes are not fabricated)
    expect(out.result.pages).toHaveLength(1);
    expect(out.result.pages[0]?.nodeSlug).toBe('n1');
    expect(out.result.pages[0]?.passed).toBe(true);
  });

  it('threads every per-call record and totals the cost', async () => {
    const out = await runPipeline(req, new InlineEngine(), fakeDeps());
    // plan(1) + research 2 questions × (searchWeb + structure = 2) = 4 + graph(1) + n1 (spec+code+critic = 3) = 9
    expect(out.records).toHaveLength(9);
    expect(out.costUsd).toBeCloseTo(0.09, 6);
  });

  it('only the built-routed node runs synthesis (gate degrades the thin node)', async () => {
    const deps = fakeDeps();
    await runPipeline(req, new InlineEngine(), deps);
    // critic runs once (n1 only); n2 routed 'soon' so it never reaches spec/code/critic
    const criticCalls = (deps.completeObject as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([opts]) => opts.schema === CriticVerdictSchema,
    );
    expect(criticCalls).toHaveLength(1);
  });

  it('deduplicates identical research questions so each runs once (no phantom trace rows)', async () => {
    const deps = fakeDeps(['q1', 'q1', 'q2']); // q1 duplicated in the plan
    const out = await runPipeline(req, new InlineEngine(), deps);
    // 2 unique questions → web search runs twice, not three times
    expect((deps.searchWeb as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
    // records/cost reflect the 2 real research calls, not a double-counted duplicate
    expect(out.records).toHaveLength(9); // plan 1 + research 2×2 + graph 1 + synth 3
    expect(out.costUsd).toBeCloseTo(0.09, 6);
  });
});
