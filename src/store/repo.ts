import type { Pool } from 'pg';
import { contentHash, contentIdentityKey } from '../domain/identity';
import { bucketize, type Level, type Settings } from '../domain/settings';
import type { PageStatus, SitemapHub, SitemapPage } from '../domain/sitemap';
import {
  LESSON_BRIEF_SCHEMA_HASH,
  type PipelineResult,
  type Research,
  type TopicRequest,
} from '../domain/stages';
import type { Stage, StageModel } from '../llm/models';
import type { ResearchSink } from '../pipeline/ports';
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
    // Prune this run's transient per-run rows now that the curriculum has persisted. All FOUR are
    // useful only during the run and have NO post-persist consumer: step_result is the engine's
    // crash-resume memoization (only read mid-run, on retry); run_owner is the dispatch-time
    // ownership stamp for the pre-persist poll window (redundant once curriculum.owner_sub exists);
    // step_event is the live generating-UI timeline (read only while the run is in flight — the
    // finished lesson page shows the artifact, not the timeline, and step_event is intentionally NOT
    // kept for cross-run analysis: no such view exists); research_event is the live-research feed
    // (live-research generating Stage 1 — the planned questions + each question's grounded
    // findings/sources, also read ONLY by the in-flight generating UI; the finished lesson folds the
    // research into the durable brief→lesson, so the live rows have no post-persist consumer and are
    // likewise NOT kept for cross-run analysis). Deleting them here bounds these tables at exactly
    // their useful lifetime. The deletes run AFTER the inserts and inside the SAME transaction, so a
    // persist failure rolls them back too — leaving the run fully resumable. (A fire-and-forget sink
    // write that lands AFTER this prune is a harmless straggler — bounded, owner-scoped, never read
    // post-persist; the sink's 'done' UPDATE simply matches zero rows once they're gone.)
    await client.query('DELETE FROM step_result WHERE run_id = $1', [runId]);
    await client.query('DELETE FROM run_owner WHERE run_id = $1', [runId]);
    await client.query('DELETE FROM step_event WHERE run_id = $1', [runId]);
    await client.query('DELETE FROM research_event WHERE run_id = $1', [runId]);
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

/** The synthetic step name (and step_key) of the dispatch marker. NOT a pipeline stage — it's the
 *  leading "Starting…" indicator the generating view shows during the Job's cold-start window, before
 *  the first REAL step_event lands. The generating client maps this name to a user-facing label
 *  (`stage-rail.ts` DISPATCH_LABEL); the raw identifier is never rendered. (issue #162) */
export const DISPATCH_STEP_NAME = 'dispatch';

/** Write a dispatch marker into `step_event` so the generating view can show "Starting…" the instant a
 *  run is dispatched — closing the ~12–16s gap before the cold-starting Job writes its first real
 *  step_event. The marker is written with `finished_at = now()` and a NON-`running` status, so it is
 *  NEVER a live ticking timer (the view's LiveTimer fires only on `finishedAt === null && status ===
 *  'running'`) and it resolves the moment a real pipeline step appears. `getStepEvents` returns it first
 *  (ORDER BY started_at), so the status route needs no change. It is pruned at persist with the other
 *  transient `step_event` rows (the existing `DELETE FROM step_event` in `persistRun`).
 *
 *  BEST-EFFORT by contract: the SINGLE caller (`api/generate`) must treat any failure as non-fatal — a
 *  missing marker only costs the early indicator; the run still proceeds. Idempotent (ON CONFLICT). */
