import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type {
  CritiquedArtifact,
  LearningEfficacy,
  LedgerConformance,
  PipelineResult,
  TopicRequest,
} from '../domain/stages';
import { STAGE_MODELS } from '../llm/models';
import {
  getCurriculum,
  getOwnedPage,
  getStepEvents,
  ownsRun,
  persistRun,
  rebuildHub,
  recordRunOwner,
  type StoreDeps,
} from './repo';

// ── a fake pg pool: records every query, returns canned rows by SQL substring ──
interface Canned {
  match: string;
  rows: unknown[];
}
function fakePool(canned: Canned[] = []) {
  const query = vi.fn(async (sql: string) => {
    const hit = canned.find((c) => sql.includes(c.match));
    return { rows: hit ? hit.rows : [] };
  });
  const release = vi.fn();
  const client = { query, release };
  const pool = { query, connect: vi.fn(async () => client) } as unknown as Pool;
  return { deps: { pool } satisfies StoreDeps, client };
}
const sqlsOf = (fn: { mock: { calls: unknown[][] } }) => fn.mock.calls.map((c) => c[0] as string);
/** The params array of the first emitted query whose SQL includes `match` (e.g. the wf-version INSERT). */
const paramsOf = (fn: { mock: { calls: unknown[][] } }, match: string): unknown[] | undefined =>
  fn.mock.calls.find((c) => (c[0] as string).includes(match))?.[1] as unknown[] | undefined;

const request: TopicRequest = {
  topic: 'Fourier',
  settings: { level: 'intermediate', depth: 3, audience: 'devs' },
};
const result: PipelineResult = {
  hub: {
    tiers: [
      {
        tier: 'Tier 1',
        categories: [
          {
            name: 'Foundations',
            pages: [
              { slug: 'sine', title: 'Sine', status: 'built', built: true, href: '' },
              { slug: 'cosine', title: 'Cosine', status: 'soon', built: false, href: '' },
            ],
          },
        ],
      },
    ],
  },
  pages: [
    {
      nodeSlug: 'sine',
      html: '<!doctype html><h1>Sine</h1>',
      learningGoal: 'g',
      spec: { nodeSlug: 'sine', interactionKind: 'canvas', a11yContract: 'a', citations: [] },
      passed: true,
      critique: 'ok',
    },
  ],
};

// A single-lesson run (issue #48): a one-tier / one-category / ONE-page hub + one page artifact.
const lessonResult: PipelineResult = {
  hub: {
    tiers: [
      {
        tier: 'Tier 1',
        categories: [{ name: 'Lesson', pages: [{ slug: 'fourier', title: 'Fourier', status: 'built', built: true, href: '' }] }],
      },
    ],
  },
  pages: [
    {
      nodeSlug: 'fourier',
      html: '<!doctype html><h1>Fourier</h1>',
      learningGoal: 'understand the transform',
      spec: { nodeSlug: 'fourier', interactionKind: 'canvas', a11yContract: 'a', citations: [] },
      passed: true,
      critique: 'ok',
    },
  ],
};

describe('rebuildHub', () => {
  it('groups ordered rows into tiers → categories → pages with href + built', () => {
    const hub = rebuildHub(
      [
        { tier: 'T1', category: 'C', page_id: 'p1', concept_slug: 'sine', title: 'Sine', status: 'built' },
        { tier: 'T1', category: 'C', page_id: 'p2', concept_slug: 'cosine', title: 'Cosine', status: 'soon' },
      ],
      'c1',
    );
    expect(hub.tiers).toHaveLength(1);
    expect(hub.tiers[0]?.categories[0]?.pages).toEqual([
      { slug: 'sine', title: 'Sine', status: 'built', built: true, href: '/curriculum/c1/artifact/sine' },
      { slug: 'cosine', title: 'Cosine', status: 'soon', built: false, href: '/curriculum/c1/artifact/cosine' },
    ]);
  });

  it('builds a curriculum-scoped artifact href keyed by slug — NOT a per-pageId capability', () => {
    const hub = rebuildHub(
      [{ tier: 'T', category: 'C', page_id: 'sine@intermediate:d3#a1b2c3', concept_slug: 'sine', title: 'Sine', status: 'built' }],
      'cur-1',
    );
    const href = hub.tiers[0]?.categories[0]?.pages[0]?.href;
    expect(href).toBe('/curriculum/cur-1/artifact/sine');
    expect(href).not.toContain('a1b2c3'); // the shared content-hash pageId is never in the URL
  });
});

