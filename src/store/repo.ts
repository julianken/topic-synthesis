import type { Pool } from 'pg';
import { contentHash, contentIdentityKey } from '../domain/identity';
import { bucketize, type Level, type Settings } from '../domain/settings';
import type { PageStatus, SitemapHub, SitemapPage } from '../domain/sitemap';
import { LESSON_BRIEF_SCHEMA_HASH, type PipelineResult, type TopicRequest } from '../domain/stages';
import type { Stage, StageModel } from '../llm/models';
import { PROMPTS_VERSION } from '../pipeline/prompts';
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
  /** The library poster-card subject eyebrow (BIOLOGY / MATHEMATICS / …) from the isolated, fail-safe
   *  classifier — null/omitted when none could be derived (the card then omits the eyebrow). NOT a
   *  pipeline stage; presentation metadata only. */
  category?: string | null;
  /** The library poster-card description (the lesson's learner-facing one-liner = the brief's
   *  learningGoal — pure data plumbing, no extra generation). Omitted on degraded runs with no brief. */
  summary?: string | null;
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
  const { runId, request, result, costUsd, modelSnapshots, eleaticRunId, ownerSub, category, summary } =
    input;
  const bucket = bucketize(request.settings);
  const snapshotsJson = JSON.stringify(modelSnapshots);
  // The workflow_version IS the eval arm (schema.sql: "A workflow VERSION = an eval arm"; its id is
  // "a content hash of the pipeline shape: DAG + prompts + … model snapshots"). Fold in BOTH the
  // contract shape (LessonBrief schema hash, the single source of truth — derived, not restated) and
  // a real prompt hash, so a LessonBrief schema change OR a prompt change yields a distinct version
  // even when the model snapshots are unchanged. Previously this hashed snapshots only — conflating
  // two distinct arms — and inserted the literal 'v1' as prompt_hash (a lie the column now tells true).
  const promptHash = contentHash(PROMPTS_VERSION, LESSON_BRIEF_SCHEMA_HASH);
  const workflowVer = contentHash(snapshotsJson, promptHash);
  const pages = flattenHub(result.hub);
  const artifactBySlug = new Map(result.pages.map((a) => [a.nodeSlug, a]));

  const client = await deps.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO workflow_version (id, model_snapshots, prompt_hash)
       VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
      [workflowVer, snapshotsJson, promptHash],
    );
    await client.query(
      `INSERT INTO run (id, workflow_ver, page_count, cost_usd, eleatic_run_id)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
      [runId, workflowVer, pages.length, costUsd, eleaticRunId ?? null],
    );
    await client.query(
      `INSERT INTO curriculum (id, topic, settings_json, workflow_ver, run_id, owner_sub, category, summary)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
      [
        runId,
        request.topic,
        JSON.stringify(request.settings),
        workflowVer,
        runId,
        ownerSub ?? null,
        // Presentation metadata for the Figma 6:2 dense card — NULL when the classifier derived none
        // (eyebrow omitted) or the run degraded before a brief (description omitted). Never fabricated.
        category ?? null,
        summary ?? null,
      ],
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
    // Prune this run's transient per-run rows now that the curriculum has persisted. All three are
    // useful only during the run and have NO post-persist consumer: step_result is the engine's
    // crash-resume memoization (only read mid-run, on retry); run_owner is the dispatch-time
    // ownership stamp for the pre-persist poll window (redundant once curriculum.owner_sub exists);
    // step_event is the live generating-UI timeline (read only while the run is in flight — the
    // finished lesson page shows the artifact, not the timeline, and step_event is intentionally NOT
    // kept for cross-run analysis: no such view exists). Deleting them here bounds these tables at
    // exactly their useful lifetime. The deletes run AFTER the inserts and inside the SAME
    // transaction, so a persist failure rolls them back too — leaving the run fully resumable.
    await client.query('DELETE FROM step_result WHERE run_id = $1', [runId]);
    await client.query('DELETE FROM run_owner WHERE run_id = $1', [runId]);
    await client.query('DELETE FROM step_event WHERE run_id = $1', [runId]);
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
export function rebuildHub(rows: PageJoinRow[], curriculumId: string): SitemapHub {
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
      // Authorize the artifact THROUGH the owning curriculum (the cookie-borne, owner-checked route),
      // NOT a per-pageId capability — pageId is a content hash SHARED across curricula (identity.ts), so
      // it is no secret. Keyed by the URL-safe slug; the route re-resolves it owner-scoped.
      href: `/curriculum/${encodeURIComponent(curriculumId)}/artifact/${encodeURIComponent(row.concept_slug)}`,
    });
  }
  return { tiers };
}

