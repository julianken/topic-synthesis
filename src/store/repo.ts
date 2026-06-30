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
import type { CodeProgressSink, ResearchSink } from '../pipeline/ports';
import { PROMPTS_VERSION } from '../pipeline/prompts';
import { getPool } from './db';

/** Injectable pg pool so the repo unit-tests against a fake (no live DB needed). */
export interface StoreDeps {
  pool: Pool;
}

export interface PersistRunInput {
  /** The run id; also the persisted `curriculum`-table row id (one run = one row in v1). */
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
): Promise<{ lessonId: string }> {
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
    // Prune this run's transient per-run rows now that the curriculum has persisted. FOUR of the FIVE
    // per-run tables have NO post-persist consumer: step_result is the engine's crash-resume
    // memoization (only read mid-run, on retry); run_owner is the dispatch-time ownership stamp for the
    // pre-persist poll window (redundant once curriculum.owner_sub exists); research_event is the
    // live-research feed (live-research generating Stage 1 — the planned questions + each question's
    // grounded findings/sources, read ONLY by the in-flight generating UI; the finished lesson folds the
    // research into the durable brief→lesson, so the live rows have no post-persist consumer and are NOT
    // kept for cross-run analysis); code_progress is the live code-phase bar's one row (PR-4 / #180), read
    // only by the in-flight generating UI, likewise no post-persist consumer. Deleting these bounds them
    // at exactly their useful lifetime.
    //
    // step_event is DELIBERATELY KEPT past persist (issue #175): the owner-only "How this was built"
    // disclosure on the persisted lesson page replays this run's per-step timeline (learner-safe labels +
    // frozen per-step durations + status) — a durable consumer the prune used to foreclose. It is
    // structurally leak-proof (no token/cost/model/error-text column — just name/key/timestamps/status),
    // owner-gated for free by the page's existing `getLesson(id, sub)` filter, and the dispatch marker
    // (recordDispatch) it carries is not a STAGE_RAIL position, so the frozen rail's `deriveRail` ignores
    // it. The deletes run AFTER the inserts and inside the SAME transaction, so a persist failure rolls
    // them back too — leaving the run fully resumable. (A fire-and-forget research-sink write that lands
    // AFTER this prune is a harmless straggler — bounded, owner-scoped, never read post-persist; the
    // sink's 'done' UPDATE simply matches zero rows once they're gone.)
    await client.query('DELETE FROM step_result WHERE run_id = $1', [runId]);
    await client.query('DELETE FROM run_owner WHERE run_id = $1', [runId]);
    await client.query('DELETE FROM research_event WHERE run_id = $1', [runId]);
    // code_progress (PR-4 / #180) is the FOURTH still-pruned transient table — the live code-phase bar's
    // one row, read only by the in-flight generating UI; it has no post-persist consumer (unlike the
    // durable step_event), so it is bounded at its in-run lifetime here alongside research_event.
    await client.query('DELETE FROM code_progress WHERE run_id = $1', [runId]);
    await client.query('COMMIT');
    client.release();
    return { lessonId: runId };
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

export interface LessonView {
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
  /** Presence flag from `getLesson`'s SELECT (`p.html IS NOT NULL AND p.html <> ''`) — NOT the blob.
   *  Distinguishes a reviewer-HELD lesson (soon + html present) from a FAILED one (soon + null). #215. */
  has_html: boolean;
}

/** Rebuild the tiered hub from ordered join rows (the inverse of flattenHub). Pure. */
export function rebuildHub(rows: PageJoinRow[], lessonId: string): SitemapHub {
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
      // Authoritative html-presence for the read path (issue #215): a `soon` page WITH html present is a
      // reviewer-HELD lesson (cleanly rejected, renderable), WITHOUT html is a FAILED one (no artifact).
      hasHtml: row.has_html,
      // Authorize the artifact THROUGH the owning curriculum (the cookie-borne, owner-checked route),
      // NOT a per-pageId capability — pageId is a content hash SHARED across curricula (identity.ts), so
      // it is no secret. Keyed by the URL-safe slug; the route re-resolves it owner-scoped.
      href: `/lesson/${encodeURIComponent(lessonId)}/artifact/${encodeURIComponent(row.concept_slug)}`,
    });
  }
  return { tiers };
}

/** Read a curriculum + its tiered hub, OWNER-SCOPED: absent and not-owned both yield null (a uniform
 *  404 upstream — no 403/404 existence oracle). ADR 0002 §5. A soft-deleted lesson (`deleted_at` set —
 *  lesson-deletion epic #198) reads back null the same way, so deletion is "absent at the read layer". */
