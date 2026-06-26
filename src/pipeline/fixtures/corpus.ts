import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PageArtifact } from '../../domain/stages';

/**
 * The labeled good/vapid fixture corpus for calibrating the graded critic (TS-7). A small,
 * hand-labeled set (right-sized for a solo, pre-v11-generation repo — program decision /
 * right-sizing) used by the NAMED offline-calibration step (`npm run critic:calibrate`,
 * `src/eval/calibrate-critic.ts`). It is NOT exercised by `npm test`: a Vitest test asserts only
 * the THRESHOLD ARITHMETIC over canned sub-scores (`critic.test.ts`); proving the critic actually
 * detects vapidity needs the real model and is the live-spend, non-CI calibration step.
 *
 * Each fixture carries its expected label so the operator can read good→pass / vapid→fail /
 * broken→fail off the calibration output. Real-v11-emission calibration is deferred to TS-15b.
 */
export type FixtureLabel = 'good' | 'vapid' | 'broken';

export interface LabeledFixture {
  /** A stable id used as the artifact's nodeSlug and in the calibration printout. */
  id: string;
  /** The expected verdict bucket: `good` → expected pass; `vapid`/`broken` → expected fail. */
  label: FixtureLabel;
  /** Why this fixture carries that label — the axes it is built to exercise. */
  rationale: string;
  /** The fixture's HTML filename (resolved relative to this module). */
  file: string;
  /** A learning goal to feed the critic prompt alongside the HTML. */
  learningGoal: string;
}

/** The hand-labeled manifest. At minimum one good, one vapid, one structurally-broken fixture. */
export const FIXTURE_MANIFEST: readonly LabeledFixture[] = [
  {
    id: 'good-lesson',
    label: 'good',
    rationale:
      'Named grid incl. [scrub], per-section subgrid, ≤900px collapse, no :root override; misconception ' +
      'hook, a real predict-gate with answer-specific feedback, grounded claim, apparatus that adds.',
    file: 'good-lesson.html',
    learningGoal: 'understand why a sine wave repeats every 2π',
  },
  {
    id: 'vapid-lesson',
    label: 'vapid',
    rationale:
      'Layout is fine, but pedagogically vapid: a flat definition dump, no genuine retrieval check ' +
      '(free reveal + canned feedback), filler apparatus that restates the prose.',
    file: 'vapid-lesson.html',
    learningGoal: 'understand the parts of a sine wave',
  },
  {
    id: 'broken-lesson',
    label: 'broken',
    rationale:
      'Structurally broken vs the ledger: single column (no named grid, no [scrub] track), a :root ' +
      'literal token override, and no ≤900px collapse query.',
    file: 'broken-lesson.html',
    learningGoal: 'understand the phase shift of a sine wave',
  },
];

const FIXTURE_DIR = dirname(fileURLToPath(import.meta.url));

/** Read a fixture's HTML off disk (the .html files live beside this module). */
export function readFixtureHtml(fixture: LabeledFixture): string {
  return readFileSync(join(FIXTURE_DIR, fixture.file), 'utf8');
}

/** Wrap a labeled fixture as a `PageArtifact` the (graded) critic can grade. */
export function fixtureArtifact(fixture: LabeledFixture): PageArtifact {
  return {
    nodeSlug: fixture.id,
    html: readFixtureHtml(fixture),
    learningGoal: fixture.learningGoal,
    spec: {
      nodeSlug: fixture.id,
      interactionKind: 'html',
      a11yContract: 'keyboard-operable; text alternatives for any figure',
      citations: [],
    },
  };
}
