import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { PipelineResult, TopicRequest } from '../domain/stages';
import { STAGE_MODELS } from '../llm/models';
import {
  getCurriculum,
  getOwnedPage,
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