export async function getLesson(
  id: string,
  ownerSub: string,
  deps: StoreDeps = { pool: getPool() },
): Promise<LessonView | null> {
  const cur = await deps.pool.query<{ id: string; topic: string; settings_json: Settings }>(
    `SELECT id, topic, settings_json FROM curriculum WHERE id = $1 AND owner_sub = $2 AND deleted_at IS NULL`,
    [id, ownerSub],
  );
  const row = cur.rows[0];
  if (!row) return null;
  const pages = await deps.pool.query<PageJoinRow>(
    // `has_html` is PRESENCE ONLY — the blob is never pulled into the hub query. The faithful predicate
    // mirrors how persistRun writes html (`artifact?.html ?? null`, repo.ts): only a NULL/absent artifact
    // nulls the column, but an empty-string artifact would also mean "no real page", so `<> ''` closes
    // that edge — a `soon` row with non-empty html is HELD (rejected-but-renderable); null/empty is
    // FAILED (no artifact). The page derives `built | held | failed` from (status, has_html). #215.
    `SELECT cp.tier, cp.category, cp.page_id, p.concept_slug, p.title, p.status,
            (p.html IS NOT NULL AND p.html <> '') AS has_html
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
 *  (lessonId owned by ownerSub, slug). null for absent / not-owned (uniform 404). The slug — not
 *  the shared content-hash pageId — is the lookup key, so a per-pageId capability is never the gate.
 *  A soft-deleted lesson (`c.deleted_at` set — #198) reads back null too, so its artifact is unreachable. */
export async function getOwnedPage(
  lessonId: string,
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
      WHERE c.id = $1 AND c.owner_sub = $2 AND p.concept_slug = $3 AND c.deleted_at IS NULL`,
    [lessonId, ownerSub, slug],
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
 *  (ORDER BY started_at), so the status route needs no change. Since issue #175 KEEPS step_event past
 *  persist (for the owner-only "How this was built" disclosure), the marker survives persist too — but it
 *  is NOT a STAGE_RAIL position, so the frozen build-summary rail's `deriveRail` ignores it (exactly as the
 *  live rail does), and the summary's step count is the six real stages, never the marker.
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

/** Read a run's per-step timeline, oldest-first (issue #61). NOT owner-scoped here — each caller gates
 *  FIRST, then reads this. Two callers, two gates: the in-flight status route gates on `ownsRun`; the
 *  persisted lesson page reaches it through its existing owner-scoped `getLesson(id, sub)` render (issue
 *  #175). A non-owner never reaches either. The step_event rows are KEPT past persist (issue #175 removed
 *  their `persistRun` prune — step_result + run_owner + research_event are still pruned), so this serves
 *  BOTH the pre-persist poll window AND the owner-only "How this was built" disclosure on the finished page. */
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

// ── code_progress — the live CODE-PHASE progress feed (PR-4 / issue #180) ─────────────────────────────

/** One code-phase progress sample as the status poll surfaces it (PR-4 / #180). LEARNER-SAFE + COPY-SAFE
 *  by construction: it carries ONLY a bounded `fraction` (0..~0.95, computed in the sink) and the
 *  learner-safe `elapsedMs` — NEVER a raw token count, the cap, a cost, or a model id (those never leave
 *  the sink). The pipeline-internal stream `phase` is DELIBERATELY OMITTED here: it is kept in the table
 *  for debugging only and must not reach the wire/surface (it is pipeline vocabulary, not learner copy). */
export interface CodeProgress {
  /** The bounded fraction of the lesson written so far (0..~0.95). A unitless "how far along" coordinate
   *  about the artifact's growth — never a token magnitude. The view renders it as a bar + a rounded %. */
  fraction: number;
  /** Wall-clock ms since the code stream started (learner-safe timing). */
  elapsedMs: number;
}

/** Read a run's latest code-phase progress (PR-4 / #180). NOT owner-scoped here — the caller (the status
 *  route) gates on `ownsRun` FIRST, then reads this; a non-owner never reaches it (the SAME contract as
 *  getStepEvents/getResearchEvents). The code_progress row lives only while the run is in flight:
 *  `persistRun` PRUNES it once the curriculum lands, so this read only ever serves the pre-persist poll
 *  window. NO-INTERNALS: the SELECT projects ONLY the bounded fraction + elapsed_ms — never the stored
 *  `phase`, and the table holds no token/cost/model column to leak in the first place. Returns null for an
 *  absent run (no row yet, or pruned) — identical to a just-started owned run, so no existence oracle. */
export async function getCodeProgress(
  runId: string,
  deps: StoreDeps = { pool: getPool() },
): Promise<CodeProgress | null> {
  const res = await deps.pool.query<{ fraction: number; elapsed_ms: number }>(
    `SELECT fraction, elapsed_ms FROM code_progress WHERE run_id = $1`,
    [runId],
  );
  const row = res.rows[0];
  if (!row) return null;
  return { fraction: row.fraction, elapsedMs: row.elapsed_ms };
}

/** Coalesce interval for code-progress writes (PR-4 / #180). The onProgress hook fires per stream delta
 *  (thousands of times over ~270s); a finer cadence than the 2.5s status poll is wasted, so writes are
 *  throttled to this floor (sub-throttle samples are dropped in memory, not written). */
export const CODE_PROGRESS_THROTTLE_MS = 1500;

/**
 * The Postgres-backed live CODE-PHASE progress sink (PR-4 / issue #180) — the durable adapter the deployed
 * Cloud Run **Job** injects into `runLesson` so the generating UI can show a learner-safe "Writing the
 * lesson…" bar while the longest phase streams. The local-dev fallback, the CLI, and every test use
 * `noopCodeProgressSink` instead (no DB, no bar) — exactly how `noopResearchSink` keeps those paths off the
 * Postgres writer.
 *
 * FAIL-SAFE + FIRE-AND-FORGET, the SAME load-bearing-vs-observability pattern `PgResearchSink` /
 * `GcpEngine`'s `step_event` timing prove: code_progress is KEPT observability data, never load-bearing, so
 * a write fault (the table not yet migrated during a deploy window, a transient DB error) must NEVER abort
 * the paid `code` stream. `onProgress` is SYNCHRONOUS (it mirrors the per-delta hook): it keeps the latest
 * sample's `lastFlushMs` in memory and, only when ≥ CODE_PROGRESS_THROTTLE_MS has elapsed, fires the async
 * `flush` FIRE-AND-FORGET (`void this.flush(...).catch(...)`, never awaited), whose body is wrapped in
 * try/catch + `console.warn` + return — so neither the throttle bookkeeping nor a failed write can throw
 * back into the stream. The caller (run-pipeline) ALSO wraps the synchronous `onProgress` call in a
 * try/catch, making a non-conforming sink doubly safe.
 *
 * NO-INTERNALS: `flush` computes `fraction = min(outputTokens / max(1, maxTokens), 0.95)` IN THE SINK and
 * UPSERTs ONLY that bounded fraction (+ the learner-safe elapsedMs + the debug-only phase) — the raw token
 * count, the cap, cost, and model NEVER reach the DB, so they cannot reach the wire or the learner surface.
 * The ~0.95 clamp prevents a false "done" before the critic gate.
 */
export class PgCodeProgressSink implements CodeProgressSink {
  private lastFlushMs = 0;

  constructor(
    private readonly runId: string,
    private readonly deps: { pool: Pool } = { pool: getPool() },
  ) {}

  /** A per-delta progress sample. Throttled to CODE_PROGRESS_THROTTLE_MS; the write is fire-and-forget so
   *  the paid stream is never awaited or blocked, and a write fault can never reach the stream. */
  onProgress(p: { outputTokens: number; elapsedMs: number; maxTokens: number; phase: 'prefill' | 'generating' }): void {
    const now = Date.now();
    if (now - this.lastFlushMs < CODE_PROGRESS_THROTTLE_MS) return;
    this.lastFlushMs = now;
    void this.flush(p).catch(() => {
      /* unreachable — flush self-wraps; belt-and-suspenders so an unexpected rejection is inert */
    });
  }

  /** Compute the bounded fraction IN THE SINK and UPSERT the run's one row. Self-wrapped (try/catch + warn
   *  + return), so a write fault resolves rather than throwing back through the fire-and-forget call. */
  private async flush(p: {
    outputTokens: number;
    maxTokens: number;
    elapsedMs: number;
    phase: 'prefill' | 'generating';
  }): Promise<void> {
    try {
      // The ONLY token arithmetic — done HERE so no raw count crosses to the store/wire. ≤0.95 clamp keeps
      // the bar from reading "done" before the critic gate; max(1, …) guards a zero/absent cap.
      const fraction = Math.min(p.outputTokens / Math.max(1, p.maxTokens), 0.95);
      await this.deps.pool.query(
        `INSERT INTO code_progress (run_id, fraction, elapsed_ms, phase, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (run_id) DO UPDATE
           SET fraction = $2, elapsed_ms = $3, phase = $4, updated_at = now()`,
        [this.runId, fraction, p.elapsedMs, p.phase],
      );
    } catch (err) {
      console.warn('[code-progress] code_progress write failed (ignored)', this.runId, err);
    }
  }
}

/** One poster-card descriptor the library home (TS-17) renders a card grid from (TS-16). Thin by
 *  design — only the card fields, NOT the full tiered hub `getLesson` reads. `id` is the
 *  curriculum id (the card's `/lesson/[id]` href target).
 *
 *  Maps to the DENSE Figma `6:2` poster card. The `category` eyebrow (node `6:41`) + the `summary`
 *  description (node `6:47`) are the two new dense rows: `category` is the subject label (BIOLOGY /
 *  MATHEMATICS / …) the isolated fail-safe classifier derived (NULL → eyebrow omitted), `summary` is
 *  the lesson's learner-facing one-liner (the brief's learningGoal — NULL → description omitted). The
 *  footer-meta line ("beginner · d2 · 3h ago") is `level` + `depth` from `curriculum.settings_json`
 *  (REAL saved Settings) + the relative-time from `createdAt`. Every field is REAL stored data — a NULL
 *  category/summary (an old row or a classifier miss) just drops that row, never a fabricated value. */
export interface LessonCard {
  /** The curriculum id — the card's href target, `/lesson/[id]`. */
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
 *  oracle. Soft-deleted lessons (`deleted_at` set — #198) are filtered out, so the library home never
 *  shows a deleted lesson; the Recently-deleted shelf reads them via `listDeletedLessons`. ONE
 *  owner-scoped query joining `curriculum` → a single representative `concept_page`,
 *  projecting only the card fields — NOT a per-lesson `getLesson` loop (which would be N+1 and
 *  over-fetch the tiered hub).
 *
 *  ONE CARD PER CURRICULUM — enforced by the QUERY, not by a single-page coincidence. Today every
 *  persisted curriculum is single-page (ADR-0003: every entrypoint drives `runLesson`), but `persistRun`
 *  is general (one `curriculum_page` per page in `flattenHub`) and the multi-page curriculum path
 *  (`runPipeline`) is RETAINED for the curriculum-wrapper milestone. A naïve `curriculum JOIN
 *  curriculum_page JOIN concept_page` yields one row PER PAGE, so a multi-page curriculum would emit N
 *  duplicate cards sharing one `/lesson/[id]` href. The inner `DISTINCT ON (c.id) ... ORDER BY c.id,
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
    // (the RETAINED runPipeline path) emits ONE card, not N duplicates sharing one /lesson/[id] href
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
          WHERE c.owner_sub = $1 AND c.deleted_at IS NULL
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

// ── soft-delete data layer (lesson-deletion epic, #198) ───────────────────────────────────────────
// Recoverable deletion as one nullable `curriculum.deleted_at` stamp (schema.sql). Deletion is "absent
// at the read layer" — the three reads above each carry `deleted_at IS NULL`. softDelete/restore are
// single owner-scoped GUARDED UPDATEs whose `RETURNING id` is the reconcile seam the optimistic clients
// (#199/#201/#203) reconcile against. NO route/UI here — this is the foundational data layer #199–#205
// build on (no `hardDelete`; that's #205). NO durable behavior change beyond the column + predicates.

/** Soft-delete the caller's lessons by id — a SINGLE owner-scoped guarded UPDATE that stamps
 *  `deleted_at = now()` ONLY on rows the caller owns that are not already deleted, and returns the ids
 *  actually affected (the `RETURNING id` rows). IDEMPOTENT + ordering-safe by construction: the
 *  `deleted_at IS NULL` guard makes a re-delete, a foreign-owner id, and a stale/absent id all match
 *  ZERO rows and return `[]` (so a late delete can never overtake a restore). Owner-scoping
 *  (`owner_sub = $2`) is UNCONDITIONAL — the client id list is never the authorization boundary. The
 *  returned ids are the reconcile seam the optimistic clients (#199/#201/#203) reconcile against — never
 *  the client's own requested list. (#198) */
export async function softDelete(
  ids: string[],
  ownerSub: string,
  deps: StoreDeps = { pool: getPool() },
): Promise<string[]> {
  const res = await deps.pool.query<{ id: string }>(
    `UPDATE curriculum SET deleted_at = now()
      WHERE id = ANY($1) AND owner_sub = $2 AND deleted_at IS NULL
      RETURNING id`,
    [ids, ownerSub],
  );
  return res.rows.map((r) => r.id);
}

/** Restore the caller's soft-deleted lessons by id — the inverse of `softDelete`: a SINGLE owner-scoped
 *  guarded UPDATE that clears `deleted_at` ONLY on rows the caller owns that are currently deleted, and
 *  returns the ids actually affected. IDEMPOTENT + ordering-safe: the `deleted_at IS NOT NULL` guard
 *  makes a re-restore, a foreign-owner id, and a not-currently-deleted id all match ZERO rows and return
 *  `[]`. Owner-scoping is UNCONDITIONAL, same as `softDelete`. (#198) */
export async function restore(
  ids: string[],
  ownerSub: string,
  deps: StoreDeps = { pool: getPool() },
): Promise<string[]> {
  const res = await deps.pool.query<{ id: string }>(
    `UPDATE curriculum SET deleted_at = NULL
      WHERE id = ANY($1) AND owner_sub = $2 AND deleted_at IS NOT NULL
      RETURNING id`,
    [ids, ownerSub],
  );
  return res.rows.map((r) => r.id);
}

/** A Recently-deleted poster card — a `LessonCard` plus the `deletedAt` ISO stamp the recovery shelf
 *  (#204) orders + labels by ("deleted 3h ago"). The Recently-deleted surface reuses the dense library
 *  card, so this extends `LessonCard` rather than inventing a second card shape. (#198) */
export type DeletedLessonCard = LessonCard & { deletedAt: string };

/** List one poster-card per SOFT-DELETED lesson the caller owns, newest-deleted-first — the reader the
 *  Recently-deleted shelf (#204) builds on. OWNER-SCOPED (ADR 0002 §5): scoped on `curriculum.owner_sub`
 *  AND filtered to `c.deleted_at IS NOT NULL`, so a foreign/unknown owner gets `[]` (no existence oracle),
 *  and a live (not-deleted) lesson never appears. REUSES the `listLessons` one-card-per-curriculum
 *  `DISTINCT ON (c.id)` projection (so a multi-page curriculum still emits ONE card), adding the
 *  `deleted_at` column and ordering by it DESC. Each card carries a `deletedAt` ISO string. (#198) */
export async function listDeletedLessons(
  ownerSub: string,
  deps: StoreDeps = { pool: getPool() },
): Promise<DeletedLessonCard[]> {
  const res = await deps.pool.query<{
    id: string;
    created_at: string | Date;
    deleted_at: string | Date;
    concept_slug: string;
    title: string;
    status: PageStatus;
    settings_json: Settings;
    category: string | null;
    summary: string | null;
  }>(
    // Same one-card-per-curriculum shape as listLessons (inner DISTINCT ON (c.id) → lowest-ordinal
    // representative page), filtered to deleted rows and re-ordered newest-DELETED-first by the outer
    // query (DISTINCT ON forces ORDER BY c.id first, so the deleted_at DESC sort lives in the outer query).
    `SELECT id, created_at, deleted_at, concept_slug, title, status, settings_json, category, summary
       FROM (
         SELECT DISTINCT ON (c.id)
                c.id, c.created_at, c.deleted_at, c.settings_json, c.category, c.summary,
                p.concept_slug, p.title, p.status
           FROM curriculum c
           JOIN curriculum_page cp ON cp.curriculum_id = c.id
           JOIN concept_page p ON p.id = cp.page_id
          WHERE c.owner_sub = $1 AND c.deleted_at IS NOT NULL
          ORDER BY c.id, cp.ordinal
       ) cards
      ORDER BY deleted_at DESC`,
    [ownerSub],
  );
  return res.rows.map((r) => ({
    id: r.id,
    slug: r.concept_slug,
    title: r.title,
    status: r.status,
    level: r.settings_json.level,
    depth: r.settings_json.depth,
    // pg returns TIMESTAMPTZ as a Date; normalize to ISO strings (same as listLessons.createdAt).
    createdAt: new Date(r.created_at).toISOString(),
    category: r.category ?? null,
    summary: r.summary ?? null,
    deletedAt: new Date(r.deleted_at).toISOString(),
  }));
}

/** The friendly-stale existence read the reader (#202) branches on: does this caller OWN this id AND is
 *  it currently soft-deleted? Returns `{ id, topic }` for an owned soft-deleted lesson (so the reader can
 *  show a "this lesson is in Recently deleted — restore it?" state instead of a bare 404), and `null` for
 *  an absent, not-owned, OR not-deleted id alike — no 403/404 existence oracle. (#198) */
export async function getOwnedDeletedLesson(
  id: string,
  ownerSub: string,
  deps: StoreDeps = { pool: getPool() },
): Promise<{ id: string; topic: string } | null> {
  const res = await deps.pool.query<{ id: string; topic: string }>(
    `SELECT id, topic FROM curriculum WHERE id = $1 AND owner_sub = $2 AND deleted_at IS NOT NULL`,
    [id, ownerSub],
  );
  return res.rows[0] ?? null;
}
