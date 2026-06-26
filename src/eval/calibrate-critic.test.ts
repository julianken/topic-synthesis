import { describe, expect, it, vi } from 'vitest';
import type { LearningEfficacy, LedgerConformance } from '../domain/stages';
import { STAGE_MODELS } from '../llm/models';
import type { StageDeps } from '../pipeline/deps';
import { FIXTURE_MANIFEST, type LabeledFixture } from '../pipeline/fixtures/corpus';
import { calibrateOne, expectedToPass, formatRow } from './calibrate-critic';

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

describe('the calibration driver does not run on import', () => {
  it('importing calibrate-critic makes no live model call', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await import('./calibrate-critic');
    // If main() had fired on import it would have logged the "Calibrating…" banner and spent.
    expect(spy).not.toHaveBeenCalledWith(expect.stringContaining('LIVE SPEND'));
    spy.mockRestore();
  });
});