/** Read a curriculum + its tiered hub, OWNER-SCOPED: absent and not-owned both yield null (a uniform
 *  404 upstream — no 403/404 existence oracle). ADR 0002 §5. */
export async function getCurriculum(
  id: string,
  ownerSub: string,
  deps: StoreDeps = { pool: getPool() },
): Promise<CurriculumView | null> {
  const cur = await deps.pool.query<{ id: string; topic: string; settings_json: Settings }>(
    `SELECT id, topic, settings_json FROM curriculum WHERE id = $1 AND owner_sub = $2`,
    [id, ownerSub],
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
  return { id: row.id, topic: row.topic, settings: row.settings_json, hub: rebuildHub(pages.rows, id) };
}

export interface StoredPage {
  slug: string;
  title: string;
  status: PageStatus;
  html: string | null;
}

/** Read a page's stored HTML, authorized THROUGH the owning curriculum (ADR 0002 §5): a JOIN scoped to
 *  (curriculumId owned by ownerSub, slug). null for absent / not-owned (uniform 404). The slug — not
 *  the shared content-hash pageId — is the lookup key, so a per-pageId capability is never the gate. */
export async function getOwnedPage(
  curriculumId: string,
  slug: string,
  ownerSub: string,
  deps: StoreDeps = { pool: getPool() },
): Promise<StoredPage | null> {
  const res = await deps.pool.query<{
    concept_slug: string;
    title: string;
    status: PageStatus;
    html: string | null;
  }>(
    `SELECT p.concept_slug, p.title, p.status, p.html
       FROM curriculum c
       JOIN curriculum_page cp ON cp.curriculum_id = c.id
       JOIN concept_page p ON p.id = cp.page_id
      WHERE c.id = $1 AND c.owner_sub = $2 AND p.concept_slug = $3`,
    [curriculumId, ownerSub, slug],
  );
  const row = res.rows[0];
  if (!row) return null;
  return { slug: row.concept_slug, title: row.title, status: row.status, html: row.html };
}

/** Stamp run ownership at dispatch — before the curriculum persists — so the pre-persist poll window
 *  can be owner-scoped without a DB existence oracle. Idempotent. */
export async function recordRunOwner(
  runId: string,
  ownerSub: string,
  deps: StoreDeps = { pool: getPool() },
): Promise<void> {
  await deps.pool.query(
    `INSERT INTO run_owner (run_id, owner_sub) VALUES ($1, $2) ON CONFLICT (run_id) DO NOTHING`,
    [runId, ownerSub],
  );
}

/** Does this caller own this runId? Lets the hub show "generating" for the caller's own not-yet-
 *  persisted run while returning a uniform 404 for a foreign/absent id. */
export async function ownsRun(
  runId: string,
  ownerSub: string,
  deps: StoreDeps = { pool: getPool() },
): Promise<boolean> {
  const res = await deps.pool.query(`SELECT 1 FROM run_owner WHERE run_id = $1 AND owner_sub = $2`, [
    runId,
    ownerSub,
  ]);
  return res.rows.length > 0;
}

/** One step's timing as the status poll surfaces it (issue #61): timestamps are ISO strings (the
 *  client computes elapsed/duration from them); `finishedAt` null ⇔ still running. */
export interface StepEvent {
  name: string;
  stepKey: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
}

/** Read a run's per-step timeline, oldest-first (issue #61). NOT owner-scoped here — the caller
 *  (the status route) gates on `ownsRun` first, then reads this; a non-owner never reaches it. The
 *  step_event rows live only while the run is in flight: `persistRun` PRUNES them (with step_result +
 *  run_owner) once the curriculum lands, so this read only ever serves the pre-persist poll window. */
export async function getStepEvents(
  runId: string,
  deps: StoreDeps = { pool: getPool() },
): Promise<StepEvent[]> {
  const res = await deps.pool.query<{
    name: string;
    step_key: string;
    started_at: string | Date;
    finished_at: string | Date | null;
    status: string;
  }>(
    `SELECT name, step_key, started_at, finished_at, status
       FROM step_event WHERE run_id = $1 ORDER BY started_at`,
    [runId],
  );
  return res.rows.map((r) => ({
    name: r.name,
    stepKey: r.step_key,
    // pg returns TIMESTAMPTZ as a Date; normalize to an ISO string for the JSON poll response.
    startedAt: new Date(r.started_at).toISOString(),
    finishedAt: r.finished_at === null ? null : new Date(r.finished_at).toISOString(),
    status: r.status,
  }));
}

/** One poster-card descriptor the library home (TS-17) renders a card grid from (TS-16). Thin by
 *  design — only the card fields, NOT the full tiered hub `getCurriculum` reads. `id` is the
 *  curriculum id (the card's `/curriculum/[id]` href target).
 *
 *  Maps to the DENSE Figma `6:2` poster card. The `category` eyebrow (node `6:41`) + the `summary`
 *  description (node `6:47`) are the two new dense rows: `category` is the subject label (BIOLOGY /
 *  MATHEMATICS / …) the isolated fail-safe classifier derived (NULL → eyebrow omitted), `summary` is
 *  the lesson's learner-facing one-liner (the brief's learningGoal — NULL → description omitted). The
 *  footer-meta line ("beginner · d2 · 3h ago") is `level` + `depth` from `curriculum.settings_json`
 *  (REAL saved Settings) + the relative-time from `createdAt`. Every field is REAL stored data — a NULL
 *  category/summary (an old row or a classifier miss) just drops that row, never a fabricated value. */
export interface LessonCard {
  /** The curriculum id — the card's href target, `/curriculum/[id]`. */
  id: string;
  /** The single lesson page's `concept_slug`. */
  slug: string;
  /** The lesson title (the `concept_page.title` NOT NULL column, NOT JSONB). */
  title: string;
  status: PageStatus;
  /** The request's level (`intro`/`intermediate`/`advanced`), from `curriculum.settings_json`. */
  level: Level;
  /** The request's depth (1..5), from `curriculum.settings_json`. */
  depth: number;
  /** ISO string from `curriculum.created_at`, for newest-first ordering. */
  createdAt: string;
  /** The dense card's subject eyebrow (Figma `6:41`) — the classifier's subject label, or null for an
   *  old row / a classifier miss (the card then omits the eyebrow; show nothing > guess/leak). */
  category: string | null;
  /** The dense card's one-line description (Figma `6:47`) — the lesson's learningGoal, or null for an
   *  old row / a degraded run with no brief (the card then omits the description row). */
  summary: string | null;
}

/** List one poster-card descriptor per lesson the caller owns, newest-first — the reader the library
 *  home (TS-17) builds its card grid on. OWNER-SCOPED (ADR 0002 §5): scoped on `curriculum.owner_sub`,
 *  so a caller with no owned lessons AND an unknown/foreign `ownerSub` both get `[]` — no existence
 *  oracle. ONE owner-scoped query joining `curriculum` → a single representative `concept_page`,
 *  projecting only the card fields — NOT a per-lesson `getCurriculum` loop (which would be N+1 and
 *  over-fetch the tiered hub).
 *
 *  ONE CARD PER CURRICULUM — enforced by the QUERY, not by a single-page coincidence. Today every
 *  persisted curriculum is single-page (ADR-0003: every entrypoint drives `runLesson`), but `persistRun`
 *  is general (one `curriculum_page` per page in `flattenHub`) and the multi-page curriculum path
 *  (`runPipeline`) is RETAINED for the curriculum-wrapper milestone. A naïve `curriculum JOIN
 *  curriculum_page JOIN concept_page` yields one row PER PAGE, so a multi-page curriculum would emit N
 *  duplicate cards sharing one `/curriculum/[id]` href. The inner `DISTINCT ON (c.id) ... ORDER BY c.id,
 *  cp.ordinal` collapses each curriculum to its lowest-ordinal page (the representative card), and the
 *  outer query re-orders newest-first — so the one-card-per-curriculum contract holds even once the
 *  wrapper milestone lands a multi-page curriculum in the DB.
 *
 *  MIXED-ARM TOLERANT (library Key decision §13 — "old lessons stay old," no backfill): the card row
 *  projects only columns that exist on every row regardless of which synthesis arm wrote it — `title`
 *  and `status` are NOT-NULL columns and `concept_slug` is the page key, so a blob row, a historical
 *  sectioned-spec row, and a degraded soon/text row (NULL `spec_json`) all yield a valid card. No
 *  `spec_json` JSONB extraction is done — the card never reads into the per-arm spec shape, so a
 *  malformed/absent spec can never crash the library home. */
export async function listLessons(
  ownerSub: string,
  deps: StoreDeps = { pool: getPool() },
): Promise<LessonCard[]> {
  const res = await deps.pool.query<{
    id: string;
    created_at: string | Date;
    concept_slug: string;
    title: string;
    status: PageStatus;
    settings_json: Settings;
    category: string | null;
    summary: string | null;
  }>(
    // ONE card per curriculum, newest-first. The inner DISTINCT ON (c.id) ... ORDER BY c.id, cp.ordinal
    // collapses each curriculum to its lowest-ordinal (representative) page — so a multi-page curriculum
    // (the RETAINED runPipeline path) emits ONE card, not N duplicates sharing one /curriculum/[id] href
    // (today every curriculum is single-page per ADR-0003, but the query enforces it regardless). The
    // outer query re-orders the representatives newest-first (DISTINCT ON forces ORDER BY c.id first).
    // settings_json is the request's saved Settings (NOT-NULL JSONB column) — its level + depth fill the
    // Figma card meta line. category + summary are the DENSE card's eyebrow + description (NULLABLE; NULL
    // for an old row / a classifier miss → the card omits that row). All three ride through DISTINCT ON
    // on c.id (one per curriculum), so they can't fan a curriculum into duplicate cards.
    `SELECT id, created_at, concept_slug, title, status, settings_json, category, summary
       FROM (
         SELECT DISTINCT ON (c.id)
                c.id, c.created_at, c.settings_json, c.category, c.summary, p.concept_slug, p.title, p.status
           FROM curriculum c
           JOIN curriculum_page cp ON cp.curriculum_id = c.id
           JOIN concept_page p ON p.id = cp.page_id
          WHERE c.owner_sub = $1
          ORDER BY c.id, cp.ordinal
       ) cards
      ORDER BY created_at DESC`,
    [ownerSub],
  );
  return res.rows.map((r) => ({
    id: r.id,
    slug: r.concept_slug,
    title: r.title,
    status: r.status,
    level: r.settings_json.level,
    depth: r.settings_json.depth,
    // pg returns TIMESTAMPTZ as a Date; normalize to an ISO string (same as getStepEvents).
    createdAt: new Date(r.created_at).toISOString(),
    // Dense-card rows — NULLABLE; an old row or a classifier miss reads back null (the card omits that
    // row gracefully). `?? null` normalizes a missing column on a legacy fake/result to null.
    category: r.category ?? null,
    summary: r.summary ?? null,
  }));
}