describe('persistRun (transaction shape, fake pool)', () => {
  it('writes workflow_version + run + curriculum + per-page rows inside BEGIN/COMMIT', async () => {
    const { deps, client } = fakePool();
    const out = await persistRun(
      { runId: 'run-1', request, result, costUsd: 0.2, modelSnapshots: STAGE_MODELS },
      deps,
    );
    expect(out.curriculumId).toBe('run-1');
    const sqls = sqlsOf(client.query);
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls.at(-1)).toBe('COMMIT');
    expect(sqls.some((s) => s.includes('INTO workflow_version'))).toBe(true);
    expect(sqls.some((s) => s.includes('INTO run'))).toBe(true);
    // run + curriculum inserts are idempotent so a Job retry that re-reaches persist after a prior
    // successful commit no-ops instead of throwing a duplicate-key error (crash-resume prerequisite).
    expect(sqls.find((s) => s.includes('INTO run'))).toContain('ON CONFLICT (id) DO NOTHING');
    expect(sqls.find((s) => s.includes('INTO curriculum ('))).toContain('ON CONFLICT (id) DO NOTHING');
    expect(sqls.filter((s) => s.includes('INTO concept_page'))).toHaveLength(2); // one per hub page
    expect(client.release).toHaveBeenCalled();
  });

  it('prunes the run\'s transient per-run rows AFTER the inserts, all before COMMIT', async () => {
    const { deps, client } = fakePool();
    await persistRun(
      { runId: 'run-prune', request, result, costUsd: 0.2, modelSnapshots: STAGE_MODELS },
      deps,
    );
    const sqls = sqlsOf(client.query);
    // the three transient tables are each deleted, scoped to this run
    const stepResultDel = sqls.findIndex((s) => s.includes('DELETE FROM step_result'));
    const runOwnerDel = sqls.findIndex((s) => s.includes('DELETE FROM run_owner'));
    const stepEventDel = sqls.findIndex((s) => s.includes('DELETE FROM step_event'));
    expect(stepResultDel).toBeGreaterThan(-1);
    expect(runOwnerDel).toBeGreaterThan(-1);
    expect(stepEventDel).toBeGreaterThan(-1);
    // each delete is run-scoped (WHERE run_id = $1) and carries this runId as its only param
    for (const del of ['DELETE FROM step_result', 'DELETE FROM run_owner', 'DELETE FROM step_event']) {
      expect(sqls.find((s) => s.includes(del))).toContain('WHERE run_id = $1');
      expect(paramsOf(client.query, del)).toEqual(['run-prune']);
    }
    // ORDER: the deletes come AFTER the last insert (so the writes are committed-to before pruning)…
    const lastInsert = Math.max(...sqls.map((s, i) => (s.includes('INSERT INTO') ? i : -1)));
    expect(Math.min(stepResultDel, runOwnerDel, stepEventDel)).toBeGreaterThan(lastInsert);
    // …and all BEFORE the COMMIT, so they share the run's atomic transaction.
    const commit = sqls.indexOf('COMMIT');
    expect(Math.max(stepResultDel, runOwnerDel, stepEventDel)).toBeLessThan(commit);
  });

  it('keeps the deletes INSIDE the tx — a persist failure ROLLBACKs them too (run stays resumable)', async () => {
    const { deps, client } = fakePool();
    // Fail the final write before COMMIT can run; the deletes never reach the DB and any that did are
    // rolled back — so the transient rows survive a failed persist and the run remains resumable.
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('INTO curriculum_page')) throw new Error('persist failed');
      return { rows: [] };
    });
    await expect(
      persistRun({ runId: 'run-fail', request, result, costUsd: 0, modelSnapshots: STAGE_MODELS }, deps),
    ).rejects.toThrow('persist failed');
    const sqls = sqlsOf(client.query);
    expect(sqls).toContain('ROLLBACK');
    expect(sqls).not.toContain('COMMIT'); // never committed → the (un)issued deletes are rolled back
    expect(client.release).toHaveBeenCalled();
  });

  it('ROLLBACKs and rethrows on an insert error', async () => {
    const { deps, client } = fakePool();
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('INTO run')) throw new Error('boom');
      return { rows: [] };
    });
    await expect(
      persistRun({ runId: 'run-2', request, result, costUsd: 0, modelSnapshots: STAGE_MODELS }, deps),
    ).rejects.toThrow('boom');
    expect(sqlsOf(client.query)).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});

