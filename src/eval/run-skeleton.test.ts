import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  CriticVerdictSchema,
  FindingsSchema,
  GradedCriticVerdictSchema,
  isLessonSpec,
  LessonBriefSchema,
  LessonSpecSchema,
  type LessonSpec,
  PageSpecSchema,
  PlanSchema,
  PrereqGraphSchema,
  type CritiquedArtifact,
  type TopicRequest,
} from '../domain/stages';
import { STAGE_MODELS, type StageModel } from '../llm/models';
import type { StageDeps } from '../pipeline/deps';
import type { PipelineRunResult } from '../pipeline/run-pipeline';
import type { judgeBrief } from '../trace/judge';
import { ANALYSIS_ROW_KEY } from '../trace/reduce';
import { SpanCollector } from '../trace/span';
import { gradedCritique } from '../pipeline/critic';
import { defaultStages } from '../pipeline/ports';
import { specV11 } from '../pipeline/spec';
import {
  armLabel,
  buildOptions,
  buildRequest,
  dumpPages,
  formatSummary,
  persistInput,
  reduceRunTrace,
  runSkeleton,
  selectArm,
} from './run-skeleton';

const mkRec = () => ({
  providerModel: 'anthropic:claude-opus-4-8',
  inputTokens: 10,
  outputTokens: 10,
  costUsd: 0.01,
  rawUsage: {},
  finishReason: 'stop',
});

// Fake deps dispatched by Zod schema — serves the SINGLE-LESSON path (runSkeleton → runLesson) with no
// live model. The lesson path runs plan → research → brief → spec → code → critic (NO graph), so the
// graph arm is unreachable (throws if hit) and a LessonBrief arm replaces it. searchWeb returns a real
// source so the brief's anti-fabrication filter keeps its finding.
function fakeDeps(): StageDeps {
  const completeObject = vi.fn(async (opts: { schema: unknown; prompt: string }) => {
    if (opts.schema === PlanSchema) {
      return { object: { scope: 'S', subtopics: ['a'], researchQuestions: ['q1'] }, record: mkRec() };
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
          findings: [{ claim: 'grounded fact', source: { url: 'https://s.example', title: 'S' } }],
          audience: 'a',
        },
        record: mkRec(),
      };
    }
    if (opts.schema === PageSpecSchema) {
      return {
        object: {
          nodeSlug: 't',
          interactionKind: 'canvas',
          a11yContract: 'a',
          citations: [{ url: 'https://s.example', title: 'S' }],
        },
        record: mkRec(),
      };
    }
    if (opts.schema === CriticVerdictSchema) return { object: { passed: true, critique: 'ok' }, record: mkRec() };
    throw new Error('unexpected schema');
  });
  const searchWeb = vi.fn(async () => ({
    text: 't',
    sources: [{ url: 'https://s.example', title: 'S' }],
    record: mkRec(),
  }));
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
  it('runs the single-lesson path into ONE built page and summarizes it + cost', async () => {
    const run = await runSkeleton({ topic: 'T', settings: { level: 'intro', depth: 2, audience: 'a' } }, fakeDeps());
    // runSkeleton now drives runLesson: exactly one page, keyed by the topic-derived slug ('T' → 't').
    expect(run.result.pages).toHaveLength(1);
    expect(run.result.pages[0]?.nodeSlug).toBe('t');
    expect(run.brief).toBeDefined(); // the lesson path exposes the brief (so --trace fires the judge)
    const summary = formatSummary(run);
    expect(summary).toContain('Lesson — 1 page(s):');
    expect(summary).toMatch(/\[built\].*\(t\)/); // the single lesson, built (critic passed)
    expect(summary).toContain('1/1 passed the critic');
    expect(summary).toContain('Total: $');
    expect(run.costUsd).toBeGreaterThan(0);
  });
});

describe('buildOptions', () => {
  it('is empty by default (default models, all nodes)', () => {
    const opts = buildOptions(['--topic', 'x']);
    expect(opts.models).toBeUndefined();
    expect(opts.maxNodes).toBeUndefined();
  });

  it('--cheap runs ANALYSIS on Haiku and SYNTHESIS on Sonnet (a truncated single lesson degrades to soon)', () => {
    const opts = buildOptions(['--cheap']);
    expect(opts.models?.planner?.model).toBe('claude-haiku-4-5'); // analysis → Haiku
    expect(opts.models?.researcher?.model).toBe('claude-haiku-4-5');
    expect(opts.models?.brief?.model).toBe('claude-haiku-4-5');
    expect(opts.models?.spec?.model).toBe('claude-sonnet-4-6'); // synthesis → Sonnet
    expect(opts.models?.code?.model).toBe('claude-sonnet-4-6');
    expect(opts.models?.critic?.model).toBe('claude-sonnet-4-6');
  });

  it('--max-nodes caps the synthesized node count', () => {
    expect(buildOptions(['--max-nodes', '2']).maxNodes).toBe(2);
  });

  it('rejects a non-numeric --max-nodes (no silent zero-node run)', () => {
    expect(() => buildOptions(['--max-nodes', 'lots'])).toThrow(/max-nodes/);
  });

  it('--max-questions caps the research fan-out', () => {
    expect(buildOptions(['--max-questions', '3']).maxQuestions).toBe(3);
  });
});

