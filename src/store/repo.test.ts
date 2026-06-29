import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  type PipelineResult,
  type TopicRequest,
} from '../domain/stages';
import { STAGE_MODELS } from '../llm/models';
import type { Research } from '../domain/stages';
import {
  DISPATCH_STEP_NAME,
  getCurriculum,
  getOwnedPage,
  getResearchEvents,
  getStepEvents,
  listLessons,
  ownsRun,
  persistRun,
  PgResearchSink,
  rebuildHub,
  recordDispatch,
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
    // the FOUR transient tables are each deleted, scoped to this run (research_event is the new 4th —
    // live-research generating Stage 1, pruned at persist like step_event).
    const dels = ['DELETE FROM step_result', 'DELETE FROM run_owner', 'DELETE FROM step_event', 'DELETE FROM research_event'];
    const delIdxs = dels.map((d) => sqls.findIndex((s) => s.includes(d)));
    for (const idx of delIdxs) expect(idx).toBeGreaterThan(-1);
    // each delete is run-scoped (WHERE run_id = $1) and carries this runId as its only param
    for (const del of dels) {
      expect(sqls.find((s) => s.includes(del))).toContain('WHERE run_id = $1');
      expect(paramsOf(client.query, del)).toEqual(['run-prune']);
    }
    // ORDER: the deletes come AFTER the last insert (so the writes are committed-to before pruning)…
    const lastInsert = Math.max(...sqls.map((s, i) => (s.includes('INSERT INTO') ? i : -1)));
    expect(Math.min(...delIdxs)).toBeGreaterThan(lastInsert);
    // …and all BEFORE the COMMIT, so they share the run's atomic transaction.
    const commit = sqls.indexOf('COMMIT');
    expect(Math.max(...delIdxs)).toBeLessThan(commit);
    // A5 (issue #162): the dispatch marker is a `step_event` row, so it is covered by this same
    // `DELETE FROM step_event` — no marker rows survive persist (no separate prune needed).
    expect(sqls.some((s) => s.includes('DELETE FROM step_event'))).toBe(true);
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

  it('writes the dense-card category + summary onto the curriculum INSERT (NULL when omitted)', async () => {
    // With both supplied, they ride the curriculum INSERT params; with neither, they persist as NULL so
    // an old/classifier-miss run reads back as no-eyebrow/no-description (never a fabricated value).
    const withMeta = fakePool();
    await persistRun(
      {
        runId: 'lesson-meta',
        request,
        result: lessonResult,
        costUsd: 0.05,
        modelSnapshots: STAGE_MODELS,
        ownerSub: 'owner-1',
        category: 'BIOLOGY',
        summary: 'How a plant turns sunlight into food.',
      },
      withMeta.deps,
    );
    const insertSql = sqlsOf(withMeta.client.query).find((s) => s.includes('INTO curriculum ('));
    expect(insertSql).toContain('category');
    expect(insertSql).toContain('summary');
    const params = paramsOf(withMeta.client.query, 'INTO curriculum (');
    expect(params).toContain('BIOLOGY');
    expect(params).toContain('How a plant turns sunlight into food.');

    // Omitted → both persist as NULL (the last two curriculum params).
    const noMeta = fakePool();
    await persistRun(
      { runId: 'lesson-nometa', request, result: lessonResult, costUsd: 0.05, modelSnapshots: STAGE_MODELS, ownerSub: 'owner-1' },
      noMeta.deps,
    );
    const noMetaParams = paramsOf(noMeta.client.query, 'INTO curriculum (') ?? [];
    expect(noMetaParams.slice(-2)).toEqual([null, null]); // [category, summary] both NULL
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

// ── recordDispatch — the "Starting…" dispatch marker (issue #162) ─────────────────────────────────
describe('recordDispatch (the dispatch marker)', () => {
  it('INSERTs a step_event named "dispatch" with a NON-running status (never a live timer)', async () => {
    const { deps, client } = fakePool();
    await recordDispatch('run-d', deps);
    const sql = sqlsOf(client.query).find((s) => s.includes('INSERT INTO step_event'));
    expect(sql, 'writes a step_event row').toBeDefined();
    // Idempotent (a re-dispatch is a no-op), so a retry can't duplicate-key the marker.
    expect(sql).toContain('ON CONFLICT (run_id, name, step_key) DO NOTHING');
    // NON-running status + a finished_at → the view's LiveTimer (finishedAt===null && status==='running')
    // can NEVER fire for the marker (A4: never a perpetual "dispatch" timer).
    expect(sql).toContain("'dispatched'");
    expect(sql).not.toContain("'running'");
    expect(sql).toContain('finished_at');
    // The marker's name is the shared DISPATCH_STEP_NAME constant the client maps to "Starting…".
    expect(paramsOf(client.query, 'INSERT INTO step_event')).toEqual(['run-d', DISPATCH_STEP_NAME]);
  });
});

// ── getResearchEvents — the live-research feed read (live-research generating Stage 1) ───────────
describe('getResearchEvents (the live-research feed read)', () => {
  it('maps rows to camelCase + ISO timestamps, ordered by ordinal; pending row → empty findings/sources', async () => {
    const { deps, client } = fakePool([
      {
        match: 'FROM research_event',
        rows: [
          {
            question: 'What is photosynthesis?',
            subtopic: 'Overview',
            status: 'done',
            // pg returns JSONB already parsed — copy-safe {claim, url, title}, no sourceIndex.
            findings: [{ claim: 'Plants convert light to energy', url: 'https://x.example', title: 'X' }],
            sources: [{ url: 'https://x.example', title: 'X' }],
            finding_count: 1,
            started_at: new Date('2026-06-21T00:00:00.000Z'),
            finished_at: new Date('2026-06-21T00:00:04.000Z'),
          },
          {
            question: 'How do chloroplasts work?',
            subtopic: null, // not yet framed (pending)
            status: 'pending',
            findings: null, // NULL while pending → normalized to []
            sources: null,
            finding_count: null,
            started_at: new Date('2026-06-21T00:00:00.500Z'),
            finished_at: null, // still pending → a live timer client-side
          },
        ],
      },
    ]);
    const events = await getResearchEvents('run-1', deps);
    expect(events).toEqual([
      {
        question: 'What is photosynthesis?',
        subtopic: 'Overview',
        status: 'done',
        findings: [{ claim: 'Plants convert light to energy', url: 'https://x.example', title: 'X' }],
        sources: [{ url: 'https://x.example', title: 'X' }],
        findingCount: 1,
        startedAt: '2026-06-21T00:00:00.000Z',
        finishedAt: '2026-06-21T00:00:04.000Z',
      },
      {
        question: 'How do chloroplasts work?',
        subtopic: null,
        status: 'pending',
        findings: [], // NULL JSONB → [] (the listLessons precedent: no crash on a NULL column)
        sources: [],
        findingCount: null,
        startedAt: '2026-06-21T00:00:00.500Z',
        finishedAt: null,
      },
    ]);
    // ordered by ordinal — the read query carries the ORDER BY (questions arrive concurrently, so
    // started_at alone is racy).
    expect(sqlsOf(client.query).some((s) => s.includes('ORDER BY ordinal'))).toBe(true);
  });

  it('COPY-SAFE: the SELECT projects only user-facing columns — never sourceIndex / step_key / run_id echo', async () => {
    const { deps, client } = fakePool([{ match: 'FROM research_event', rows: [] }]);
    await getResearchEvents('run-1', deps);
    const sql = sqlsOf(client.query).find((s) => s.includes('FROM research_event')) ?? '';
    // only the copy-safe columns are selected
    expect(sql).toContain('question');
    expect(sql).toContain('subtopic');
    expect(sql).toContain('findings');
    expect(sql).toContain('sources');
    // and NONE of the internal identifiers
    expect(sql).not.toContain('sourceIndex');
    expect(sql).not.toContain('source_index');
    expect(sql).not.toContain('step_key');
  });

  it('returns [] for a run with no research events (no existence oracle — same shape as a fresh run)', async () => {
    expect(await getResearchEvents('absent', fakePool().deps)).toEqual([]);
  });
});

// ── PgResearchSink — the FAIL-SAFE live-research writer (live-research generating Stage 1) ───────
describe('PgResearchSink (the live-research writer)', () => {
  const research: Research = {
    subtopic: 'Overview',
    sources: [
      { url: 'https://a.example', title: 'A' },
      { url: 'https://b.example', title: 'B' },
    ],
    findings: [
      { claim: 'claim about A', sourceIndex: 0 },
      { claim: 'claim about B', sourceIndex: 1 },
    ],
  };

  it('onQuestions INSERTs one pending row per question with its ordinal (ON CONFLICT DO NOTHING)', async () => {
    const { deps, client } = fakePool();
    await new PgResearchSink('run-1', deps).onQuestions(['q1', 'q2']);
    const calls = client.query.mock.calls as unknown[][];
    const inserts = calls.filter((c) => (c[0] as string).includes('INTO research_event'));
    expect(inserts).toHaveLength(2);
    expect(inserts[0]?.[0] as string).toContain("'pending'");
    expect(inserts[0]?.[0] as string).toContain('ON CONFLICT (run_id, question) DO NOTHING');
    // ordinals reflect fan-out order — each insert's params are [runId, question, ordinal]
    expect((inserts[0]?.[1] as unknown[])).toEqual(['run-1', 'q1', 0]);
    expect((inserts[1]?.[1] as unknown[])).toEqual(['run-1', 'q2', 1]);
  });

  it('onResearch DENORMALIZES sourceIndex → {claim,{url,title}} in the sink (no index ever stored)', async () => {
    const { deps, client } = fakePool();
    await new PgResearchSink('run-1', deps).onResearch('q1', research);
    const calls = client.query.mock.calls as unknown[][];
    const update = calls.find((c) => (c[0] as string).includes('UPDATE research_event'));
    expect(update).toBeTruthy();
    const params = update?.[1] as unknown[];
    // [runId, question, subtopic, findingsJson, sourcesJson, findingCount]
    const findingsJson = JSON.parse(params[3] as string);
    expect(findingsJson).toEqual([
      { claim: 'claim about A', url: 'https://a.example', title: 'A' },
      { claim: 'claim about B', url: 'https://b.example', title: 'B' },
    ]);
    // the internal sourceIndex never appears in the serialized JSON
    expect(params[3] as string).not.toContain('sourceIndex');
    expect(params[5]).toBe(2); // finding_count
    // it is an UPDATE (not an upsert), so a post-prune straggler matches zero rows
    expect(update?.[0]).toContain('UPDATE research_event');
    expect(update?.[0]).not.toContain('INSERT');
  });

  it('onResearch defensively SKIPS a finding whose sourceIndex is out of range (no half-resolved row)', async () => {
    const { deps, client } = fakePool();
    const bad: Research = { subtopic: 's', sources: [{ url: 'https://a.example', title: 'A' }], findings: [{ claim: 'orphan', sourceIndex: 5 }] };
    await new PgResearchSink('run-1', deps).onResearch('q1', bad);
    const calls = client.query.mock.calls as unknown[][];
    const update = calls.find((c) => (c[0] as string).includes('UPDATE research_event'));
    const params = update?.[1] as unknown[];
    expect(JSON.parse(params[3] as string)).toEqual([]); // the orphan finding is dropped
    expect(params[5]).toBe(0); // finding_count 0
  });

  it('FAIL-SAFE: onQuestions resolves (does NOT throw) when the pool write fails — logs + returns', async () => {
    const pool = { query: vi.fn(async () => { throw new Error('db down'); }) } as unknown as import('pg').Pool;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(new PgResearchSink('run-1', { pool }).onQuestions(['q1'])).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('FAIL-SAFE: onResearch resolves (does NOT throw) when the pool write fails — logs + returns', async () => {
    const pool = { query: vi.fn(async () => { throw new Error('db down'); }) } as unknown as import('pg').Pool;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(new PgResearchSink('run-1', { pool }).onResearch('q1', research)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
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
  // The card row shape the SQL `SELECT id, created_at, concept_slug, title, status, settings_json`
  // projects. settings_json is the request's saved Settings — its level + depth fill the card meta line.
  const cardRow = (over: Partial<Record<string, unknown>> = {}) => ({
    id: 'cur-1',
    created_at: new Date('2026-06-21T00:00:00.000Z'),
    concept_slug: 'fourier',
    title: 'Fourier',
    status: 'built',
    settings_json: { level: 'intro', depth: 2, audience: 'curious' },
    category: 'MATHEMATICS',
    summary: 'How the Fourier transform decomposes a signal into frequencies.',
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

  it('projects the meta fields (level + depth) from settings_json for the Figma 6:2 card meta line', async () => {
    // level + depth are REAL request Settings (the card meta line "beginner · d2 · 3h ago"), read from the
    // NOT-NULL settings_json JSONB. The SQL must SELECT settings_json (rode through DISTINCT ON on c.id).
    const fp = fakePool([
      {
        match: 'FROM curriculum c',
        rows: [cardRow({ settings_json: { level: 'advanced', depth: 4, audience: 'phd' } })],
      },
    ]);
    const [card] = await listLessons('owner-1', fp.deps);
    expect(card?.level).toBe('advanced');
    expect(card?.depth).toBe(4);
    const sql = sqlsOf(fp.client.query).find((s) => s.includes('FROM curriculum c'));
    expect(sql).toContain('settings_json');
  });

  it('projects the DENSE card fields (category eyebrow + summary description) from the curriculum row', async () => {
    // The Figma 6:2 dense card adds the subject eyebrow (category) + the one-line description (summary).
    // Both are REAL stored columns on `curriculum` — the SQL must SELECT them (they ride DISTINCT ON c.id).
    const fp = fakePool([{ match: 'FROM curriculum c', rows: [cardRow()] }]);
    const [card] = await listLessons('owner-1', fp.deps);
    expect(card?.category).toBe('MATHEMATICS');
    expect(card?.summary).toBe('How the Fourier transform decomposes a signal into frequencies.');
    const sql = sqlsOf(fp.client.query).find((s) => s.includes('FROM curriculum c'));
    expect(sql).toContain('category');
    expect(sql).toContain('summary');
  });

  it('NULL-row tolerant: an old/legacy row (NULL category + summary) yields a valid card, no crash', async () => {
    // Old rows predate the dense-card columns; a classifier-miss run also persists category NULL. The
    // card must read those back as null (the UI omits the eyebrow/description row) — never crash, never
    // a fabricated value. pg returns SQL NULL as JS null.
    const fp = fakePool([
      { match: 'FROM curriculum c', rows: [cardRow({ category: null, summary: null })] },
    ]);
    const [card] = await listLessons('owner-1', fp.deps);
    expect(card?.category).toBeNull();
    expect(card?.summary).toBeNull();
    // the rest of the card is still valid
    expect(card?.title).toBe('Fourier');
    expect(card?.status).toBe('built');
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
