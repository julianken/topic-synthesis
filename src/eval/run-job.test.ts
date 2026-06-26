import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CRITIC_PASS_THRESHOLD,
  CriticVerdictSchema,
  FindingsSchema,
  GradedCriticVerdictSchema,
  LessonBriefSchema,
  type LearningEfficacy,
  type LedgerConformance,
  PageSpecSchema,
  PlanSchema,
  type TopicRequest,
} from '../domain/stages';
import { InlineEngine } from '../engine/inline-engine';
import type { StageModel } from '../llm/models';
import { gradedCritique } from '../pipeline/critic';
import type { StageDeps } from '../pipeline/deps';
import { defaultStages, noopSink, type StageBundle } from '../pipeline/ports';
import { runLesson } from '../pipeline/run-pipeline';
import { buildJobInput } from './run-job';

const SAVED = { ...process.env };
const JOB_KEYS = ['RUN_ID', 'TOPIC', 'LEVEL', 'DEPTH', 'AUDIENCE', 'CHEAP', 'MAX_NODES', 'MAX_QUESTIONS'];

beforeEach(() => {
  for (const k of JOB_KEYS) delete process.env[k];
});
afterEach(() => {
  process.env = { ...SAVED };
});

describe('buildJobInput', () => {
  it('reads RUN_ID + TOPIC + knobs from env (RUN_ID is the input id, never generated)', () => {
    Object.assign(process.env, {
      RUN_ID: 'r1',
      TOPIC: 'Fourier transforms',
      LEVEL: 'advanced',
      DEPTH: '4',
      CHEAP: '1',
      MAX_NODES: '4',
      MAX_QUESTIONS: '3',
    });
    const { runId, request, options } = buildJobInput();
    expect(runId).toBe('r1');
    expect(request).toEqual({
      topic: 'Fourier transforms',
      settings: { level: 'advanced', depth: 4, audience: 'a self-taught learner' },
    });
    expect(options.maxNodes).toBe(4);
    expect(options.maxQuestions).toBe(3);
    expect(options.models).toBeDefined(); // CHEAP → cheapModels()
  });

  it('defaults level/depth/audience when unset', () => {
    Object.assign(process.env, { RUN_ID: 'r', TOPIC: 't' });
    const { request, options } = buildJobInput();
    expect(request.settings).toEqual({ level: 'intermediate', depth: 3, audience: 'a self-taught learner' });
    expect(options.models).toBeUndefined();
  });

  it('throws on a missing RUN_ID (never generated — a resume must reuse the same id)', () => {
    process.env.TOPIC = 't';
    expect(() => buildJobInput()).toThrow(/RUN_ID/);
  });

  it('throws on a missing TOPIC', () => {
    process.env.RUN_ID = 'r';
    expect(() => buildJobInput()).toThrow(/TOPIC/);
  });

  it('throws on an invalid MAX_NODES (a typo cannot silently cap to 0 after spend)', () => {
    Object.assign(process.env, { RUN_ID: 'r', TOPIC: 't', MAX_NODES: 'oops' });
    expect(() => buildJobInput()).toThrow(/MAX_NODES/);
  });
});

// ── TS-9: the graded critic gates `built` on the LIVE/Job path (AC1/AC2) ──────────────────────
// The Job's run call is `runLesson(request, new GcpEngine(runId), defaultDeps, options, defaultStages,
// noopSink)` (run-job.ts:66). The `built` gate is the pure `synth.artifact?.passed` line in `runLesson`
// — engine-agnostic (the engine only memoizes; it never touches the gate), so this exercises the gate
// with the EXACT non-engine arguments the Job uses (fake deps shaped like `defaultDeps`, the live
// `defaultStages` for the blob default, the v11 critic SWAP for the graded arm, `noopSink`) over an
// `InlineEngine` — `GcpEngine` would need a live Postgres (`getPool()` at construction). The arm is the
// `StageBundle.critic` swap (program decision 3/7), NOT a `RunOptions` flag; the gate reads `passed`
// unchanged either way.
const req: TopicRequest = { topic: 'Fourier transforms', settings: { level: 'intro', depth: 2, audience: 'a' } };