describe('selectArm (the offline A/B bench arm — TS-9, TS-14)', () => {
  it('defaults to the blob arm (blob spec + binary critic, the deployed default)', () => {
    const arm = selectArm(['--topic', 'x']);
    // selectArm returns a fresh copy (it composes swaps), so assert FIELD equality, not reference.
    expect(arm).toEqual(defaultStages);
    expect(arm.spec).toBe(defaultStages.spec); // the blob spec — the live default / kill-switch
    expect(arm.critic).toBe(defaultStages.critic); // the binary critic
  });

  it('--graded selects the v11 graded-critic arm via a StageBundle.critic swap (no RunOptions flag)', () => {
    const arm = selectArm(['--topic', 'x', '--graded']);
    expect(arm.critic).toBe(gradedCritique); // the only field that differs from the blob arm
    expect(arm.spec).toBe(defaultStages.spec); // --graded alone leaves the blob spec untouched
    const { critic, ...rest } = arm;
    const { critic: _blob, ...blobRest } = defaultStages;
    expect(rest).toEqual(blobRest); // every other stage is identical — pure stage substitution
  });

  it('--v11 swaps the SYNTHESIS spec to specV11 (the sectioned LessonSpec emission), critic unchanged', () => {
    const arm = selectArm(['--topic', 'x', '--v11']);
    expect(arm.spec).toBe(specV11); // the v11 sectioned emission — the real arm flag (TS-14)
    expect(arm.critic).toBe(defaultStages.critic); // --v11 alone keeps the binary blob critic
    const { spec, ...rest } = arm;
    const { spec: _blobSpec, ...blobRest } = defaultStages;
    expect(rest).toEqual(blobRest); // only the spec field differs — pure stage substitution
  });

  it('--v11 --graded composes both swaps into the full v11 arm (sectioned emission + graded read)', () => {
    const arm = selectArm(['--topic', 'x', '--v11', '--graded']);
    expect(arm.spec).toBe(specV11); // SYNTHESIS swap
    expect(arm.critic).toBe(gradedCritique); // CRITIC swap
    const { spec, critic, ...rest } = arm;
    const { spec: _s, critic: _c, ...blobRest } = defaultStages;
    expect(rest).toEqual(blobRest); // exactly two fields differ; no RunOptions arm flag involved
  });

  it('RunOptions carries NO arm flag — the arm lives entirely in StageBundle (TS-14 AC1)', () => {
    // buildOptions parses the cost-control flags only; an arm flag must NOT leak into RunOptions.
    const opts = buildOptions(['--topic', 'x', '--v11', '--graded']);
    expect(opts).toEqual({}); // {thresholds, maxNodes, models, maxQuestions} only — none set, none added
    expect('arm' in opts).toBe(false);
  });

  it('armLabel names BOTH axes so the paired _analysis rows are distinguishable (TS-14 AC6)', () => {
    expect(armLabel(['--topic', 'x'])).toBe('blob-binary'); // the deployed default
    expect(armLabel(['--topic', 'x', '--graded'])).toBe('blob-graded');
    expect(armLabel(['--topic', 'x', '--v11'])).toBe('v11-binary');
    expect(armLabel(['--topic', 'x', '--v11', '--graded'])).toBe('v11-graded'); // the full v11 arm
  });

  it('runSkeleton threads the selected v11 arm end-to-end (graded sub-scores reach the page)', async () => {
    // The graded arm answers GradedCriticVerdictSchema; runSkeleton with selectArm(['--graded']) must
    // carry the sub-scores onto the built page (proving the arm actually ran, not just was selected).
    const completeObject = vi.fn(async (opts: { schema: unknown }) => {
      if (opts.schema === PlanSchema) {
        return { object: { scope: 'S', subtopics: ['a'], researchQuestions: ['q1'] }, record: mkRec() };
      }
      if (opts.schema === FindingsSchema) {
        return { object: { findings: [{ claim: 'c', sourceIndex: 0 }] }, record: mkRec() };
      }
      if (opts.schema === LessonBriefSchema) {
        return {
          object: {
            learningGoal: 'g',
            keyPoints: ['k'],
            findings: [{ claim: 'c', source: { url: 'https://s.example', title: 'S' } }],
            audience: 'a',
          },
          record: mkRec(),
        };
      }
      if (opts.schema === PageSpecSchema) {
        return {
          object: { nodeSlug: 'lesson', interactionKind: 'canvas', a11yContract: 'a', citations: [] },
          record: mkRec(),
        };
      }
      if (opts.schema === GradedCriticVerdictSchema) {
        const sub = (s: number) => ({ score: s, note: 'n' });
        return {
          object: {
            passed: false, // self-asserted false; derivePassed recomputes true from the high floor
            critique: 'graded',
            learningEfficacy: {
              misconceptionHook: sub(0.9),
              retrievalCheck: sub(0.9),
              findingsGrounded: sub(0.9),
              apparatusAddsBeyondProse: sub(0.9),
            },
            ledgerConformance: {
              namedGridPresent: sub(0.9),
              perSectionSubgrid: sub(0.9),
              collapseQueryPresent: sub(0.9),
              noRootLiteralOverride: sub(0.9),
              predictGateStructure: sub(0.9),
            },
          },
          record: mkRec(),
        };
      }
      throw new Error('unexpected schema');
    });
    const searchWeb = vi.fn(async () => ({ text: 's', sources: [{ url: 'https://s.example', title: 'S' }], record: mkRec() }));
    const complete = vi.fn(async () => ({ text: '<!doctype html>', record: mkRec() }));
    const deps = { complete, completeObject, searchWeb } as unknown as StageDeps;

    const run = await runSkeleton(
      { topic: 'T', settings: { level: 'intro', depth: 2, audience: 'a' } },
      deps,
      {},
      undefined,
      selectArm(['--graded']),
    );
    expect(run.result.pages[0]?.passed).toBe(true); // derived from the sub-score floor
    expect(run.result.pages[0]?.scores?.learningEfficacy.retrievalCheck.score).toBe(0.9); // arm ran
  });

  it('runSkeleton threads the --v11 SYNTHESIS arm end-to-end (the sectioned LessonSpec reaches code)', async () => {
    // selectArm(['--v11']) swaps spec → specV11, which answers LessonSpecSchema (NOT PageSpecSchema):
    // a fake that emits a valid sectioned spec proves the v11 spec stage actually ran (the spec swap is
    // threaded, not just selected) and that `code` rendered the sectioned spec onto the built page.
    const completeObject = vi.fn(async (opts: { schema: unknown }) => {
      if (opts.schema === PlanSchema) {
        return { object: { scope: 'S', subtopics: ['a'], researchQuestions: ['q1'] }, record: mkRec() };
      }
      if (opts.schema === FindingsSchema) {
        return { object: { findings: [{ claim: 'c', sourceIndex: 0 }] }, record: mkRec() };
      }
      if (opts.schema === LessonBriefSchema) {
        return {
          object: {
            learningGoal: 'g',
            keyPoints: ['k'],
            findings: [{ claim: 'c', source: { url: 'https://s.example', title: 'S' } }],
            audience: 'a',
          },
          record: mkRec(),
        };
      }
      if (opts.schema === LessonSpecSchema) {
        // A valid sectioned spec: ≥ MIN_LESSON_SECTIONS sections carrying BOTH primitives (a
        // predict-gate + a self-check, each with an answerable) so it parses the .superRefine.
        const answerable = { prompt: 'q?', answer: 'a.' };
        return {
          object: {
            nodeSlug: 't',
            a11yContract: 'a',
            citations: [{ url: 'https://s.example', title: 'S' }],
            sections: [
              { kind: 'hook', prose: 'hook prose' },
              {
                kind: 'concept',
                prose: 'concept prose',
                component: { kind: 'predict-gate', teachingPurpose: 'predict', answerable },
              },
              {
                kind: 'self-check',
                prose: 'check prose',
                component: { kind: 'self-check', teachingPurpose: 'recall', answerable },
              },
              { kind: 'takeaways', prose: 'takeaways prose' },
            ],
          },
          record: mkRec(),
        };
      }
      if (opts.schema === CriticVerdictSchema) return { object: { passed: true, critique: 'ok' }, record: mkRec() };
      throw new Error('unexpected schema');
    });
    const searchWeb = vi.fn(async () => ({ text: 's', sources: [{ url: 'https://s.example', title: 'S' }], record: mkRec() }));
    const complete = vi.fn(async () => ({ text: '<!doctype html>', record: mkRec() }));
    const deps = { complete, completeObject, searchWeb } as unknown as StageDeps;

    const run = await runSkeleton(
      { topic: 'T', settings: { level: 'intro', depth: 2, audience: 'a' } },
      deps,
      {},
      undefined,
      selectArm(['--v11']), // the SYNTHESIS arm — blob critic, v11 sectioned spec
    );
    const page = run.result.pages[0];
    expect(page?.passed).toBe(true); // the binary blob critic still gates this arm (--v11 alone)
    // The built page carries the v11 SECTIONED spec, proving specV11 (not the blob spec) ran end-to-end.
    expect(isLessonSpec(page?.spec as LessonSpec)).toBe(true);
    expect((page?.spec as LessonSpec).sections).toHaveLength(4);
  });
});