describe('persistRun — contract-aware workflow_version (issue #50)', () => {
  it('inserts a real prompt_hash (the LessonBrief+prompts hash), no longer the literal "v1"', async () => {
    const { deps, client } = fakePool();
    await persistRun({ runId: 'r', request, result, costUsd: 0, modelSnapshots: STAGE_MODELS }, deps);
    const params = paramsOf(client.query, 'INTO workflow_version');
    // [id, model_snapshots, prompt_hash] — AC #1: the 3rd param is no longer 'v1'.
    expect(params?.[2]).not.toBe('v1');
    expect(typeof params?.[2]).toBe('string');
    expect((params?.[2] as string).length).toBeGreaterThan(0);
  });

  it('the workflow_version id depends on prompt_hash, not on the model snapshots alone', async () => {
    // AC #2: the id is a function of the prompt/contract hash. The wf-version id (1st param) and the
    // prompt_hash (3rd param) are emitted together; the id must fold the prompt_hash in, so it is NOT
    // contentHash(snapshotsJson) anymore. We can't recompute the old value here, but we CAN assert the
    // id and prompt_hash co-vary across a schema change (next test) and that the prompt_hash is present.
    const { deps, client } = fakePool();
    await persistRun({ runId: 'r', request, result, costUsd: 0, modelSnapshots: STAGE_MODELS }, deps);
    const params = paramsOf(client.query, 'INTO workflow_version');
    expect(params?.[0]).toEqual(expect.any(String)); // the workflow_version id
    expect(params?.[2]).toEqual(expect.any(String)); // the real prompt_hash folded into it
  });

  it('changing the LessonBrief schema hash flips the workflow_version while modelSnapshots are constant', async () => {
    // AC #3: re-import persistRun twice with two different mocked LESSON_BRIEF_SCHEMA_HASH values; the
    // emitted workflow_version id must differ even though modelSnapshots (and prompts) are identical.
    const versionWithSchemaHash = async (schemaHash: string): Promise<string> => {
      vi.resetModules();
      vi.doMock('../domain/stages', async () => {
        const actual = await vi.importActual<typeof import('../domain/stages')>('../domain/stages');
        return { ...actual, LESSON_BRIEF_SCHEMA_HASH: schemaHash };
      });
      const { persistRun: persistFresh } = await import('./repo');
      const { deps, client } = fakePool();
      await persistFresh({ runId: 'r', request, result, costUsd: 0, modelSnapshots: STAGE_MODELS }, deps);
      vi.doUnmock('../domain/stages');
      return paramsOf(client.query, 'INTO workflow_version')?.[0] as string;
    };
    const v1 = await versionWithSchemaHash('schema-hash-AAAA');
    const v2 = await versionWithSchemaHash('schema-hash-BBBB');
    expect(v1).not.toBe(v2); // a contract change → a distinct eval arm, models unchanged
  });
});

