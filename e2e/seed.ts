import { Pool } from 'pg';
import type { PipelineResult, TopicRequest } from '../src/domain/stages';
import { STAGE_MODELS } from '../src/llm/models';
import { persistRun, recordRunOwner } from '../src/store/repo';

// e2e/seed — a DETERMINISTIC owned lesson for the library VISUAL baseline. The library card grid is
// owner-scoped over a SHARED Postgres, so a full-grid capture is otherwise non-deterministic (count,
// titles, height vary run to run). This seeds ONE known DENSE card (category eyebrow + summary
// description + built status) for the e2e owner via the REAL `persistRun` path, so the visual spec can
// snapshot a single, byte-stable card. It clears the owner's prior curricula first so the grid is
// exactly this one card every run (kept deterministic via the seed, per the harness's rebuild flow).
//
// The owner sub MUST equal src/app/auth/provider.ts E2E_OWNER_SUB and the cookie the smoke/visual specs
// seed (e2e/auth.ts). Run by the Playwright global setup (playwright.config.ts `globalSetup`).

/** Must equal src/app/auth/provider.ts E2E_OWNER_SUB. */
const E2E_OWNER_SUB = 'e2e-owner-sub';

/** A FIXED curriculum/run id so a reseed is idempotent (persistRun is ON CONFLICT DO NOTHING). */
export const SEED_RUN_ID = 'e2e-seed-photosynthesis';

/** A FIXED IN-FLIGHT run id (owned by the e2e owner, NO persisted curriculum) so the reader route shows
 *  the live-research GENERATING view (Figma 1:2) deterministically. The visual spec intercepts the status
 *  poll for THIS id and returns a stable mid-run research+steps payload, so the captured graph + ledger
 *  are byte-stable. `ownsRun(id)` must be TRUE for page.tsx to render the generating branch (vs a 404). */
export const SEED_GENERATING_RUN_ID = 'e2e-seed-generating-run';

const SEED_REQUEST: TopicRequest = {
  topic: 'Photosynthesis',
  settings: { level: 'intro', depth: 2, audience: 'a self-taught learner' },
};

// A built single-lesson result (one tier / one category / one built page) — the shape runLesson emits.
const SEED_RESULT: PipelineResult = {
  hub: {
    tiers: [
      {
        tier: 'Tier 1',
        categories: [
          {
            name: 'Lesson',
            pages: [{ slug: 'photosynthesis', title: 'Photosynthesis', status: 'built', built: true, href: '' }],
          },
        ],
      },
    ],
  },
  pages: [
    {
      nodeSlug: 'photosynthesis',
      html: '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Photosynthesis</title></head><body><main><h1>Photosynthesis</h1></main></body></html>',
      learningGoal: 'How a plant turns sunlight, water, and air into food — and why leaves are green.',
      spec: { nodeSlug: 'photosynthesis', interactionKind: 'canvas', a11yContract: 'a', citations: [] },
      passed: true,
      critique: 'ok',
    },
  ],
};

/** Seed (idempotently) the deterministic dense library card for the e2e owner. Clears the owner's prior
 *  curricula first so the grid is exactly this one card. Reads DATABASE_URL (same as the app/webServer). */
export async function seedDenseLibraryCard(): Promise<void> {
  const connectionString =
    process.env.DATABASE_URL ?? 'postgresql://topic:topic_dev@localhost:5433/topic_synthesis';
  const pool = new Pool({ connectionString });
  try {
    // Clear the owner's prior curricula (and the cascading curriculum_page rows) so the visual grid is
    // exactly the one seeded card every run. concept_page rows are content-identity-shared, left as-is.
    await pool.query(
      `DELETE FROM curriculum_page WHERE curriculum_id IN (SELECT id FROM curriculum WHERE owner_sub = $1)`,
      [E2E_OWNER_SUB],
    );
    await pool.query(`DELETE FROM curriculum WHERE owner_sub = $1`, [E2E_OWNER_SUB]);

    await persistRun(
      {
        runId: SEED_RUN_ID,
        request: SEED_REQUEST,
        result: SEED_RESULT,
        costUsd: 0,
        modelSnapshots: STAGE_MODELS,
        ownerSub: E2E_OWNER_SUB,
        // The DENSE card's two new rows — the Figma 6:2 eyebrow + description.
        category: 'BIOLOGY',
        summary: 'How a plant turns sunlight, water, and air into food — and why leaves are green.',
      },
      { pool },
    );

    // Stamp the IN-FLIGHT run owner (NO curriculum persisted for this id) so the reader route's
    // generating branch renders for the visual spec. getCurriculum(this id) stays null → page.tsx shows
    // the live-research generating view; ownsRun(this id) is true → it's the generating branch, not a 404.
    // The mid-run research/steps data comes from the spec's status-poll interception (deterministic),
    // not the DB, so no research_event/step_event rows are seeded here.
    await recordRunOwner(SEED_GENERATING_RUN_ID, E2E_OWNER_SUB, { pool });
  } finally {
    await pool.end();
  }
}
