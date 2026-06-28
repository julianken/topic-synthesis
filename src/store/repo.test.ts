import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  type PipelineResult,
  type TopicRequest,
} from '../domain/stages';
import { STAGE_MODELS } from '../llm/models';
import {
  getCurriculum,
  getOwnedPage,
  getStepEvents,
  listLessons,
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

// ── listLessons — the owner-scoped library-card reader (TS-16) ────────────────
// One thin card row per owned lesson, newest-first. Mixed-arm tolerant (library Key decision §13,
// no backfill): it lists blob-arm rows (the live default), any historical sectioned-spec rows, AND
// degraded soon/text rows (spec_json NULL) IDENTICALLY — the card projects only NOT-NULL columns
// (title/status/concept_slug) and does NOT read into `spec_json` at all, so no per-arm spec shape can
// reach the card. (The render-backend `interactionKind` is no longer surfaced — it was an internal
// identifier leaking onto the card eyebrow, dropped per the copy-appropriateness gate.)
describe('listLessons (TS-16 — owner-scoped, mixed-arm tolerant)', () => {
  // The card row shape the SQL `SELECT id, created_at, concept_slug, title, status` projects.
  const cardRow = (over: Partial<Record<string, unknown>> = {}) => ({
    id: 'cur-1',
    created_at: new Date('2026-06-21T00:00:00.000Z'),
    concept_slug: 'fourier',
    title: 'Fourier',
    status: 'built',
    ...over,
  });

  it('is owner-scoped: filters owner_sub = $1 and a foreign/unknown owner gets [] (no existence oracle)', async () => {
    // The owner with rows reads them back…
    const owned = fakePool([{ match: 'WHERE c.owner_sub = $1', rows: [cardRow()] }]);
    const cards = await listLessons('owner-1', owned.deps);
    expect(cards).toHaveLength(1);
    expect(sqlsOf(owned.client.query).some((s) => s.includes('c.owner_sub = $1'))).toBe(true);
    // the scope param IS the ownerSub
    expect(paramsOf(owned.client.query, 'c.owner_sub = $1')).toEqual(['owner-1']);
    // …a foreign/unknown owner matches no rows → [] (same empty result as having zero lessons)
    expect(await listLessons('someone-else', fakePool().deps)).toEqual([]);
  });

  it('does NOT surface the render-backend kind and never reads spec_json: the SQL projects no interactionKind', async () => {
    // The render-backend enum is an internal identifier (copy-appropriateness gate) — the card neither
    // carries it nor extracts it, so the query must not touch `spec_json`/`interactionKind` at all.
    const blob = fakePool([{ match: 'FROM curriculum c', rows: [cardRow()] }]);
    const [card] = await listLessons('owner-1', blob.deps);
    expect(card).not.toHaveProperty('interactionKind');
    expect(card?.id).toBe('cur-1');
    expect(card?.slug).toBe('fourier');
    expect(card?.title).toBe('Fourier');
    expect(card?.status).toBe('built');
    // the projection is spec-shape-free — no JSONB extraction can crash the library home
    for (const s of sqlsOf(blob.client.query)) {
      expect(s).not.toContain('spec_json');
      expect(s).not.toContain('interactionKind');
    }
  });

  it('historical sectioned row yields a valid card (spec shape is irrelevant — the card never reads it)', async () => {
    // A row persisted before the v11 revert (a sectioned `spec_json`) reads back identically: the card
    // projects only NOT-NULL columns, so the per-arm spec shape never reaches it.
    const sectioned = fakePool([
      { match: 'FROM curriculum c', rows: [cardRow({ title: 'Diffusion', status: 'built' })] },
    ]);
    const [card] = await listLessons('owner-1', sectioned.deps);
    expect(card?.title).toBe('Diffusion');
    expect(card?.status).toBe('built');
  });

  it('degraded row: a soon/text synthesis failure (NULL spec_json) still yields a valid card, no crash', async () => {
    // spec_json itself is NULL (no artifact persisted); because the card never reads spec_json it renders
    // regardless — the degraded status is carried by the NOT-NULL `status` column.
    const degraded = fakePool([
      { match: 'FROM curriculum c', rows: [cardRow({ status: 'soon', title: 'Half-built' })] },
    ]);
    const [card] = await listLessons('owner-1', degraded.deps);
    expect(card?.status).toBe('soon');
    expect(card?.title).toBe('Half-built');
  });

  it('orders newest-first: createdAt descending, and the SQL carries ORDER BY created_at DESC', async () => {
    // Two owned lessons; pg returns them already DESC-ordered (the query carries ORDER BY). Assert the
    // reader preserves that order AND normalizes created_at (Date | string) to an ISO string.
    const two = fakePool([
      {
        match: 'FROM curriculum c',
        rows: [
          cardRow({ id: 'newer', created_at: new Date('2026-06-21T12:00:00.000Z') }),
          cardRow({ id: 'older', created_at: '2026-06-20T09:00:00.000Z' }), // pg can also return a string
        ],
      },
    ]);
    const cards = await listLessons('owner-1', two.deps);
    expect(cards.map((c) => c.id)).toEqual(['newer', 'older']);
    expect(cards[0]?.createdAt).toBe('2026-06-21T12:00:00.000Z'); // Date → ISO
    expect(cards[1]?.createdAt).toBe('2026-06-20T09:00:00.000Z'); // string → ISO
    expect(sqlsOf(two.client.query).some((s) => s.includes('ORDER BY created_at DESC'))).toBe(true);
  });

  it('dedups to ONE card per curriculum in the QUERY: a multi-page curriculum (RETAINED runPipeline) can never emit N duplicate cards', async () => {
    // The reader joins curriculum → curriculum_page → concept_page, which yields one row PER PAGE — a
    // multi-page curriculum would emit N cards sharing one /curriculum/[id] href. The fix is structural:
    // an inner DISTINCT ON (c.id) collapses each curriculum to its lowest-ordinal representative page.
    // Assert the SQL carries that dedup (the fake pool can't execute it; the guarantee lives in the query).
    const fp = fakePool([{ match: 'FROM curriculum c', rows: [cardRow()] }]);
    await listLessons('owner-1', fp.deps);
    const sql = sqlsOf(fp.client.query).find((s) => s.includes('FROM curriculum c'));
    expect(sql).toContain('DISTINCT ON (c.id)'); // one representative row per curriculum
    expect(sql).toContain('ORDER BY c.id, cp.ordinal'); // representative = lowest ordinal (DISTINCT ON requires c.id first)
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