describe('persistRun — one-page single-lesson curriculum (issue #48)', () => {
  it('flattens a one-page hub to exactly ONE concept_page + curriculum_page (no schema change)', async () => {
    const { deps, client } = fakePool();
    const out = await persistRun(
      { runId: 'lesson-1', request, result: lessonResult, costUsd: 0.05, modelSnapshots: STAGE_MODELS, ownerSub: 'owner-1' },
      deps,
    );
    expect(out.curriculumId).toBe('lesson-1');
    const sqls = sqlsOf(client.query);
    // exactly one page row both sides of the join — flattenHub is total over a single page.
    expect(sqls.filter((s) => s.includes('INTO concept_page'))).toHaveLength(1);
    expect(sqls.filter((s) => s.includes('INTO curriculum_page'))).toHaveLength(1);
    // the owner_sub is written onto the curriculum (ADR 0002, reused verbatim — no second store).
    expect(sqls.find((s) => s.includes('INTO curriculum ('))).toContain('owner_sub');
  });

  it('round-trips owner-scoped: the owner reads the single page back, a different owner reads null', async () => {
    // owner reads it back
    const owned = fakePool([
      { match: 'FROM curriculum WHERE', rows: [{ id: 'lesson-1', topic: 'Fourier', settings_json: request.settings }] },
      {
        match: 'FROM curriculum_page',
        rows: [{ tier: 'Tier 1', category: 'Lesson', page_id: 'p1', concept_slug: 'fourier', title: 'Fourier', status: 'built' }],
      },
    ]);
    const view = await getCurriculum('lesson-1', 'owner-1', owned.deps);
    const pages = view?.hub.tiers.flatMap((t) => t.categories.flatMap((c) => c.pages));
    expect(pages).toHaveLength(1);
    expect(pages?.[0]?.slug).toBe('fourier');
    expect(pages?.[0]?.href).toBe('/curriculum/lesson-1/artifact/fourier');
    // a different owner → curriculum row absent → null (uniform 404, no cross-owner read)
    expect(await getCurriculum('lesson-1', 'someone-else', fakePool().deps)).toBeNull();
    // the owned page is reachable owner-scoped; a foreign owner gets null
    const pageHit = fakePool([
      { match: 'JOIN concept_page', rows: [{ concept_slug: 'fourier', title: 'Fourier', status: 'built', html: '<h1>x</h1>' }] },
    ]);
    expect((await getOwnedPage('lesson-1', 'fourier', 'owner-1', pageHit.deps))?.html).toBe('<h1>x</h1>');
    expect(await getOwnedPage('lesson-1', 'fourier', 'someone-else', fakePool().deps)).toBeNull();
  });
});

// ── the graded sub-score write-path (TS-8) ───────────────────────────────────
// The graded v11 critic arm sets `artifact.scores`; persistRun writes them into the new
// concept_page.critic_scores JSONB column, inside the same BEGIN/COMMIT as the prune, BEFORE the
// DELETEs — so the score write rolls back with them. The live blob arm carries NO `scores`, so it
// (and any degraded soon/text row with no artifact) writes NULL.
const sub = (score: number): { score: number; note: string } => ({ score, note: 'n' });
const gradedScores: { learningEfficacy: LearningEfficacy; ledgerConformance: LedgerConformance } = {
  learningEfficacy: {
    misconceptionHook: sub(0.9),
    retrievalCheck: sub(0.8),
    findingsGrounded: sub(0.7),
    apparatusAddsBeyondProse: sub(0.9),
  },
  ledgerConformance: {
    namedGridPresent: sub(0.9),
    perSectionSubgrid: sub(0.9),
    collapseQueryPresent: sub(0.9),
    noRootLiteralOverride: sub(0.9),
    predictGateStructure: sub(0.9),
  },
};
const gradedArtifact: CritiquedArtifact = {
  nodeSlug: 'fourier',
  html: '<!doctype html><h1>Fourier</h1>',
  learningGoal: 'understand the transform',
  spec: { nodeSlug: 'fourier', interactionKind: 'canvas', a11yContract: 'a', citations: [] },
  passed: true,
  critique: 'graded',
  scores: gradedScores,
};
// A v11-arm result: the one page's artifact carries the graded sub-scores.
const gradedResult: PipelineResult = {
  hub: lessonResult.hub,
  pages: [gradedArtifact],
};
// The column-ordered param index of critic_scores in the concept_page INSERT
// (id, concept_slug, title, settings_bucket, content_hash, status, spec_json, html, critic_scores, …).
const CRITIC_SCORES_PARAM_IDX = 8;

