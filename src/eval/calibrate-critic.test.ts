import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { LearningEfficacy, LedgerConformance } from '../domain/stages';
import { STAGE_MODELS } from '../llm/models';
import type { StageDeps } from '../pipeline/deps';
import { FIXTURE_MANIFEST, type LabeledFixture } from '../pipeline/fixtures/corpus';
import { calibrateOne, expectedToPass, formatRow, isDirectInvocation } from './calibrate-critic';

// This test proves the calibration DRIVER's wiring with a FAKE critic — NO live model, so it runs in
// CI. The live-spend behavior (the real critic over the corpus) is the manual `npm run critic:calibrate`
// step, deliberately not exercised here. Importing the driver makes no live call (the `main()` guard).

const sub = (score: number): { score: number; note: string } => ({ score, note: 'n' });
const all = (
  score: number,
): { learningEfficacy: LearningEfficacy; ledgerConformance: LedgerConformance } => ({
  learningEfficacy: {
    misconceptionHook: sub(score),
    retrievalCheck: sub(score),
    findingsGrounded: sub(score),
    apparatusAddsBeyondProse: sub(score),
  },
  ledgerConformance: {
    namedGridPresent: sub(score),
    perSectionSubgrid: sub(score),
    collapseQueryPresent: sub(score),
    noRootLiteralOverride: sub(score),
    predictGateStructure: sub(score),
  },
});

/** A fake graded-critic arm fn: returns canned passed + sub-scores, never touches a model. */
function fakeCritic(passed: boolean) {
  return async (artifact: { nodeSlug: string; html: string; learningGoal: string; spec: unknown }) => ({
    artifact: { ...artifact, passed, critique: 'fake', scores: all(passed ? 0.9 : 0.1) } as never,
    records: [],
  });
}

const good = FIXTURE_MANIFEST.find((f) => f.label === 'good') as LabeledFixture;
const vapid = FIXTURE_MANIFEST.find((f) => f.label === 'vapid') as LabeledFixture;

describe('the labeled fixture corpus', () => {
  it('contains at least a good, a vapid, and a structurally-broken fixture', () => {
    const labels = new Set(FIXTURE_MANIFEST.map((f) => f.label));
    expect(labels.has('good')).toBe(true);
    expect(labels.has('vapid')).toBe(true);
    expect(labels.has('broken')).toBe(true);
    expect(FIXTURE_MANIFEST.length).toBeGreaterThanOrEqual(3);
  });

  it('the good fixture carries the named-grid set incl. [scrub] and a predict-gate', async () => {
    const { readFixtureHtml } = await import('../pipeline/fixtures/corpus');
    const html = readFixtureHtml(good);
    expect(html).toContain('[screen-start]');
    expect(html).toContain('[scrub]');
    expect(html).toContain('predict-gate');
  });
});

describe('expectedToPass', () => {
  it('only the good label is expected to pass', () => {
    expect(expectedToPass('good')).toBe(true);
    expect(expectedToPass('vapid')).toBe(false);
    expect(expectedToPass('broken')).toBe(false);
  });
});

describe('calibrateOne (driver wiring, fake critic — no live model)', () => {
  it('agrees when a good fixture passes', async () => {
    const { row } = await calibrateOne(good, {} as StageDeps, STAGE_MODELS.critic, fakeCritic(true));
    expect(row.passed).toBe(true);
    expect(row.agrees).toBe(true);
  });

  it('disagrees when a good fixture is (wrongly) failed — calibration surfaces the mismatch', async () => {
    const { row } = await calibrateOne(good, {} as StageDeps, STAGE_MODELS.critic, fakeCritic(false));
    expect(row.passed).toBe(false);
    expect(row.agrees).toBe(false);
  });

  it('agrees when a vapid fixture fails', async () => {
    const { row } = await calibrateOne(vapid, {} as StageDeps, STAGE_MODELS.critic, fakeCritic(false));
    expect(row.agrees).toBe(true);
  });
});

describe('formatRow', () => {
  it('marks agreement and prints all nine sub-scores', async () => {
    const { row } = await calibrateOne(good, {} as StageDeps, STAGE_MODELS.critic, fakeCritic(true));
    const line = formatRow(row);
    expect(line).toContain('OK ');
    expect(line).toContain('PASS');
    expect(line).toContain('misconceptionHook=');
    expect(line).toContain('namedGridPresent=');
  });
});

describe('the main() guard (isDirectInvocation) — gates the only live-spend path', () => {
  const moduleUrl = pathToFileURL('/x/src/eval/calibrate-critic.ts').href;

  it('is true when argv[1] IS this module (direct `tsx …` invocation runs main())', () => {
    // The literal filesystem path tsx passes as argv[1] for this module.
    expect(isDirectInvocation(moduleUrl, '/x/src/eval/calibrate-critic.ts')).toBe(true);
  });

  it('is false when argv[1] is a DIFFERENT entrypoint (imported by another runner — e.g. vitest)', () => {
    // This is the case that holds under `npm test`: the test runner is argv[1], not this module,
    // so main() must NOT fire. A regressed guard (e.g. dropping the URL comparison) goes red here.
    expect(isDirectInvocation(moduleUrl, '/usr/local/bin/vitest')).toBe(false);
    expect(isDirectInvocation(moduleUrl, '/x/src/eval/run-job.ts')).toBe(false);
  });

  it('is false when argv[1] is undefined (no entrypoint — e.g. a bare REPL import)', () => {
    expect(isDirectInvocation(moduleUrl, undefined)).toBe(false);
  });
});
