import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { PipelineResult, TopicRequest } from '../domain/stages';
import { STAGE_MODELS } from '../llm/models';
import { getCurriculum, getPage, persistRun, rebuildHub, type StoreDeps } from './repo';

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
      spec: { nodeSlug: 'sine', learningGoal: 'g', interactionKind: 'canvas', a11yContract: 'a', citations: [] },
      passed: true,
      critique: 'ok',
    },
  ],
};

describe('rebuildHub', () => {
  it('groups ordered rows into tiers → categories → pages with href + built', () => {
    const hub = rebuildHub([
      { tier: 'T1', category: 'C', page_id: 'p1', concept_slug: 'sine', title: 'Sine', status: 'built' },
      { tier: 'T1', category: 'C', page_id: 'p2', concept_slug: 'cosine', title: 'Cosine', status: 'soon' },
    ]);
    expect(hub.tiers).toHaveLength(1);
    expect(hub.tiers[0]?.categories[0]?.pages).toEqual([
      { slug: 'sine', title: 'Sine', status: 'built', built: true, href: '/artifact/p1' },
      { slug: 'cosine', title: 'Cosine', status: 'soon', built: false, href: '/artifact/p2' },
    ]);
  });

  it('URL-encodes the content-identity page_id in the href (a raw # would truncate the URL)', () => {
    const hub = rebuildHub([
      { tier: 'T', category: 'C', page_id: 'sine@intermediate:d3#a1b2c3', concept_slug: 'sine', title: 'Sine', status: 'built' },
    ]);
    expect(hub.tiers[0]?.categories[0]?.pages[0]?.href).toBe('/artifact/sine%40intermediate%3Ad3%23a1b2c3');
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

describe('getCurriculum / getPage (fake pool)', () => {
  it('returns null when the curriculum is absent', async () => {
    expect(await getCurriculum('nope', fakePool().deps)).toBeNull();
  });

  it('assembles the view + hub from the joined rows', async () => {
    const { deps } = fakePool([
      { match: 'FROM curriculum WHERE', rows: [{ id: 'c1', topic: 'Fourier', settings_json: request.settings }] },
      {
        match: 'FROM curriculum_page',
        rows: [{ tier: 'T1', category: 'C', page_id: 'p1', concept_slug: 'sine', title: 'Sine', status: 'built' }],
      },
    ]);
    const view = await getCurriculum('c1', deps);
    expect(view?.topic).toBe('Fourier');
    expect(view?.hub.tiers[0]?.categories[0]?.pages[0]?.href).toBe('/artifact/p1');
  });

  it('getPage returns the stored html, or null when absent', async () => {
    const hit = fakePool([
      {
        match: 'FROM concept_page',
        rows: [{ concept_slug: 'sine', title: 'Sine', status: 'built', html: '<h1>x</h1>' }],
      },
    ]);
    expect((await getPage('p1', hit.deps))?.html).toBe('<h1>x</h1>');
    expect(await getPage('p1', fakePool().deps)).toBeNull();
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

  it('round-trips a run → curriculum → built page', async () => {
    const runId = `itest-${randomUUID()}`;
    await persistRun({ runId, request, result, costUsd: 0.2, modelSnapshots: STAGE_MODELS }, deps);
    const view = await getCurriculum(runId, deps);
    expect(view?.topic).toBe('Fourier');
    const built = view?.hub.tiers
      .flatMap((t) => t.categories.flatMap((c) => c.pages))
      .find((p) => p.built);
    expect(built).toBeTruthy();
    const page = await getPage((built?.href ?? '').replace('/artifact/', ''), deps);
    expect(page?.html).toContain('Sine');
  });
});