describe('persistRun — graded critic sub-scores write-path (TS-8)', () => {
  it('writes critic_scores (the v11 sub-scores) into the concept_page INSERT for a graded-arm artifact', async () => {
    const { deps, client } = fakePool();
    await persistRun(
      { runId: 'graded-1', request, result: gradedResult, costUsd: 0.05, modelSnapshots: STAGE_MODELS, ownerSub: 'o' },
      deps,
    );
    const insert = sqlsOf(client.query).find((s) => s.includes('INTO concept_page'));
    expect(insert).toContain('critic_scores'); // the column is in the INSERT list
    const params = paramsOf(client.query, 'INTO concept_page');
    // the param is the JSON.stringify of the artifact's scores — the graded sub-scores round-trip
    expect(params?.[CRITIC_SCORES_PARAM_IDX]).toBe(JSON.stringify(gradedScores));
    expect(JSON.parse(params?.[CRITIC_SCORES_PARAM_IDX] as string)).toEqual(gradedScores);
  });

  it('writes NULL critic_scores for a blob-arm artifact (no scores) — the live default never persists scores', async () => {
    const { deps, client } = fakePool();
    // `lessonResult`'s artifact is the binary-arm shape: passed/critique only, no `scores`.
    await persistRun(
      { runId: 'blob-1', request, result: lessonResult, costUsd: 0.05, modelSnapshots: STAGE_MODELS },
      deps,
    );
    const params = paramsOf(client.query, 'INTO concept_page');
    expect(params?.[CRITIC_SCORES_PARAM_IDX]).toBeNull();
  });

  it('writes NULL critic_scores for a soon row (no artifact) — only built/graded rows carry scores', async () => {
    const { deps, client } = fakePool();
    // `result` (top-of-file) has a 'soon' page (cosine) with no matching artifact in `pages`.
    await persistRun({ runId: 'soon-1', request, result, costUsd: 0, modelSnapshots: STAGE_MODELS }, deps);
    // both concept_page INSERTs, with their params; concept_slug is the 2nd param ($2).
    const calls = (client.query.mock.calls as unknown as [string, unknown[]][]).filter(([sql]) =>
      sql.includes('INTO concept_page'),
    );
    const soonParams = calls.find(([, params]) => params[1] === 'cosine')?.[1];
    expect(soonParams?.[CRITIC_SCORES_PARAM_IDX]).toBeNull(); // no artifact → NULL scores
  });

  it('writes critic_scores BEFORE the prune DELETEs and inside BEGIN/COMMIT (shares the rollback)', async () => {
    const { deps, client } = fakePool();
    await persistRun(
      { runId: 'order-1', request, result: gradedResult, costUsd: 0, modelSnapshots: STAGE_MODELS },
      deps,
    );
    const sqls = sqlsOf(client.query);
    const scoreInsert = sqls.findIndex((s) => s.includes('INTO concept_page') && s.includes('critic_scores'));
    const firstDelete = Math.min(
      ...['step_result', 'run_owner', 'step_event'].map((t) => sqls.findIndex((s) => s.includes(`DELETE FROM ${t}`))),
    );
    const begin = sqls.indexOf('BEGIN');
    const commit = sqls.indexOf('COMMIT');
    expect(scoreInsert).toBeGreaterThan(begin); // inside the transaction
    expect(scoreInsert).toBeLessThan(firstDelete); // BEFORE the prune
    expect(firstDelete).toBeLessThan(commit); // the whole lot before COMMIT
  });

  it('a persist failure rolls the critic_scores write back with the prune (no orphaned graded row)', async () => {
    const { deps, client } = fakePool();
    // Fail after the concept_page INSERT (which carries critic_scores) but before COMMIT; the write
    // never commits, so no row — let alone its scores — survives the failed persist.
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('DELETE FROM step_event')) throw new Error('prune failed');
      return { rows: [] };
    });
    await expect(
      persistRun({ runId: 'rb-1', request, result: gradedResult, costUsd: 0, modelSnapshots: STAGE_MODELS }, deps),
    ).rejects.toThrow('prune failed');
    const sqls = sqlsOf(client.query);
    expect(sqls).toContain('ROLLBACK'); // the score write + the deletes all roll back together
    expect(sqls).not.toContain('COMMIT');
  });
});