const mkRec = () => ({
  providerModel: 'anthropic:claude-opus-4-8',
  inputTokens: 10,
  outputTokens: 10,
  costUsd: 0.01,
  rawUsage: {},
  finishReason: 'stop',
});

const jobSub = (score: number): { score: number; note: string } => ({ score, note: 'n' });
const jobVerdictAt = (
  score: number,
): { learningEfficacy: LearningEfficacy; ledgerConformance: LedgerConformance } => ({
  learningEfficacy: {
    misconceptionHook: jobSub(score),
    retrievalCheck: jobSub(score),
    findingsGrounded: jobSub(score),
    apparatusAddsBeyondProse: jobSub(score),
  },
  ledgerConformance: {
    namedGridPresent: jobSub(score),
    perSectionSubgrid: jobSub(score),
    collapseQueryPresent: jobSub(score),
    noRootLiteralOverride: jobSub(score),
    predictGateStructure: jobSub(score),
  },
});

/** Job-path lesson deps. `criticArm` decides which critic schema the fake answers: the binary
 *  `CriticVerdictSchema` (blob arm) returns `{passed: binaryPassed}`; the `GradedCriticVerdictSchema`
 *  (v11 arm) returns canned sub-scores at `gradedScore` (with the model self-asserting the OPPOSITE
 *  boolean, so a pass/fail proves `built` is driven by the DERIVED value, not the model's claim). */