describe('dumpPages', () => {
  it('writes each page html to <dir>/<slug>.html', () => {
    const dir = mkdtempSync(join(tmpdir(), 'skeleton-dump-'));
    const artifact: CritiquedArtifact = {
      nodeSlug: 'sine',
      html: '<!doctype html><h1>Sine</h1>',
      learningGoal: 'g',
      spec: { nodeSlug: 'sine', interactionKind: 'canvas', a11yContract: 'a', citations: [] },
      passed: true,
      critique: 'ok',
    };
    const paths = dumpPages([artifact], dir);
    expect(paths).toHaveLength(1);
    expect(paths[0]?.endsWith('sine.html')).toBe(true);
    expect(readFileSync(paths[0] ?? '', 'utf8')).toBe('<!doctype html><h1>Sine</h1>');
  });

  it('contains a path-traversal slug to the dump dir (basename only)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'skeleton-dump-'));
    const artifact: CritiquedArtifact = {
      nodeSlug: '../escape',
      html: '<p>x</p>',
      learningGoal: 'g',
      spec: { nodeSlug: '../escape', interactionKind: 'html', a11yContract: 'a', citations: [] },
      passed: true,
      critique: 'ok',
    };
    const [path] = dumpPages([artifact], dir);
    expect(path).toBe(join(dir, 'escape.html')); // written inside dir, not escaped
  });
});