describe('getCurriculum / getOwnedPage (fake pool, owner-scoped)', () => {
  it('returns null when the curriculum is absent or not owned (uniform)', async () => {
    expect(await getCurriculum('nope', 'owner-1', fakePool().deps)).toBeNull();
  });

  it('scopes the read by owner_sub (no cross-owner read)', async () => {
    const { deps, client } = fakePool();
    await getCurriculum('c1', 'owner-1', deps);
    expect(sqlsOf(client.query).some((s) => s.includes('owner_sub = $2'))).toBe(true);
  });

  it('assembles the owner-scoped view + curriculum-scoped hub hrefs', async () => {
    const { deps } = fakePool([
      { match: 'FROM curriculum WHERE', rows: [{ id: 'c1', topic: 'Fourier', settings_json: request.settings }] },
      {
        match: 'FROM curriculum_page',
        rows: [{ tier: 'T1', category: 'C', page_id: 'p1', concept_slug: 'sine', title: 'Sine', status: 'built' }],
      },
    ]);
    const view = await getCurriculum('c1', 'owner-1', deps);
    expect(view?.topic).toBe('Fourier');
    expect(view?.hub.tiers[0]?.categories[0]?.pages[0]?.href).toBe('/curriculum/c1/artifact/sine');
  });

  it('getOwnedPage returns the html via the owner-scoped JOIN, null when not owned', async () => {
    const hit = fakePool([
      {
        match: 'JOIN concept_page',
        rows: [{ concept_slug: 'sine', title: 'Sine', status: 'built', html: '<h1>x</h1>' }],
      },
    ]);
    expect((await getOwnedPage('c1', 'sine', 'owner-1', hit.deps))?.html).toBe('<h1>x</h1>');
    expect(sqlsOf(hit.client.query).some((s) => s.includes('c.owner_sub = $2'))).toBe(true);
    expect(await getOwnedPage('c1', 'sine', 'owner-1', fakePool().deps)).toBeNull();
  });

  it('recordRunOwner stamps + ownsRun checks run ownership (pre-persist window)', async () => {
    const { deps, client } = fakePool();
    await recordRunOwner('run-1', 'owner-1', deps);
    expect(sqlsOf(client.query).some((s) => s.includes('INTO run_owner'))).toBe(true);
    const owns = fakePool([{ match: 'FROM run_owner', rows: [{ ok: 1 }] }]);
    expect(await ownsRun('run-1', 'owner-1', owns.deps)).toBe(true);
    expect(await ownsRun('run-1', 'owner-9', fakePool().deps)).toBe(false);
  });
});

describe('getStepEvents (issue #61 — the live timeline read)', () => {
  it('maps rows to camelCase + ISO timestamps, oldest-first; null finished_at → still running', async () => {
    const { deps, client } = fakePool([
      {
        match: 'FROM step_event',
        rows: [
          {
            name: 'plan',
            step_key: 'k1',
            started_at: new Date('2026-06-21T00:00:00.000Z'),
            finished_at: new Date('2026-06-21T00:00:03.200Z'),
            status: 'done',
          },
          {
            name: 'code',
            step_key: 'k2',
            started_at: new Date('2026-06-21T00:00:03.200Z'),
            finished_at: null, // still in flight → a live timer client-side
            status: 'running',
          },
        ],
      },
    ]);
    const events = await getStepEvents('run-1', deps);
    expect(events).toEqual([
      { name: 'plan', stepKey: 'k1', startedAt: '2026-06-21T00:00:00.000Z', finishedAt: '2026-06-21T00:00:03.200Z', status: 'done' },
      { name: 'code', stepKey: 'k2', startedAt: '2026-06-21T00:00:03.200Z', finishedAt: null, status: 'running' },
    ]);
    // ordered by started_at — the read query carries the ORDER BY (the client renders in run order).
    expect(sqlsOf(client.query).some((s) => s.includes('ORDER BY started_at'))).toBe(true);
  });

  it('returns [] for a run with no recorded steps', async () => {
    expect(await getStepEvents('absent', fakePool().deps)).toEqual([]);
  });
});

// Real Postgres round-trip — runs only when DATABASE_URL points at a migrated DB
// (`docker compose up -d && npm run db:migrate`); skipped in CI / the bot's clone.
describe.skipIf(!process.env.DATABASE_URL)('repo (integration: real Postgres)', () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const deps: StoreDeps = { pool };
  afterAll(async () => {
    await pool.end();
  });

  it('round-trips an owned run → curriculum → built page; a different owner reads null', async () => {
    const runId = `itest-${randomUUID()}`;
    const ownerSub = `owner-${randomUUID()}`;
    await persistRun({ runId, request, result, costUsd: 0.2, modelSnapshots: STAGE_MODELS, ownerSub }, deps);
    const view = await getCurriculum(runId, ownerSub, deps);
    expect(view?.topic).toBe('Fourier');
    const built = view?.hub.tiers
      .flatMap((t) => t.categories.flatMap((c) => c.pages))
      .find((p) => p.built);
    expect(built).toBeTruthy();
    const page = await getOwnedPage(runId, built?.slug ?? '', ownerSub, deps);
    expect(page?.html).toContain('Sine');
    expect(await getCurriculum(runId, 'someone-else', deps)).toBeNull();
  });
});