function jobLessonDeps(opts: { binaryPassed?: boolean; gradedScore?: number } = {}): StageDeps {
  const completeObject = vi.fn(async (o: { schema: unknown; prompt: string; model: StageModel }) => {
    if (o.schema === PlanSchema) {
      return { object: { scope: 'S', subtopics: ['a'], researchQuestions: ['q1'] }, record: mkRec() };
    }
    if (o.schema === FindingsSchema) {
      return { object: { findings: [{ claim: 'c', sourceIndex: 0 }] }, record: mkRec() };
    }
    if (o.schema === LessonBriefSchema) {
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
    if (o.schema === PageSpecSchema) {
      return {
        object: { nodeSlug: 'lesson', interactionKind: 'canvas', a11yContract: 'a', citations: [] },
        record: mkRec(),
      };
    }
    if (o.schema === CriticVerdictSchema) {
      return { object: { passed: opts.binaryPassed ?? true, critique: 'ok' }, record: mkRec() };
    }
    if (o.schema === GradedCriticVerdictSchema) {
      const score = opts.gradedScore ?? 0.9;
      const passes = score >= CRITIC_PASS_THRESHOLD;
      // self-assert the OPPOSITE so derivePassed (not the model boolean) drives the gate.
      return { object: { passed: !passes, critique: 'graded', ...jobVerdictAt(score) }, record: mkRec() };
    }
    throw new Error('unexpected schema');
  });
  const searchWeb = vi.fn(async () => ({
    text: 's',
    sources: [{ url: 'https://s.example', title: 'S' }],
    record: mkRec(),
  }));
  const complete = vi.fn(async () => ({ text: '<!doctype html><html></html>', record: mkRec() }));
  return { complete, completeObject, searchWeb } as unknown as StageDeps;
}

const builtPages = (run: Awaited<ReturnType<typeof runLesson>>) =>
  run.result.hub.tiers.flatMap((t) => t.categories.flatMap((c) => c.pages));

describe('TS-9 — graded critic gates `built` on the live/Job path', () => {
  // The v11 arm is `defaultStages` with the critic swapped to the graded fn — exactly the substitution
  // a v11 deploy would ship into the Job's `defaultStages` argument.
  const v11: StageBundle = { ...defaultStages, critic: gradedCritique };

  it('AC1 — v11 arm: an above-threshold artifact routes `built` on the Job-path runLesson call', async () => {
    const run = await runLesson(req, new InlineEngine(), jobLessonDeps({ gradedScore: 0.9 }), {}, v11, noopSink);
    expect(run.result.pages[0]?.passed).toBe(true); // derived from the sub-score floor
    expect(builtPages(run)[0]?.built).toBe(true); // the live gate read `synth.artifact?.passed`
    expect(run.result.pages[0]?.scores?.ledgerConformance.namedGridPresent.score).toBe(0.9);
  });

  it('AC1 — v11 arm: a below-threshold artifact does NOT route `built` (gate degrades it to soon)', async () => {
    const run = await runLesson(req, new InlineEngine(), jobLessonDeps({ gradedScore: 0.3 }), {}, v11, noopSink);
    expect(run.result.pages[0]?.passed).toBe(false);
    expect(builtPages(run)[0]?.status).toBe('soon');
    expect(builtPages(run)[0]?.built).toBe(false);
  });

  it('AC2 — kill-switch: the Job default (defaultStages) runs the BINARY critic and gates unchanged', async () => {
    // The Job passes `defaultStages` literally; its critic is the binary `critique` (the live default).
    const run = await runLesson(req, new InlineEngine(), jobLessonDeps({ binaryPassed: true }), {}, defaultStages, noopSink);
    expect(run.result.pages[0]?.scores).toBeUndefined(); // binary verdict → no graded sub-scores
    expect(run.result.pages[0]?.passed).toBe(true); // the binary boolean drives the gate
    expect(builtPages(run)[0]?.built).toBe(true);

    const failed = await runLesson(req, new InlineEngine(), jobLessonDeps({ binaryPassed: false }), {}, defaultStages, noopSink);
    expect(failed.result.pages[0]?.passed).toBe(false);
    expect(builtPages(failed)[0]?.built).toBe(false); // binary fail still degrades — gate unchanged
  });

  it('AC2 — swapping the critic fn is the ONLY thing that changes gate behavior (no RunOptions arm flag)', () => {
    // The two arms differ ONLY in the `critic` field; every other StageBundle field is identical, so the
    // arm is a pure stage substitution (program decision 3/7), never a run-options branch.
    const { critic: blobCritic, ...blobRest } = defaultStages;
    const { critic: v11Critic, ...v11Rest } = v11;
    expect(v11Rest).toEqual(blobRest); // all non-critic stages identical
    expect(v11Critic).not.toBe(blobCritic); // only the critic differs
    expect(blobCritic).toBe(defaultStages.critic); // blob arm = the live default
  });
});

// ── TS-9 AC3: the Job emits NO live trace/judge telemetry (revision 7's no-telemetry contract) ────────
// run-job.ts:66 passes `noopSink` and the Job never constructs a SpanCollector nor calls judgeBrief — so
// the live path emits gating decisions + persisted sub-scores but NO eleatic `_analysis` row / judge
// scores. Pinning it on the SOURCE (not just runtime) so a future edit can't silently start charging
// judge spend on every production run; the A/B record is the CLI-offline bench's job, not the Job's.
describe('TS-9 AC3 — the Job collects no trace/judge telemetry', () => {
  const SOURCE = readFileSync(fileURLToPath(new URL('./run-job.ts', import.meta.url)), 'utf8');

  it('passes `noopSink` as the runLesson TraceSink (the trailing arg)', () => {
    // `noopSink` is the LAST argument of the runLesson(...) call (after the GcpEngine + defaultStages).
    expect(SOURCE).toMatch(/runLesson\(.*?,\s*noopSink\s*\)/s);
  });

  it('does NOT construct a SpanCollector (no live trace store in the Job)', () => {
    expect(SOURCE).not.toContain('SpanCollector');
  });

  it('does NOT import or call judgeBrief (no live judge spend per production run)', () => {
    expect(SOURCE).not.toContain('judgeBrief');
    expect(SOURCE).not.toContain('judge');
  });

  it('imports noopSink from ports (the no-op TraceSink whose onSpan does nothing)', () => {
    expect(SOURCE).toMatch(/import\s*\{[^}]*noopSink[^}]*\}\s*from\s*'\.\.\/pipeline\/ports'/);
    expect(noopSink.onSpan({ stage: 'spec', record: mkRec() })).toBeUndefined(); // it truly drops the span
  });
});