describe('reduceRunTrace (CLI trace wiring — issue #51)', () => {
  const base = { runId: 'run1', label: 'Fourier', startedAt: '2026-06-21T00:00:00Z' };
  const page = (slug: string, passed: boolean): CritiquedArtifact => ({
    nodeSlug: slug,
    html: '<p>x</p>',
    learningGoal: 'g',
    spec: { nodeSlug: slug, interactionKind: 'html', a11yContract: 'a', citations: [] },
    passed,
    critique: 'c',
  });
  const runWithBrief = (): PipelineRunResult => ({
    result: { hub: { tiers: [] }, pages: [page('sine', true)] },
    records: [],
    costUsd: 0.05,
    brief: {
      learningGoal: 'understand the Fourier transform',
      keyPoints: ['frequency domain'],
      findings: [{ claim: 'orthogonality', source: { url: 'https://x', title: 'X' } }],
      audience: 'devs',
    },
  });
  // An injected fake judge — no live model; emits a fixed verdict + a 0.07 cost record.
  const fakeJudge = async () => ({
    scores: { groundedness: 0.9, goalClarity: 0.8, audienceFit: 0.7 },
    record: { ...mkRec(), costUsd: 0.07 },
  });

  it('threads the critic verdict onto the synthesis row and the judge scores onto _analysis', async () => {
    const collector = new SpanCollector();
    collector.onSpan({ stage: 'planner', record: { ...mkRec(), costUsd: 0.02 } });
    collector.onSpan({ stage: 'spec', nodeSlug: 'sine', record: { ...mkRec(), costUsd: 0.03 } });
    const { rows } = await reduceRunTrace(collector, runWithBrief(), base, { judge: fakeJudge });
    const sine = rows.find((r) => r.rowKey === 'sine');
    expect(sine?.scores?.passed).toBe(1); // critic verdict from run.result.pages
    const analysis = rows.find((r) => r.rowKey === ANALYSIS_ROW_KEY);
    expect(analysis?.scores?.groundedness).toBe(0.9); // judge scores on the analysis row
    expect(analysis?.output).toEqual(runWithBrief().brief); // brief is the analysis output (#50)
  });

  it("folds the judge call's cost into the run + _analysis row (the cost invariant, AC 10)", async () => {
    const collector = new SpanCollector();
    collector.onSpan({ stage: 'planner', record: { ...mkRec(), costUsd: 0.02 } });
    const { run, rows } = await reduceRunTrace(collector, runWithBrief(), base, { judge: fakeJudge });
    // planner 0.02 + judge 0.07 — both in the analysis row and the run total.
    expect(run.metrics?.costUsd).toBeCloseTo(0.09);
    const analysis = rows.find((r) => r.rowKey === ANALYSIS_ROW_KEY);
    expect(analysis?.scores?.costUsd).toBeCloseTo(0.09);
    const rowSum = rows.reduce((s, r) => s + (r.scores?.costUsd ?? 0), 0);
    expect(rowSum).toBeCloseTo(run.metrics?.costUsd ?? 0);
  });

  it('flows --baseline into meta.baseline → the run record; omits it when unset', async () => {
    const collector = new SpanCollector();
    collector.onSpan({ stage: 'planner', record: mkRec() });
    const noBrief: PipelineRunResult = { result: { hub: { tiers: [] }, pages: [] }, records: [], costUsd: 0 };
    const withBaseline = await reduceRunTrace(collector, noBrief, base, { baseline: 'run0' });
    expect(withBaseline.run.baseline).toBe('run0');
    const without = await reduceRunTrace(new SpanCollector(), noBrief, base);
    expect('baseline' in without.run).toBe(false);
  });

  it('runs the judge on the threaded judgeModel (a --cheap run judges on the cheap model, not opus)', async () => {
    // #57 SUGGESTION #2: the judge must follow the run's tier. A spy judge captures the model arg it
    // is called with; passing the cheap Haiku as judgeModel must reach the judge (not STAGE_MODELS.critic).
    const haiku: StageModel = { provider: 'anthropic', model: 'claude-haiku-4-5' };
    const captured: (StageModel | undefined)[] = [];
    const spyJudge: typeof judgeBrief = (_brief, _deps, model) => {
      captured.push(model);
      return fakeJudge();
    };
    const collector = new SpanCollector();
    collector.onSpan({ stage: 'planner', record: mkRec() });
    await reduceRunTrace(collector, runWithBrief(), base, { judge: spyJudge, judgeModel: haiku });
    expect(captured).toEqual([haiku]); // the judge ran on the threaded cheap model
  });

  it('leaves the judge on its own default when no judgeModel is threaded', async () => {
    // No judgeModel → the judge is called WITHOUT a model arg, so judgeBrief uses STAGE_MODELS.critic.
    const captured: (StageModel | undefined)[] = [];
    const spyJudge: typeof judgeBrief = (_brief, _deps, model) => {
      captured.push(model);
      return fakeJudge();
    };
    const collector = new SpanCollector();
    collector.onSpan({ stage: 'planner', record: mkRec() });
    await reduceRunTrace(collector, runWithBrief(), base, { judge: spyJudge });
    expect(captured).toEqual([undefined]); // no model arg → judgeBrief falls back to its default (opus)
  });

  it('skips the judge when the run exposes no brief (curriculum path) — no judge span, no scores', async () => {
    const collector = new SpanCollector();
    collector.onSpan({ stage: 'planner', record: { ...mkRec(), costUsd: 0.02 } });
    const noBrief: PipelineRunResult = {
      result: { hub: { tiers: [] }, pages: [page('a', false)] },
      records: [],
      costUsd: 0.02,
    };
    const judge = vi.fn(fakeJudge);
    const { run, rows } = await reduceRunTrace(collector, noBrief, base, { judge });
    expect(judge).not.toHaveBeenCalled();
    expect(run.metrics?.costUsd).toBeCloseTo(0.02); // only the planner span; no judge cost
    expect(rows.find((r) => r.rowKey === ANALYSIS_ROW_KEY)?.output).toEqual({ phase: 'analysis' });
  });
});

describe('persistInput', () => {
  it('assembles the persistRun input with STAGE_MODELS merged with the run overrides', () => {
    const run: PipelineRunResult = { result: { hub: { tiers: [] }, pages: [] }, records: [], costUsd: 0.21 };
    const request: TopicRequest = { topic: 'Fourier', settings: { level: 'intro', depth: 2, audience: 'a' } };
    const haiku: StageModel = { provider: 'anthropic', model: 'claude-haiku-4-5' };
    const input = persistInput('run-1', request, run, { models: { planner: haiku } });
    expect(input.runId).toBe('run-1');
    expect(input.costUsd).toBe(0.21);
    expect(input.modelSnapshots.planner).toEqual(haiku); // override merged in
    expect(input.modelSnapshots.graph).toEqual(STAGE_MODELS.graph); // default preserved
  });
});
