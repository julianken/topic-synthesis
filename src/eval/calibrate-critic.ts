import { pathToFileURL } from 'node:url';
import {
  type CriticSubScore,
  type LearningEfficacy,
  type LedgerConformance,
} from '../domain/stages';
import { cheapModels, STAGE_MODELS, type StageModel } from '../llm/models';
import { gradedCritique } from '../pipeline/critic';
import { defaultDeps, type StageDeps } from '../pipeline/deps';
import {
  FIXTURE_MANIFEST,
  fixtureArtifact,
  type FixtureLabel,
  type LabeledFixture,
} from '../pipeline/fixtures/corpus';
import type { CriticOutput } from '../pipeline/critic';

/**
 * THE NAMED OFFLINE-CALIBRATION STEP (TS-7) — `npm run critic:calibrate`.
 *
 * LIVE SPEND, RUN BY HAND, NEVER IN CI. This driver runs the REAL ledger-aware graded critic
 * (`gradedCritique`) over the hand-labeled good/vapid fixture corpus (`src/pipeline/fixtures/`) on
 * the run's resolved critic model and prints, per fixture, the nine sub-scores + the DERIVED
 * `passed` next to its expected label — so the operator can confirm good→pass / vapid→fail /
 * broken→fail and tune `CRITIC_PASS_THRESHOLD` (and the prompt) accordingly.
 *
 * It is deliberately NOT a Vitest test and is NOT part of `npm test`: CI proves only the THRESHOLD
 * ARITHMETIC over canned sub-scores (`critic.test.ts`). "The critic actually detects vapidity"
 * requires the real model over real lessons, so it lives here as a live-spend manual step. The
 * `main()` guard at the bottom means importing this module (e.g. for the unit test below) never
 * makes a live call. Calibration against REAL v11 emissions is deferred to TS-15b.
 *
 * Needs a provider API key in the env (e.g. ANTHROPIC_API_KEY). `--cheap` runs the critic on the
 * cheap synthesis model (Sonnet, per `cheapModels()`) to keep a calibration sweep to pennies.
 */

const EFFICACY_AXES = [
  'misconceptionHook',
  'retrievalCheck',
  'findingsGrounded',
  'apparatusAddsBeyondProse',
] as const;
const LEDGER_AXES = [
  'namedGridPresent',
  'perSectionSubgrid',
  'collapseQueryPresent',
  'noRootLiteralOverride',
  'predictGateStructure',
] as const;

/** Does the derived `passed` match what the fixture's label expects? `good` → pass, else → fail. */
export function expectedToPass(label: FixtureLabel): boolean {
  return label === 'good';
}

/** A one-fixture calibration row: the label, the derived passed, and whether they agree. */
export interface CalibrationRow {
  fixture: LabeledFixture;
  passed: boolean;
  /** The graded sub-scores (present because the graded arm always emits them). */
  scores: { learningEfficacy: LearningEfficacy; ledgerConformance: LedgerConformance };
  critique: string;
  /** True iff the derived verdict matches the fixture's expected bucket. */
  agrees: boolean;
}

/** Grade ONE labeled fixture with the (injectable) critic and reduce it to a calibration row. */
export async function calibrateOne(
  fixture: LabeledFixture,
  deps: StageDeps,
  model: StageModel,
  critic: typeof gradedCritique = gradedCritique,
): Promise<{ row: CalibrationRow; out: CriticOutput }> {
  const out = await critic(fixtureArtifact(fixture), deps, model);
  const scores = out.artifact.scores;
  // The graded arm always carries `scores`; this guard keeps the type narrow without an assertion.
  if (scores === undefined) throw new Error(`graded critic returned no sub-scores for ${fixture.id}`);
  const row: CalibrationRow = {
    fixture,
    passed: out.artifact.passed,
    scores,
    critique: out.artifact.critique,
    agrees: out.artifact.passed === expectedToPass(fixture.label),
  };
  return { row, out };
}

/** Format one calibration row for the console — label vs derived verdict + the nine sub-scores. */
export function formatRow(row: CalibrationRow): string {
  const mark = row.agrees ? 'OK ' : 'XX ';
  const verdict = row.passed ? 'PASS' : 'FAIL';
  const fmt = (s: CriticSubScore): string => s.score.toFixed(2);
  const eff = EFFICACY_AXES.map((a) => `${a}=${fmt(row.scores.learningEfficacy[a])}`).join(' ');
  const led = LEDGER_AXES.map((a) => `${a}=${fmt(row.scores.ledgerConformance[a])}`).join(' ');
  return [
    `${mark}${row.fixture.id} [label:${row.fixture.label} → expected ${expectedToPass(row.fixture.label) ? 'PASS' : 'FAIL'}] → derived ${verdict}`,
    `    efficacy: ${eff}`,
    `    ledger:   ${led}`,
    `    critique: ${row.critique.replace(/\s+/g, ' ').slice(0, 200)}`,
  ].join('\n');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const model: StageModel = args.includes('--cheap') ? cheapModels().critic : STAGE_MODELS.critic;
  console.log(
    `Calibrating the graded critic over ${FIXTURE_MANIFEST.length} fixture(s) on ${model.provider}:${model.model} (LIVE SPEND)…\n`,
  );
  const rows: CalibrationRow[] = [];
  let totalCost = 0;
  for (const fixture of FIXTURE_MANIFEST) {
    const { row, out } = await calibrateOne(fixture, defaultDeps, model);
    rows.push(row);
    totalCost += out.records.reduce((sum, r) => sum + r.costUsd, 0);
    console.log(formatRow(row));
    console.log('');
  }
  const agree = rows.filter((r) => r.agrees).length;
  console.log(
    `${agree}/${rows.length} fixture(s) match their label. Total live spend: $${totalCost.toFixed(4)}.`,
  );
  console.log(
    'Tune `CRITIC_PASS_THRESHOLD` (src/domain/stages.ts) and/or the GRADED_CRITIC_SYSTEM rubric if a row disagrees.',
  );
}

// Run only when invoked directly (tsx src/eval/calibrate-critic.ts) — never on import (so the unit
// test importing the helpers above makes NO live call, and `npm test` never triggers live spend).
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
