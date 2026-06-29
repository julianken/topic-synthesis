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

/**
 * The seeded built lesson's HTML carries a COORDINATE-ONLY stub sender so the lesson-workspace apparatus
 * panel (PR-B + PR-F) can be exercised deterministically end to end. It posts the { sections,
 * scrollProgress } contract (lesson-message.ts) to `window.parent` on load (scrollProgress 0), and
 * re-posts at a TEST-CHOSEN progress when the e2e driver sends a `lesson:set-progress` parent→child
 * message. PR-F: it ALSO posts the OPTIONAL `apparatus` extension (key terms / figure caption / source /
 * self-check / takeaways) in the SAME message — the richer cards now light up with REAL data. The driver
 * can toggle apparatus OFF (`withApparatus:false`) to exercise the BACKWARD-COMPAT old shape (no
 * apparatus → the cards fall back to placeholders), so one fixture proves both paths. This mirrors how a
 * real lesson's in-iframe sender posts, driven deterministically by the spec rather than real scrolling.
 *
 * The sender posts ONLY coordinate-only data (sections {id,title}, a number, and serialized text/url
 * apparatus) — never HTML, never a DOM node ref — honoring the trust boundary the validator enforces.
 */
const SEED_SECTIONS = [
  { id: 's1', title: 'The tree puzzle' },
  { id: 's2', title: 'Where the mass comes from' },
  { id: 's3', title: 'Splitting water for light' },
  { id: 's4', title: 'Measuring the gas exchange' },
  { id: 's5', title: 'Predict, then check' },
  { id: 's6', title: 'What to carry away' },
];

/** The PR-F apparatus payload — coordinate-only TEXT (+ an http(s) source URL), what a real lesson's
 *  serialized glosses/figures/sources/checks/takeaways look like. Deterministic for the panel asserts. */
const SEED_APPARATUS = {
  glosses: [
    { term: 'Chlorophyll', definition: 'The green pigment that captures light energy in a leaf.' },
    { term: 'Stomata', definition: 'Tiny adjustable pores on a leaf that let CO₂ in and O₂ out.' },
  ],
  figures: [{ caption: 'A leaf cross-section: light in, water up, sugar out.' }],
  sources: [
    { title: 'Encyclopaedia Britannica — Photosynthesis', url: 'https://www.britannica.com/science/photosynthesis' },
  ],
  checks: [
    { prompt: 'Where does most of a tree’s mass come from?', answer: 'From carbon in the air (CO₂), not from the soil.' },
  ],
  takeaways: [
    'A plant builds its body mostly from air and water, using light.',
    'Leaves are green because chlorophyll reflects green light.',
  ],
};

const SEED_SENDER_SCRIPT = `
<script>
  (function () {
    var sections = ${JSON.stringify(SEED_SECTIONS)};
    var apparatus = ${JSON.stringify(SEED_APPARATUS)};
    function post(p, withApparatus) {
      var msg = { type: 'lesson:progress', sections: sections, scrollProgress: p };
      // PR-F: include the apparatus extension by DEFAULT; the driver can omit it (withApparatus:false)
      // to drive the backward-compat old shape (no apparatus → the panel renders placeholders).
      if (withApparatus !== false) msg.apparatus = apparatus;
      try { parent.postMessage(msg, '*'); } catch (e) {}
    }
    // TEST DRIVER: the e2e posts {type:'lesson:set-progress', scrollProgress, withApparatus?} INTO this
    // frame to drive a deterministic reading position; we re-emit the coordinate-only message outward.
    // It ALSO ACKS a PR-C parent->child {type:'lesson:scrollTo', id} by echoing a coordinate-only
    // {type:'lesson:scrollTo-ack', id} back OUT — proving the jump message crossed the opaque boundary
    // carrying the right id (the e2e listens for the ack on window.parent).
    window.addEventListener('message', function (e) {
      var d = e.data;
      if (d && d.type === 'lesson:set-progress' && typeof d.scrollProgress === 'number') post(d.scrollProgress, d.withApparatus);
      if (d && d.type === 'lesson:scrollTo' && typeof d.id === 'string') {
        try { parent.postMessage({ type: 'lesson:scrollTo-ack', id: d.id }, '*'); } catch (e2) {}
      }
    });
    post(0);
  })();
<\/script>`;

const SEED_LESSON_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Photosynthesis</title></head><body><main><h1>Photosynthesis</h1><p>A lesson body.</p></main>${SEED_SENDER_SCRIPT}</body></html>`;

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
      html: SEED_LESSON_HTML,
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