export async function recordDispatch(
  runId: string,
  deps: StoreDeps = { pool: getPool() },
): Promise<void> {
  await deps.pool.query(
    `INSERT INTO step_event (run_id, name, step_key, started_at, finished_at, status)
     VALUES ($1, $2, $2, now(), now(), 'dispatched')
     ON CONFLICT (run_id, name, step_key) DO NOTHING`,
    [runId, DISPATCH_STEP_NAME],
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

/** One grounded finding as the live-research feed surfaces it (live-research generating Stage 1):
 *  the claim plus its retrieved source resolved to user-facing {url, title} — NEVER the internal
 *  sourceIndex (the sink denormalizes it away before the write). COPY-SAFE: only learner-facing text. */
export interface ResearchFinding {
  claim: string;
  url: string;
  title: string;
}

/** One research question's live state as the status poll surfaces it (live-research generating Stage 1):
 *  the REAL question, its subtopic framing, and — once it resolves — the grounded findings + retrieved
 *  sources + counts. `status` is 'pending' (announced, no result yet) | 'done' (findings landed) |
 *  'error' (a best-effort skip). Timestamps are ISO strings (the client computes elapsed/duration);
 *  `finishedAt` null ⇔ still pending. The interface exposes ONLY copy-safe fields (question/subtopic/
 *  claim/url/title/counts) — no run-internal key, no sourceIndex. */
export interface ResearchEvent {
  question: string;
  subtopic: string | null;
  status: string;
  findings: ResearchFinding[];
  sources: { url: string; title: string }[];
  findingCount: number | null;
  startedAt: string;
  finishedAt: string | null;
}

/** Read a run's per-question live-research feed, oldest-first by `ordinal` (live-research generating
 *  Stage 1). NOT owner-scoped here — the caller (the status route) gates on `ownsRun` FIRST, then reads
 *  this; a non-owner never reaches it (the SAME contract as getStepEvents). The research_event rows
 *  live only while the run is in flight: `persistRun` PRUNES them (with step_event + step_result +
 *  run_owner) once the curriculum lands, so this read only ever serves the pre-persist poll window.
 *
 *  TOLERANT BY CONSTRUCTION (the listLessons precedent): `findings`/`sources` are JSONB that is NULL on
 *  a pending row and an object once resolved — pg returns JSONB already parsed, so this normalizes a
 *  NULL/absent value to `[]` and never re-parses, so a malformed/absent column can't crash the poll. */
export async function getResearchEvents(
  runId: string,
  deps: StoreDeps = { pool: getPool() },
): Promise<ResearchEvent[]> {
  const res = await deps.pool.query<{
    question: string;
    subtopic: string | null;
    status: string;
    findings: ResearchFinding[] | null;
    sources: { url: string; title: string }[] | null;
    finding_count: number | null;
    started_at: string | Date;
    finished_at: string | Date | null;
  }>(
    `SELECT question, subtopic, status, findings, sources, finding_count, started_at, finished_at
       FROM research_event WHERE run_id = $1 ORDER BY ordinal`,
    [runId],
  );
  return res.rows.map((r) => ({
    question: r.question,
    subtopic: r.subtopic ?? null,
    status: r.status,
    // JSONB passes through already-parsed from pg; NULL on a pending row → []. No Zod re-parse — a
    // malformed/absent value reads as [] rather than crashing the live poll (the listLessons precedent).
    findings: Array.isArray(r.findings) ? r.findings : [],
    sources: Array.isArray(r.sources) ? r.sources : [],
    findingCount: r.finding_count ?? null,
    // pg returns TIMESTAMPTZ as a Date; normalize to an ISO string for the JSON poll response.
    startedAt: new Date(r.started_at).toISOString(),
    finishedAt: r.finished_at === null ? null : new Date(r.finished_at).toISOString(),
  }));
}

/**
 * The Postgres-backed live-research sink (live-research generating Stage 1) — the durable adapter the
 * deployed Cloud Run **Job** injects into `runLesson` so the generating UI can show the REAL planned
 * questions then each question's grounded findings as they land. The local-dev fallback, the CLI, and
 * every test use `noopResearchSink` instead (no DB, no live rows) — exactly how `noopSink` keeps the
 * Next app off the eleatic adapter.
 *
 * FAIL-SAFE by construction, the SAME load-bearing-vs-observability pattern `GcpEngine`'s
 * `markStepStarted`/`markStepFinished` prove for `step_event`: research_event is KEPT observability
 * data, not load-bearing, so a write failure (the table not yet migrated during a deploy window, a
 * transient DB error) must NEVER abort the paid pipeline. EVERY method body is wrapped in try/catch +
 * `console.warn(...)` + a return, so it resolves rather than throws. The caller (run-pipeline) ALSO
 * fires these fire-and-forget (`void sink.on*().catch(...)`, never awaited on the critical path), so
 * even an uncaught rejection couldn't reach `runLesson` — the inner try/catch makes it doubly safe and
 * silent (the UI degrades to the stage-rail timeline).
 *
 * REAL DATA ONLY: `onResearch` denormalizes each `Finding.sourceIndex` against `research.sources` (the
 * SAME join the brief does) IN THE SINK, so a row holds `{claim, {url, title}}` — never a fabricated
 * claim, never a leaked internal index. An out-of-range index (already filtered by the researcher) is
 * skipped defensively.
 *
 * WRITE SHAPE: `onQuestions` INSERTs one 'pending' row per question (ON CONFLICT DO NOTHING — the
 * dedup already collapses duplicates; the PK makes a defensive re-announce a no-op). `onResearch`
 * UPDATEs that row to 'done' — the SAME insert-then-update shape as markStepStarted→markStepFinished.
 * Because 'done' is an UPDATE (not an upsert), a write that lands AFTER `persistRun` pruned the rows
 * matches ZERO rows — a straggler can't resurrect a pruned run's feed.
 */
export class PgResearchSink implements ResearchSink {
  constructor(
    private readonly runId: string,
    private readonly deps: { pool: Pool } = { pool: getPool() },
  ) {}

  /** Announce the deduped/capped questions as 'pending' rows, in fan-out order (ordinal = index). */
  async onQuestions(questions: string[]): Promise<void> {
    try {
      for (let i = 0; i < questions.length; i++) {
        await this.deps.pool.query(
          `INSERT INTO research_event (run_id, question, status, ordinal)
           VALUES ($1, $2, 'pending', $3)
           ON CONFLICT (run_id, question) DO NOTHING`,
          [this.runId, questions[i], i],
        );
      }
    } catch (err) {
      console.warn('[research] research_event write failed (ignored)', this.runId, err);
    }
  }

  /** A question's grounded research landed — UPDATE its row to 'done' with the denormalized
   *  findings/sources + count. UPDATE (not upsert), so a post-prune straggler matches zero rows. */
  async onResearch(question: string, research: Research): Promise<void> {
    try {
      // Denormalize each finding's sourceIndex → {claim, {url,title}} HERE, so the internal index
      // never reaches the DB or client (COPY-SAFE). The researcher already drops out-of-range indices;
      // skip any that slip through rather than store a half-resolved finding.
      const findings: ResearchFinding[] = research.findings.flatMap((f) => {
        const src = research.sources[f.sourceIndex];
        return src ? [{ claim: f.claim, url: src.url, title: src.title }] : [];
      });
      const sources = research.sources.map((s) => ({ url: s.url, title: s.title }));
      await this.deps.pool.query(
        `UPDATE research_event
            SET status = 'done', subtopic = $3, findings = $4, sources = $5,
                finding_count = $6, finished_at = now()
          WHERE run_id = $1 AND question = $2`,
        [
          this.runId,
          question,
          research.subtopic,
          JSON.stringify(findings),
          JSON.stringify(sources),
          findings.length,
        ],
      );
    } catch (err) {
      console.warn('[research] research_event write failed (ignored)', this.runId, err);
    }
  }
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
