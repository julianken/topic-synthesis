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
import type { StageModel } from '../llm/models';
import type { Engine } from '../engine/engine';
import { InlineEngine } from '../engine/inline-engine';
import { SpanCollector } from '../trace/span';
import type { StageDeps } from './deps';
import { defaultStages, type StageBundle } from './ports';
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
function fakeDeps(questions: string[] = ['q1', 'q2'], coverages: number[] = [0.9, 0.3]): StageDeps {
  const completeObject = vi.fn(async (opts: { schema: unknown; prompt: string; model: StageModel }) => {
    if (opts.schema === PlanSchema) {
      return { object: { scope: 'S', subtopics: ['a', 'b'], researchQuestions: questions }, record: mkRec() };
    }
    if (opts.schema === FindingsSchema) {
      return { object: { findings: [{ claim: 'c', sourceIndex: 0 }] }, record: mkRec() };
    }
    if (opts.schema === PrereqGraphSchema) {
      const nodes = coverages.map((c, i) => ({
        slug: `n${i + 1}`,
        title: `N${i + 1}`,
        summary: 's',
        coverageConfidence: c,
      }));
      return { object: { nodes, edges: [] }, record: mkRec() };
    }
    if (opts.schema === PageSpecSchema) {
      // The spec consumes a LessonBrief (no slug); run-pipeline pins the artifact's nodeSlug to
      // the gated node's slug, so the spec stage's own nodeSlug is a placeholder here.
      return {
        object: { nodeSlug: 'lesson', interactionKind: 'canvas', a11yContract: 'a', citations: [] },
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

  it('caps synthesis at maxNodes — capped-out built nodes surface as soon (cost control)', async () => {
    const deps = fakeDeps(['q1'], [0.9, 0.9, 0.9]); // 3 built-routed nodes
    const out = await runPipeline(req, new InlineEngine(), deps, { maxNodes: 1 });
    expect(out.result.pages).toHaveLength(1); // only 1 synthesized despite 3 buildable
    const pages = out.result.hub.tiers.flatMap((t) => t.categories.flatMap((c) => c.pages));
    expect(pages.filter((p) => p.built)).toHaveLength(1);
    expect(pages.filter((p) => p.status === 'soon')).toHaveLength(2); // the rest degrade, not fabricated
  });

  it('degrades a node to soon when its synthesis throws — does NOT crash the whole run', async () => {
    const deps = fakeDeps(['q1'], [0.9, 0.9]); // 2 built-routed nodes
    // The code stage hits the model output cap → the client guard throws (the real failure mode).
    (deps.complete as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('"anthropic:x" hit the output cap (16000); output is truncated. Raise maxTokens.'),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // The run must complete (not reject) even though every built node's code stage fails.
    const out = await runPipeline(req, new InlineEngine(), deps);
    const pages = out.result.hub.tiers.flatMap((t) => t.categories.flatMap((c) => c.pages));
    expect(pages.filter((p) => p.status === 'soon').length).toBeGreaterThanOrEqual(2); // both degraded
    expect(pages.every((p) => !p.built)).toBe(true); // a failed node is never 'built'
    expect(out.result.pages).toHaveLength(0); // no page persisted for a failed node (never fabricated)
    expect(warn).toHaveBeenCalled(); // the degrade is surfaced in the logs
    warn.mockRestore();
  });

  it('applies per-stage model overrides (the workflow_version arm / cheap-mode)', async () => {
    const deps = fakeDeps();
    const haiku: StageModel = { provider: 'anthropic', model: 'claude-haiku-4-5' };
    await runPipeline(req, new InlineEngine(), deps, { models: { planner: haiku } });
    const calls = (deps.completeObject as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.find(([o]) => o.schema === PlanSchema)?.[0].model).toEqual(haiku); // planner overridden
    expect(calls.find(([o]) => o.schema === PrereqGraphSchema)?.[0].model.model).toBe('claude-opus-4-8'); // graph still default
  });

  it('caps research fan-out at maxQuestions (the main cost lever)', async () => {
    const deps = fakeDeps(['q1', 'q2', 'q3']); // 3 research questions
    await runPipeline(req, new InlineEngine(), deps, { maxQuestions: 1 });
    // only the first question is researched → 1 web search, not 3
    expect((deps.searchWeb as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('swaps a single stage (fixture graph) AND the engine; the swap is memoized', async () => {
    // Replace ONLY the graph stage with a deterministic fixture; the other five stay default.
    const fixtureGraph: StageBundle['graph'] = vi.fn(async () => ({
      graph: { nodes: [{ slug: 'fx', title: 'FX', summary: 's', coverageConfidence: 0.95 }], edges: [] },
      records: [], // a fixture is free — contributes no cost row
    }));
    const stages: StageBundle = { ...defaultStages, graph: fixtureGraph };

    // Swap the engine too: a spy that still DELEGATES to a real InlineEngine (so memoization
    // is the real engine's, not the spy's).
    class SpyEngine implements Engine {
      calls = 0;
      private readonly inner = new InlineEngine();
      step<O>(name: string, key: string, fn: () => Promise<O>): Promise<O> {
        this.calls++;
        return this.inner.step(name, key, fn);
      }
    }
    const spy = new SpyEngine();
    const deps = fakeDeps();

    // options `{}` is the 4th positional arg; `stages` is the new 5th — they don't collide.
    const out = await runPipeline(req, spy, deps, {}, stages);

    const slugs = out.result.hub.tiers.flatMap((t) => t.categories.flatMap((c) => c.pages.map((p) => p.slug)));
    expect(slugs).toContain('fx'); // the injected stage's node flowed through gate → synth → hub
    expect(spy.calls).toBeGreaterThan(0); // the swapped engine actually drove the run
    // graph fixture emitted records:[] → cost threads with no graph row:
    // plan(1) + research(2 questions × [searchWeb + findings] = 4) + synth fx(spec+code+critic = 3) = 8
    expect(out.records).toHaveLength(8);

    // Re-run with the SAME engine + req: every step key repeats, so all steps are served from
    // the engine's memo and the injected stage is NOT re-invoked — proving memoization survives
    // a stage swap (the property the durable GcpEngine resume will rely on).
    await runPipeline(req, spy, deps, {}, stages);
    expect(fixtureGraph).toHaveBeenCalledTimes(1); // ran once across BOTH runs → memoized through the swap
  });

  it('emits one span per LLM call to the injected TraceSink, tagging synthesis spans with the node slug', async () => {
    const collector = new SpanCollector();
    // sink is the 6th positional arg, after the (defaulted) stages — the observability seam.
    const out = await runPipeline(req, new InlineEngine(), fakeDeps(), {}, defaultStages, collector);
    expect(collector.spans()).toHaveLength(out.records.length); // exactly one span per LLM call (9)
    const synth = collector.spans().filter((s) => s.nodeSlug !== undefined);
    expect(synth.map((s) => s.stage)).toEqual(['spec', 'code', 'critic']); // n1's synthesis, in order
    expect(synth.every((s) => s.nodeSlug === 'n1')).toBe(true);
    const analysis = collector.spans().filter((s) => s.nodeSlug === undefined).map((s) => s.stage);
    expect(analysis.filter((s) => s === 'researcher')).toHaveLength(4); // 2 questions × (searchWeb + findings)
    expect(analysis).toContain('planner');
    expect(analysis).toContain('graph');
  });
});
