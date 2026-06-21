import type { Pool } from 'pg';
import { contentHash, contentIdentityKey } from '../domain/identity';
import { bucketize, type Settings } from '../domain/settings';
import type { PageStatus, SitemapHub, SitemapPage } from '../domain/sitemap';
import type { PipelineResult, TopicRequest } from '../domain/stages';
import type { Stage, StageModel } from '../llm/models';
import { getPool } from './db';

/** Injectable pg pool so the repo unit-tests against a fake (no live DB needed). */
export interface StoreDeps {
  pool: Pool;
}

export interface PersistRunInput {
  /** The run id; also the curriculum id (one run = one curriculum in v1). */
  runId: string;
  request: TopicRequest;
  result: PipelineResult;
  costUsd: number;
  /** The per-stage models this run used — the workflow_version's pinned snapshot. */
  modelSnapshots: Record<Stage, StageModel>;
  eleaticRunId?: string;
  /** The owning user's verified Google `sub` (ADR 0002 §2) — omitted for unauthenticated/legacy runs. */
  ownerSub?: string;
}

interface FlatPage {
  tier: string;
  category: string;
  ordinal: number;
  page: SitemapPage;
}

/** Walk the tiered hub into a flat, ordered list carrying each page's tier/category/ordinal. */
function flattenHub(hub: SitemapHub): FlatPage[] {
  const flat: FlatPage[] = [];
  let ordinal = 0;
  for (const tier of hub.tiers) {
    for (const category of tier.categories) {
      for (const page of category.pages) {
        flat.push({ tier: tier.tier, category: category.name, ordinal: ordinal++, page });
      }
    }
  }
  return flat;
}

/**
 * Persist a completed run atomically: workflow_version + run + concept_pages (keyed by
 * content identity) + curriculum + the curriculum<->page join, all in one transaction. A
 * reader therefore sees either no curriculum or the whole curriculum — the basis for the
 * app's "poll until the curriculum exists" progress, with no run-status column in v1.
 */
export async function persistRun(
  input: PersistRunInput,
  deps: StoreDeps = { pool: getPool() },
): Promise<{ curriculumId: string }> {
  const { runId, request, result, costUsd, modelSnapshots, eleaticRunId, ownerSub } = input;
  const bucket = bucketize(request.settings);
  const snapshotsJson = JSON.stringify(modelSnapshots);
  const workflowVer = contentHash(snapshotsJson);
  const pages = flattenHub(result.hub);
  const artifactBySlug = new Map(result.pages.map((a) => [a.nodeSlug, a]));

  const client = await deps.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO workflow_version (id, model_snapshots, prompt_hash)
       VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
      [workflowVer, snapshotsJson, 'v1'],
    );
    await client.query(
      `INSERT INTO run (id, workflow_ver, page_count, cost_usd, eleatic_run_id)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
      [runId, workflowVer, pages.length, costUsd, eleaticRunId ?? null],
    );
    await client.query(
      `INSERT INTO curriculum (id, topic, settings_json, workflow_ver, run_id, owner_sub)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
      [runId, request.topic, JSON.stringify(request.settings), workflowVer, runId, ownerSub ?? null],
    );
    for (const { tier, category, ordinal, page } of pages) {
      const artifact = artifactBySlug.get(page.slug);
      // content_hash distinguishes byte-different content for the same concept@bucket; the
      // id IS the content-identity key, so a re-persist of identical content is a no-op.
      const hash = contentHash(page.slug, page.status, artifact?.html ?? '');
      const pageId = contentIdentityKey({
        conceptSlug: page.slug,
        settingsBucket: bucket,
        contentHash: hash,
      });
      await client.query(
        `INSERT INTO concept_page
           (id, concept_slug, title, settings_bucket, content_hash, status, spec_json, html, workflow_ver)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO NOTHING`,
        [
          pageId,
          page.slug,
          page.title,
          bucket,
          hash,
          page.status,
          artifact ? JSON.stringify(artifact.spec) : null,
          artifact?.html ?? null,
          workflowVer,
        ],
      );
      await client.query(
        `INSERT INTO curriculum_page (curriculum_id, page_id, tier, category, ordinal)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (curriculum_id, page_id) DO NOTHING`,
        [runId, pageId, tier, category, ordinal],
      );
    }
    await client.query('COMMIT');
    client.release();
    return { curriculumId: runId };
  } catch (err) {
    // Guard the rollback so its own failure can't mask the original error, and release WITH
    // the error so a poisoned connection is destroyed rather than handed back to the pool.
    try {
      await client.query('ROLLBACK');
    } catch {
      /* keep the original error */
    }
    client.release(err instanceof Error ? err : new Error(String(err)));
    throw err;
  }
}

export interface CurriculumView {
  id: string;
  topic: string;
  settings: Settings;
  hub: SitemapHub;
}

interface PageJoinRow {
  tier: string;
  category: string;
  page_id: string;
  concept_slug: string;
  title: string;
  status: PageStatus;
}

/** Rebuild the tiered hub from ordered join rows (the inverse of flattenHub). Pure. */
export function rebuildHub(rows: PageJoinRow[]): SitemapHub {
  const tiers: SitemapHub['tiers'] = [];
  for (const row of rows) {
    let tier = tiers.find((t) => t.tier === row.tier);
    if (!tier) {
      tier = { tier: row.tier, categories: [] };
      tiers.push(tier);
    }
    let category = tier.categories.find((c) => c.name === row.category);
    if (!category) {
      category = { name: row.category, pages: [] };
      tier.categories.push(category);
    }
    category.pages.push({
      slug: row.concept_slug,
      title: row.title,
      status: row.status,
      built: row.status === 'built',
      // encodeURIComponent: the page_id is a content-identity key containing '#'/'@'/':' which
      // would otherwise truncate the URL at the fragment. Route params are decoded by Next.
      href: `/artifact/${encodeURIComponent(row.page_id)}`,
    });
  }
  return { tiers };
}

/** Read a curriculum + its tiered hub for the app's hub page; null if not found. */
export async function getCurriculum(
  id: string,
  deps: StoreDeps = { pool: getPool() },
): Promise<CurriculumView | null> {
  const cur = await deps.pool.query<{ id: string; topic: string; settings_json: Settings }>(
    `SELECT id, topic, settings_json FROM curriculum WHERE id = $1`,
    [id],
  );
  const row = cur.rows[0];
  if (!row) return null;
  const pages = await deps.pool.query<PageJoinRow>(
    `SELECT cp.tier, cp.category, cp.page_id, p.concept_slug, p.title, p.status
       FROM curriculum_page cp
       JOIN concept_page p ON p.id = cp.page_id
      WHERE cp.curriculum_id = $1
      ORDER BY cp.ordinal`,
    [id],
  );
  return { id: row.id, topic: row.topic, settings: row.settings_json, hub: rebuildHub(pages.rows) };
}

export interface StoredPage {
  slug: string;
  title: string;
  status: PageStatus;
  html: string | null;
}

/** Read a single page's stored HTML (for the sandboxed artifact route); null if not found. */
export async function getPage(
  pageId: string,
  deps: StoreDeps = { pool: getPool() },
): Promise<StoredPage | null> {
  const res = await deps.pool.query<{
    concept_slug: string;
    title: string;
    status: PageStatus;
    html: string | null;
  }>(`SELECT concept_slug, title, status, html FROM concept_page WHERE id = $1`, [pageId]);
  const row = res.rows[0];
  if (!row) return null;
  return { slug: row.concept_slug, title: row.title, status: row.status, html: row.html };
}
