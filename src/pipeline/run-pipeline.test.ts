import { describe, expect, it, vi } from 'vitest';
import { DEGRADE_DETAIL_MAX } from '../domain/degrade';
import {
  CriticVerdictSchema,
  FindingsSchema,
  LessonBriefSchema,
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
import { CATEGORY_SCHEMA } from './classify-category';
import type { StageDeps } from './deps';
import {
  defaultStages,
  noopCodeProgressSink,
  noopResearchSink,
  noopSink,
  type CodeProgressSink,
  type ResearchSink,
  type StageBundle,
} from './ports';
import { runLesson, runPipeline } from './run-pipeline';

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
  // `code` streams (PR-1) — stub streamComplete too (same canned page); a test can reject it to fail code.
  const streamComplete = vi.fn(async () => ({ text: '<!doctype html><html></html>', record: mkRec() }));
  return { complete, streamComplete, completeObject, searchWeb } as unknown as StageDeps;
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
    (deps.streamComplete as ReturnType<typeof vi.fn>).mockRejectedValue(
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

// ── single-lesson path (runLesson) ───────────────────────────────────────────
// The lesson path runs plan → research → brief → spec → code → critic; it has NO graph stage,
// so its fake DROPS the PrereqGraphSchema arm and asserts it is never reached. The brief arm
// returns a grounded LessonBrief whose finding cites the researcher's real source.
function lessonFakeDeps(questions: string[] = ['q1', 'q2'], criticPassed = true, critique = 'ok'): StageDeps {
  const completeObject = vi.fn(async (opts: { schema: unknown; prompt: string; model: StageModel }) => {
    if (opts.schema === PlanSchema) {
      return { object: { scope: 'S', subtopics: ['a', 'b'], researchQuestions: questions }, record: mkRec() };
    }
    if (opts.schema === FindingsSchema) {
      return { object: { findings: [{ claim: 'c', sourceIndex: 0 }] }, record: mkRec() };
    }
    if (opts.schema === PrereqGraphSchema) {
      throw new Error('the lesson path must NOT call the graph stage');
    }
    if (opts.schema === LessonBriefSchema) {
      return {
        object: {
          learningGoal: 'understand T',
          keyPoints: ['key point one'],
          // Cites the researcher's real source (https://s.example) so the brief's anti-fabrication
          // filter keeps it — proving the grounded finding reaches the spec via the brief.
          findings: [{ claim: 'grounded fact', source: { url: 'https://s.example', title: 'S' } }],
          audience: 'a',
        },
        record: mkRec(),
      };
    }
    if (opts.schema === PageSpecSchema) {
      return {
        object: {
          nodeSlug: 'lesson',
          interactionKind: 'canvas',
          a11yContract: 'a',
          citations: [{ url: 'https://s.example', title: 'S' }],
        },
        record: mkRec(),
      };
    }
    if (opts.schema === CriticVerdictSchema) {
      return { object: { passed: criticPassed, critique }, record: mkRec() };
    }
    if (opts.schema === CATEGORY_SCHEMA) {
      // The isolated, fail-safe card-category classifier at the run TAIL (NOT a core stage). Return a
      // valid subject so the happy path threads a category; a dedicated test overrides this to throw.
      return { object: { category: 'Physics' }, record: mkRec() };
    }
    throw new Error('unexpected schema');
  });
  const searchWeb = vi.fn(async () => ({
    text: 'synthesis',
    sources: [{ url: 'https://s.example', title: 'S' }],
    record: mkRec(),
  }));
  const complete = vi.fn(async () => ({ text: '<!doctype html><html></html>', record: mkRec() }));
  // `code` streams (PR-1) — stub streamComplete too (same canned page); a test can reject it to fail code.
  const streamComplete = vi.fn(async () => ({ text: '<!doctype html><html></html>', record: mkRec() }));
  return { complete, streamComplete, completeObject, searchWeb } as unknown as StageDeps;
}

describe('runLesson (single-lesson path)', () => {
  it('runs plan → research → brief → spec → code → critic into exactly ONE page (no graph/gate/hub)', async () => {
    const out = await runLesson(req, new InlineEngine(), lessonFakeDeps());

    // exactly one page, one tier, one category, one page in the hub
    expect(out.result.pages).toHaveLength(1);
    expect(out.result.hub.tiers).toHaveLength(1);
    expect(out.result.hub.tiers[0]?.categories).toHaveLength(1);
    const hubPages = out.result.hub.tiers.flatMap((t) => t.categories.flatMap((c) => c.pages));
    expect(hubPages).toHaveLength(1);

    // the page is keyed by the topic-derived slug (topic 'T' → 't')
    expect(out.result.pages[0]?.nodeSlug).toBe('t');
    expect(hubPages[0]?.slug).toBe('t');
    // critic passed → built
    expect(out.result.pages[0]?.passed).toBe(true);
    expect(hubPages[0]?.status).toBe('built');
    expect(hubPages[0]?.built).toBe(true);
  });

  it('NEVER invokes the graph stage (the PrereqGraphSchema arm is unreachable)', async () => {
    const deps = lessonFakeDeps();
    await runLesson(req, new InlineEngine(), deps);
    const calls = (deps.completeObject as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some(([o]) => o.schema === PrereqGraphSchema)).toBe(false); // graph never called
    expect(calls.some(([o]) => o.schema === LessonBriefSchema)).toBe(true); // brief IS called
  });

  it('feeds the brief stage to spec (grounded findings reach spec via brief, not synthesized)', async () => {
    const deps = lessonFakeDeps();
    await runLesson(req, new InlineEngine(), deps);
    const calls = (deps.completeObject as ReturnType<typeof vi.fn>).mock.calls;
    const briefIdx = calls.findIndex(([o]) => o.schema === LessonBriefSchema);
    const specIdx = calls.findIndex(([o]) => o.schema === PageSpecSchema);
    expect(briefIdx).toBeGreaterThanOrEqual(0);
    expect(specIdx).toBeGreaterThan(briefIdx); // brief runs BEFORE spec
    // the spec prompt carries the brief's grounded finding (claim + source) — the fact-starvation fix
    const specPrompt = calls[specIdx]?.[0].prompt;
    expect(specPrompt).toContain('grounded fact');
    expect(specPrompt).toContain('https://s.example');
  });

  it('degrades the lesson to soon (not built) when the critic fails — never a broken page', async () => {
    const out = await runLesson(req, new InlineEngine(), lessonFakeDeps(['q1'], false));
    const hubPages = out.result.hub.tiers.flatMap((t) => t.categories.flatMap((c) => c.pages));
    // a critic-failed lesson still has a page row (it was synthesized) but is NOT built
    expect(out.result.pages).toHaveLength(1);
    expect(out.result.pages[0]?.passed).toBe(false);
    expect(hubPages[0]?.status).toBe('soon');
    expect(hubPages[0]?.built).toBe(false);
  });

  it('does NOT crash when synthesis throws — degrades to a zero-page soon lesson', async () => {
    const deps = lessonFakeDeps(['q1']);
    (deps.streamComplete as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('output cap hit'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await runLesson(req, new InlineEngine(), deps);
    const hubPages = out.result.hub.tiers.flatMap((t) => t.categories.flatMap((c) => c.pages));
    expect(out.result.pages).toHaveLength(0); // no fabricated page for a failed lesson
    expect(hubPages).toHaveLength(1); // the hub still has its single 'soon' page
    expect(hubPages[0]?.status).toBe('soon');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  // ── the degrade REASON (issue #214) — computed at the ONE runLesson degrade site ─────────────────
  // The reason is operator-only telemetry threaded onto the result as `degrade`; runCompleteEvent emits
  // it. These prove the taxonomy: a built run has none; a graceful critic reject vs a synthesis throw
  // are distinguished (criticPassed:false alone cannot); the detail is BOUNDED at the named constant.
  it('a BUILT run carries NO degrade reason', async () => {
    const out = await runLesson(req, new InlineEngine(), lessonFakeDeps());
    expect(out.result.pages[0]?.passed).toBe(true);
    expect(out.degrade).toBeUndefined();
  });

  it('a critic-rejected lesson (graceful fail) sets degrade {gate:critic, code:critic_rejected, detail:critique}', async () => {
    const out = await runLesson(req, new InlineEngine(), lessonFakeDeps(['q1'], false, 'rubric: weak interaction, no a11y path'));
    expect(out.degrade).toEqual({
      gate: 'critic',
      code: 'critic_rejected',
      detail: 'rubric: weak interaction, no a11y path',
    });
    // the GRACEFUL shape: a non-null (soon) page exists — that is what distinguishes it from a throw
    expect(out.result.pages).toHaveLength(1);
    expect(out.result.pages[0]?.passed).toBe(false);
  });

  it('truncates the critique detail to DEGRADE_DETAIL_MAX (never an unbounded model string on the log stream)', async () => {
    const longCritique = 'z'.repeat(DEGRADE_DETAIL_MAX + 400);
    const out = await runLesson(req, new InlineEngine(), lessonFakeDeps(['q1'], false, longCritique));
    expect(out.degrade?.code).toBe('critic_rejected');
    expect(out.degrade?.detail).toHaveLength(DEGRADE_DETAIL_MAX);
    expect(out.degrade?.detail).toBe('z'.repeat(DEGRADE_DETAIL_MAX));
  });

  it('a synthesis THROW sets degrade {gate:synthesis, code:synthesis_error} — distinguishable from a critic reject', async () => {
    const deps = lessonFakeDeps(['q1']);
    (deps.streamComplete as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('output cap hit'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await runLesson(req, new InlineEngine(), deps);
    warn.mockRestore();
    expect(out.degrade?.gate).toBe('synthesis');
    expect(out.degrade?.code).toBe('synthesis_error');
    expect(out.degrade?.detail).toContain('output cap hit'); // the caught reason, bounded
    expect(out.result.pages).toHaveLength(0); // the EXCEPTION shape: a null artifact, no fabricated page
  });

  it('memoizes the synthesis trio across two runs on one engine (keyed by the topic-derived slug)', async () => {
    const deps = lessonFakeDeps(['q1']);
    const engine = new InlineEngine();
    await runLesson(req, engine, deps);
    await runLesson(req, engine, deps); // same engine + req → every step key repeats
    const calls = (deps.completeObject as ReturnType<typeof vi.fn>).mock.calls;
    // spec + brief + critic each ran exactly ONCE across both runs (memoized); code (complete) too.
    expect(calls.filter(([o]) => o.schema === PageSpecSchema)).toHaveLength(1);
    expect(calls.filter(([o]) => o.schema === LessonBriefSchema)).toHaveLength(1);
    expect(calls.filter(([o]) => o.schema === CriticVerdictSchema)).toHaveLength(1);
    expect((deps.streamComplete as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  // ── the dense card's presentation metadata (category eyebrow + summary description) ──────────────
  // Both are produced at the run TAIL, isolated from the core stages: the category by the fail-safe
  // classifier, the summary as pure data plumbing off the brief's learningGoal.
  it('exposes the dense card metadata: category (classifier) + summary (= the brief learningGoal)', async () => {
    const out = await runLesson(req, new InlineEngine(), lessonFakeDeps());
    expect(out.category).toBe('PHYSICS'); // the classifier's validated, uppercased subject label
    expect(out.summary).toBe('understand T'); // pure data plumbing — the brief's learningGoal verbatim
  });

  it('classifier runs as the TAIL call (after the critic), so it can never affect what is taught', async () => {
    const deps = lessonFakeDeps();
    await runLesson(req, new InlineEngine(), deps);
    const calls = (deps.completeObject as ReturnType<typeof vi.fn>).mock.calls;
    const criticIdx = calls.findIndex(([o]) => o.schema === CriticVerdictSchema);
    const categoryIdx = calls.findIndex(([o]) => o.schema === CATEGORY_SCHEMA);
    expect(categoryIdx).toBeGreaterThan(criticIdx); // the category call is the run tail, after synthesis
  });

  it('PIPELINE-SAFETY: a THROWING classifier still produces the FULL built lesson with category null', async () => {
    // The owner reverted a prior change for making generation slower/flakier — prove a classifier fault
    // can NEVER do that: the lesson synthesizes fully (built), the run does not throw, category is null
    // (the card omits the eyebrow), and the summary still plumbs through from the brief.
    const deps = lessonFakeDeps();
    // Override ONLY the category-schema arm to throw — every core stage still returns valid output.
    (deps.completeObject as ReturnType<typeof vi.fn>).mockImplementation(
      async (opts: { schema: unknown }) => {
        if (opts.schema === CATEGORY_SCHEMA) throw new Error('classifier timeout');
        if (opts.schema === PlanSchema) {
          return { object: { scope: 'S', subtopics: ['a'], researchQuestions: ['q1'] }, record: mkRec() };
        }
        if (opts.schema === FindingsSchema) {
          return { object: { findings: [{ claim: 'c', sourceIndex: 0 }] }, record: mkRec() };
        }
        if (opts.schema === LessonBriefSchema) {
          return {
            object: {
              learningGoal: 'understand T',
              keyPoints: ['key point one'],
              findings: [{ claim: 'grounded fact', source: { url: 'https://s.example', title: 'S' } }],
              audience: 'a',
            },
            record: mkRec(),
          };
        }
        if (opts.schema === PageSpecSchema) {
          return {
            object: { nodeSlug: 'lesson', interactionKind: 'canvas', a11yContract: 'a', citations: [{ url: 'https://s.example', title: 'S' }] },
            record: mkRec(),
          };
        }
        if (opts.schema === CriticVerdictSchema) {
          return { object: { passed: true, critique: 'ok' }, record: mkRec() };
        }
        throw new Error('unexpected schema');
      },
    );
    const out = await runLesson(req, new InlineEngine(), deps);
    // generation UNAFFECTED — a full built lesson
    expect(out.result.pages).toHaveLength(1);
    expect(out.result.pages[0]?.passed).toBe(true);
    const hubPages = out.result.hub.tiers.flatMap((t) => t.categories.flatMap((c) => c.pages));
    expect(hubPages[0]?.status).toBe('built');
    // the classifier fault is contained: category null, summary still plumbed from the brief
    expect(out.category).toBeNull();
    expect(out.summary).toBe('understand T');
  });

  // ── the live-research sink (live-research generating Stage 1) — the FAIL-SAFE data path ──────────
  // The sink is best-effort observability fired FIRE-AND-FORGET off the researcher fan-out; it must
  // never touch what the run produces. These are the GATING safety tests (the owner reverted a prior
  // change for making generation slower/flakier — prove a sink fault can NEVER do that).
  it('PIPELINE-SAFETY: a THROWING research sink still completes the run with the SAME result + brief + cost', async () => {
    // A sink whose every method throws SYNCHRONOUSLY (the harshest case — not even a rejected promise).
    const throwing: ResearchSink = {
      onQuestions: vi.fn(() => {
        throw new Error('onQuestions exploded');
      }) as unknown as ResearchSink['onQuestions'],
      onResearch: vi.fn(() => {
        throw new Error('onResearch exploded');
      }) as unknown as ResearchSink['onResearch'],
    };

    // Baseline: the SAME inputs with the default no-op sink.
    const baseline = await runLesson(req, new InlineEngine(), lessonFakeDeps(['q1', 'q2']), {}, defaultStages, noopSink, noopResearchSink);
    // The throwing sink — the run must resolve identically (the throws are swallowed, never propagated).
    const out = await runLesson(req, new InlineEngine(), lessonFakeDeps(['q1', 'q2']), {}, defaultStages, noopSink, throwing);

    // (1) SAME PipelineResult / brief / cost as the no-op sink — emission is additive, never mutates.
    expect(out.result).toEqual(baseline.result);
    expect(out.brief).toEqual(baseline.brief);
    expect(out.costUsd).toBe(baseline.costUsd);
    // (2) the researcher's findings reach the brief byte-identically (the sink can't alter Research).
    expect(out.brief?.findings).toEqual([{ claim: 'grounded fact', source: { url: 'https://s.example', title: 'S' } }]);
    // a full BUILT lesson — generation unaffected by the faulty sink
    expect(out.result.pages).toHaveLength(1);
    expect(out.result.pages[0]?.passed).toBe(true);
    // (3) the sink WAS called (the throw was reached and swallowed) — once per announce + once per question
    expect(throwing.onQuestions).toHaveBeenCalledTimes(1);
    expect(throwing.onQuestions).toHaveBeenCalledWith(['q1', 'q2']); // the REAL deduped questions, no fabrication
    expect(throwing.onResearch).toHaveBeenCalledTimes(2); // one per researched question
  });

  // ── the code-progress sink (PR-4 / #180) — the FAIL-SAFE live code-phase data path ───────────────
  // The streaming `code` stage fires onProgress per delta; runLesson threads it through the MEMOIZED code
  // step into the injected CodeProgressSink. Like the research sink it is best-effort observability that
  // must never touch what the run produces. A streamComplete stub that EMITS a sample exercises the path.
  function lessonDepsEmittingProgress(sample: {
    outputTokens: number;
    elapsedMs: number;
    maxTokens: number;
    phase: 'prefill' | 'generating';
  }): StageDeps {
    const deps = lessonFakeDeps(['q1']);
    (deps.streamComplete as ReturnType<typeof vi.fn>).mockImplementation(
      async (_opts: unknown, onProgress?: (p: unknown) => void) => {
        onProgress?.(sample); // the streaming client fires the hook per delta
        return { text: '<!doctype html><html></html>', record: mkRec() };
      },
    );
    return deps;
  }

  it('drives the CodeProgressSink: code\'s onProgress reaches the sink with {outputTokens, elapsedMs, maxTokens, phase}', async () => {
    const sample = { outputTokens: 8000, elapsedMs: 2000, maxTokens: 32000, phase: 'generating' as const };
    const seen: unknown[] = [];
    const sink: CodeProgressSink = { onProgress: (p) => seen.push(p) };
    await runLesson(req, new InlineEngine(), lessonDepsEmittingProgress(sample), {}, defaultStages, noopSink, noopResearchSink, sink);
    // the RAW sample reaches the sink (the sink — not the pipeline — denormalizes it to a bounded fraction)
    expect(seen).toEqual([sample]);
  });

  it('PIPELINE-SAFETY: a THROWING CodeProgressSink (sync throw) still completes the run with the SAME result', async () => {
    // The owner reverted a prior change for making generation slower/flakier — prove a code-progress sink
    // fault can NEVER do that: the lesson builds fully, the run does not throw, the throw is swallowed.
    const sample = { outputTokens: 8000, elapsedMs: 2000, maxTokens: 32000, phase: 'generating' as const };
    const throwing: CodeProgressSink = {
      onProgress: vi.fn(() => {
        throw new Error('code-progress sink exploded');
      }),
    };
    const baseline = await runLesson(
      req,
      new InlineEngine(),
      lessonDepsEmittingProgress(sample),
      {},
      defaultStages,
      noopSink,
      noopResearchSink,
      noopCodeProgressSink,
    );
    const out = await runLesson(
      req,
      new InlineEngine(),
      lessonDepsEmittingProgress(sample),
      {},
      defaultStages,
      noopSink,
      noopResearchSink,
      throwing,
    );
    // SAME PipelineResult as the no-op sink — the faulty sink is additive, never mutates the run.
    expect(out.result).toEqual(baseline.result);
    expect(out.result.pages).toHaveLength(1);
    expect(out.result.pages[0]?.passed).toBe(true); // a full BUILT lesson — generation unaffected
    expect(throwing.onProgress).toHaveBeenCalled(); // the throw WAS reached (and swallowed by the run hook)
  });

  it('emits the REAL questions then each question\'s grounded Research to the sink (no fabrication)', async () => {
    const seen: { questions?: string[]; research: { question: string; research: unknown }[] } = { research: [] };
    const recording: ResearchSink = {
      async onQuestions(questions) {
        seen.questions = questions;
      },
      async onResearch(question, research) {
        seen.research.push({ question, research });
      },
    };
    await runLesson(req, new InlineEngine(), lessonFakeDeps(['q1', 'q2']), {}, defaultStages, noopSink, recording);
    // the announced questions are the planner's REAL output, deduped/capped — never placeholders
    expect(seen.questions).toEqual(['q1', 'q2']);
    // each question's grounded Research lands (subtopic + sources + findings) — the actual researcher output
    expect(seen.research.map((r) => r.question).sort()).toEqual(['q1', 'q2']);
    for (const r of seen.research) {
      expect(r.research).toMatchObject({
        sources: [{ url: 'https://s.example', title: 'S' }],
        findings: [{ claim: 'c', sourceIndex: 0 }],
      });
    }
  });
});

// ── issue #189: the researcher fan-out is concurrency-BOUNDED (inline semaphore, no new dep) ─────────
// The shared ANALYSIS prelude fans the web searches out under a cap so a wide question count can't
// stampede the provider on a 529 overload. These prove the bound holds AND that the per-question
// engine.step memoization + the fire-and-forget ResearchSink emissions survive the bounded fan-out.
describe('bounded researcher fan-out (#189)', () => {
  it('(a) caps concurrent researcher web-search calls at researchConcurrency (max in-flight ≤ cap)', async () => {
    const N = 10; // N > cap, so the bound actually engages
    const cap = 3;
    const questions = Array.from({ length: N }, (_, i) => `q${i + 1}`); // 10 DISTINCT questions (no dedup)
    let inFlight = 0;
    let maxInFlight = 0;
    let started = 0;
    const gates: Array<() => void> = [];
    const deps = lessonFakeDeps(questions);
    // The fake searchWeb PARKS on a gate so concurrency is observable, then is released in waves — fully
    // deterministic (no real timer drives an assertion); maxInFlight can structurally never exceed `cap`.
    (deps.searchWeb as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      inFlight += 1;
      started += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((resolve) => gates.push(resolve));
      inFlight -= 1;
      return { text: 'synthesis', sources: [{ url: 'https://s.example', title: 'S' }], record: mkRec() };
    });

    const runP = runLesson(req, new InlineEngine(), deps, { researchConcurrency: cap });

    // Drive the fan-out: flush the macrotask queue (admitting parked workers), then release ONE parked
    // worker so its freed semaphore slot can admit the next queued question. Loop until every question
    // has started AND no worker is left parked.
    while (started < N || gates.length > 0) {
      await new Promise((r) => setTimeout(r, 0)); // let freed slots admit + park the next worker(s)
      gates.shift()?.();
    }
    await runP;

    expect(started).toBe(N); // every question was researched
    expect(maxInFlight).toBeLessThanOrEqual(cap); // never exceeded the cap — the core guarantee
    expect(maxInFlight).toBe(cap); // and actually reached it: proves real bounded concurrency (N > cap)
  });

  it('(b) preserves per-question engine.step memoization + ResearchSink emissions under the bound', async () => {
    const seen: { questions?: string[]; researched: string[] } = { researched: [] };
    const recording: ResearchSink = {
      async onQuestions(qs) {
        seen.questions = [...qs];
      },
      async onResearch(question) {
        seen.researched.push(question);
      },
    };
    const deps = lessonFakeDeps(['q1', 'q2', 'q3']); // 3 distinct questions, cap 2 → the bound engages
    const engine = new InlineEngine();
    const searches = deps.searchWeb as ReturnType<typeof vi.fn>;

    await runLesson(req, engine, deps, { researchConcurrency: 2 }, defaultStages, noopSink, recording);

    // onQuestions fired ONCE with the real planner questions; onResearch fired once per question.
    expect(seen.questions).toEqual(['q1', 'q2', 'q3']);
    expect(seen.researched.slice().sort()).toEqual(['q1', 'q2', 'q3']);
    expect(searches.mock.calls).toHaveLength(3); // one web search per question under the bound

    // Re-run on the SAME engine + req: every per-question step key (contentHash(question, bucket))
    // repeats → all memoized, so the paid search `fn` never re-runs despite the bounded fan-out.
    await runLesson(req, engine, deps, { researchConcurrency: 2 }, defaultStages, noopSink, recording);
    expect(searches.mock.calls).toHaveLength(3); // still 3 total — memoized through the bound
  });

  it('(c) is INERT at the default cap for a small fan-out (every existing caller unchanged)', async () => {
    // The default (DEFAULT_RESEARCH_CONCURRENCY = 4) ≥ today's live fan-out width, so a 2-question run
    // never queues — it behaves exactly as the old unbounded Promise.all. Proven by an unchanged run.
    const out = await runLesson(req, new InlineEngine(), lessonFakeDeps(['q1', 'q2']));
    expect(out.result.pages).toHaveLength(1);
    expect(out.result.pages[0]?.passed).toBe(true);
  });
});
