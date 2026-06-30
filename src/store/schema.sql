-- topic-synthesis app store (Postgres). Share-ready by construction: a page is
-- identified by what it teaches at what setting, NOT by the curriculum it
-- belongs to, so page-sharing across curricula is a later query/config change
-- rather than a schema migration. v1 always inserts fresh pages.
-- Idempotent: safe to run repeatedly.

-- A workflow VERSION = an eval arm. Its id is a content hash of the pipeline
-- shape: DAG + prompts + pinned dated model snapshots + page templates.
CREATE TABLE IF NOT EXISTS workflow_version (
  id              TEXT PRIMARY KEY,
  model_snapshots JSONB NOT NULL,
  prompt_hash     TEXT  NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One generation run; mirrors an eleatic eval_run 1:1.
CREATE TABLE IF NOT EXISTS run (
  id             TEXT PRIMARY KEY,
  workflow_ver   TEXT NOT NULL REFERENCES workflow_version(id),
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  page_count     INTEGER,
  cost_usd       NUMERIC(12, 6),
  eleatic_run_id TEXT
);

-- A page keyed by CONTENT IDENTITY (concept + settings bucket + content hash).
CREATE TABLE IF NOT EXISTS concept_page (
  id              TEXT PRIMARY KEY,
  concept_slug    TEXT NOT NULL,
  title           TEXT NOT NULL,
  settings_bucket TEXT NOT NULL,
  content_hash    TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('built', 'soon', 'text')),
  spec_json       JSONB,
  html            TEXT,
  coverage_conf   REAL,
  workflow_ver    TEXT NOT NULL REFERENCES workflow_version(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (concept_slug, settings_bucket, content_hash)
);
-- Idempotent upgrade for DBs created before `title` existed (the CREATE above covers fresh
-- DBs): add nullable, backfill legacy rows from the slug, then enforce NOT NULL — so the
-- column's NOT NULL invariant holds regardless of DB provenance.
ALTER TABLE concept_page ADD COLUMN IF NOT EXISTS title TEXT;
UPDATE concept_page SET title = concept_slug WHERE title IS NULL;
ALTER TABLE concept_page ALTER COLUMN title SET NOT NULL;

-- RETAINED(v1-persistence — ADR-0003): the `curriculum` table NAME is a code identifier, not a live
-- product descriptor. The single-lesson run persists as a one-page `curriculum` row (persistRun/
-- getLesson reuse). The `/lesson` ROUTE + read-path identifiers were renamed off this table (#172); the
-- TABLE rename stays DEFERRED — and needs NO redirect shim: hrefs are rebuilt at READ time from `concept_slug`
-- (rebuildHub), never persisted as a `page.href` column — see ADR-0003 + GAPS.md.
-- One curriculum (a single topic request).
CREATE TABLE IF NOT EXISTS curriculum (
  id            TEXT PRIMARY KEY,
  topic         TEXT NOT NULL,
  settings_json JSONB NOT NULL,
  workflow_ver  TEXT NOT NULL REFERENCES workflow_version(id),
  run_id        TEXT REFERENCES run(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Auth: the owning user (the verified Google `sub`). Additive + idempotent (same pattern as the
-- `title` backfill above) — nullable so legacy/unauthenticated rows are owner-only; written inside
-- persistRun's transaction (ADR 0002 §2 — no second store). Owner-scoped reads land in a later PR.
ALTER TABLE curriculum ADD COLUMN IF NOT EXISTS owner_sub TEXT;

-- Library poster-card presentation metadata (Figma 6:2 dense card). Additive + idempotent + NULLABLE
-- so OLD rows (and any run whose classifier failed) read back as no-eyebrow/no-description — the card
-- omits those rows gracefully, never a fabricated value. `category` is the subject eyebrow (BIOLOGY /
-- MATHEMATICS / …) from the isolated fail-safe classifier (NULL when none could be safely derived);
-- `summary` is the lesson's learner-facing one-liner (the brief's learningGoal — pure data plumbing,
-- no extra generation). Both are written inside persistRun's transaction; neither is on a stage path.
ALTER TABLE curriculum ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE curriculum ADD COLUMN IF NOT EXISTS summary  TEXT;

-- Recoverable soft-delete (lesson-deletion epic, #198). Additive + idempotent + NULLABLE, the SAME
-- pattern as the owner_sub/category/summary backfills above: a non-NULL `deleted_at` marks a lesson
-- recoverably deleted. Every owner-scoped read gains `AND deleted_at IS NULL`, so a deleted lesson reads
-- back identically to an absent/not-owned one (uniform 404, no existence oracle); the dedicated
-- Recently-deleted reads filter `deleted_at IS NOT NULL`. softDelete/restore are single owner-scoped
-- guarded UPDATEs (set/clear deleted_at, RETURNING id) — idempotent + ordering-safe. No FK/cascade/index
-- change: a partial index `WHERE deleted_at IS NULL` is deferred until data volume warrants it (GAPS.md).
ALTER TABLE curriculum ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Run ownership stamped at DISPATCH (before the curriculum persists), so the hub can tell a caller's
-- own still-generating run (→ "generating") from a foreign/absent id (→ uniform 404) with no DB
-- existence oracle. The Job later writes the same sub onto curriculum.owner_sub at persist. ADR 0002 §5.
CREATE TABLE IF NOT EXISTS run_owner (
  run_id     TEXT PRIMARY KEY,
  owner_sub  TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- run-lifecycle #225: run_owner ALSO carries the typed topic + settings, stamped at DISPATCH. The
-- create-form path no longer hosts an in-place generating shell that passes the topic CLIENT-side; it now
-- NAVIGATES to the SINGLE generating screen at /lesson/[id], so the typed topic must reach that
-- destination SERVER-side to show "Generating <topic>…" + the "<level> · depth <n>" sub-line instead of a
-- bare "Generating…". Read owner-gated via `getRunMeta` (the status route's `meta` field + the page's
-- generating branch SSR). Additive + NULLABLE: a legacy run_owner row with no topic reads back as null →
-- the honest "Generating…" degrade (no fabrication). Pruned with the rest of run_owner at persist.
ALTER TABLE run_owner ADD COLUMN IF NOT EXISTS topic TEXT;
ALTER TABLE run_owner ADD COLUMN IF NOT EXISTS level TEXT;
ALTER TABLE run_owner ADD COLUMN IF NOT EXISTS depth INTEGER;

-- RETAINED(v1-persistence — ADR-0003): the `curriculum_page` table NAME is a code identifier (the
-- curriculum<->page JOIN) — the seam that lets one page belong to many curricula once sharing/the
-- wrapper milestone is enabled. Rename is DEFERRED with the `curriculum` table — see ADR-0003.
CREATE TABLE IF NOT EXISTS curriculum_page (
  curriculum_id TEXT NOT NULL REFERENCES curriculum(id) ON DELETE CASCADE,
  page_id       TEXT NOT NULL REFERENCES concept_page(id),
  tier          TEXT NOT NULL,
  category      TEXT NOT NULL,
  ordinal       INTEGER NOT NULL,
  PRIMARY KEY (curriculum_id, page_id)
);

CREATE INDEX IF NOT EXISTS idx_concept_page_identity ON concept_page (concept_slug, settings_bucket);
CREATE INDEX IF NOT EXISTS idx_curriculum_page_curriculum ON curriculum_page (curriculum_id);
CREATE INDEX IF NOT EXISTS idx_run_workflow ON run (workflow_ver);

-- Durable step memoization for the GcpEngine (Cloud Run Job resume). A completed (run, step name,
-- content-identity key) is read back, never re-run, on retry/resume — so a crash never repeats
-- (or re-pays for) finished LLM work. This is the durable-execution ledger, not curriculum data —
-- so `persistRun` PRUNES this run's rows in its transaction once the curriculum lands (no consumer
-- after the run completes); the table stays bounded at exactly its in-run lifetime.
CREATE TABLE IF NOT EXISTS step_result (
  run_id      TEXT NOT NULL,
  name        TEXT NOT NULL,
  step_key    TEXT NOT NULL,
  result_json JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, name, step_key)
);

-- Per-step TIMING for the live generating timeline (issue #61) AND the owner-only "How this was built"
-- disclosure on the finished lesson page (issue #175). The GcpEngine emits step lifecycle to an EventSink
-- (issue #166); the default PgStepEventSink (src/store/pg-step-event-sink.ts) stamps started_at when a step
-- REALLY runs (cache miss) and finished_at on completion — a cache HIT (a crash-resume of an already-done
-- step) writes nothing, so the original row stands and the timeline stays complete + non-duplicated across
-- a resume. Same (run, name, key) shape as step_result. UNLIKE step_result + run_owner + research_event,
-- `persistRun` does NOT prune step_event (issue #175 removed that DELETE): the persisted lesson page replays
-- this run's per-step timeline (learner-safe labels + frozen durations + status) in the owner-only build
-- disclosure, owner-gated for free by the page's `getLesson(id, sub)` filter. It is structurally leak-proof
-- (no token/cost/model/error-text column — just name/key/timestamps/status), so it is safe to keep durable;
-- it is still NOT used for cross-run analysis (no such view) — only the lesson's own owner reads it back.
CREATE TABLE IF NOT EXISTS step_event (
  run_id      TEXT NOT NULL,
  name        TEXT NOT NULL,
  step_key    TEXT NOT NULL,
  started_at  TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  status      TEXT NOT NULL,
  PRIMARY KEY (run_id, name, step_key)
);
CREATE INDEX IF NOT EXISTS idx_step_event_run ON step_event (run_id);

-- Live-research DATA PATH (live-research generating Stage 1). The researcher fan-out emits the REAL
-- planned questions + each question's grounded {findings, sources} as it lands, so the generating UI
-- can show "Researching: N questions" then a live "M/N answered" with the actual claims + retrieved
-- source URLs/titles — never fabricated. One row per (run_id, question): 'pending' on announce,
-- 'done'/'error' once the research step resolves. The writes are BEST-EFFORT + FIRE-AND-FORGET
-- (PgResearchSink, never awaited on the run's critical path), so a slow/failed write yields NO live
-- rows and the paid pipeline completes identically — the UI degrades to the existing stage-rail.
-- Like step_event + step_result + run_owner, this is the FOURTH transient per-run table: read ONLY by
-- the live generating UI while the run is in flight (the finished lesson folds the research into the
-- durable brief→lesson), so `persistRun` PRUNES this run's rows in its transaction once the curriculum
-- lands — intentionally NOT kept for cross-run analysis. `findings`/`sources` denormalize each finding
-- against its retrieved source ({claim, {url, title}}) IN THE SINK, so no internal sourceIndex is ever
-- stored. `ordinal` is the question's index in the deduped/capped list — questions arrive concurrently
-- from the Promise.all fan-out, so started_at alone is racy; the reader orders by it.
CREATE TABLE IF NOT EXISTS research_event (
  run_id        TEXT NOT NULL,
  question      TEXT NOT NULL,            -- the REAL research question (planner output, deduped/capped)
  subtopic      TEXT,                     -- Research.subtopic (the question's framing); NULL while pending
  status        TEXT NOT NULL,            -- 'pending' | 'done' | 'error'
  findings      JSONB,                    -- [{ claim, source: { url, title } }] denormalized; NULL while pending
  sources       JSONB,                    -- [{ url, title }] = Research.sources; NULL while pending
  finding_count INTEGER,                  -- findings.length, for the "N/M" count without re-parsing JSONB
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,              -- set on 'done'/'error'; NULL ⇔ still pending
  ordinal       INTEGER NOT NULL,         -- the question's index in the deduped/capped list (stable order)
  PRIMARY KEY (run_id, question)
);
CREATE INDEX IF NOT EXISTS idx_research_event_run ON research_event (run_id);

-- Live CODE-PHASE PROGRESS (PR-4 / issue #180). The streaming `code` stage (PR-1, #174) fires an
-- `onProgress` hook per delta; the FAIL-SAFE PgCodeProgressSink coalesces those samples (throttled,
-- fire-and-forget, NEVER awaited on the run's critical path) into ONE row per run so the generating UI can
-- show a learner-safe "Writing the lesson…" progress bar while the longest phase (~83% of run wall-clock)
-- is otherwise opaque. Like step_result + run_owner + research_event, this is a TRANSIENT per-run table
-- read ONLY by the in-flight generating UI; `persistRun` PRUNES this run's row in its transaction once the
-- curriculum lands — it is NOT durable like step_event (#175) and NOT kept for cross-run analysis.
-- STRUCTURALLY LEAK-PROOF (the no-project-internals rule): the fraction is computed IN THE SINK
-- (outputTokens / maxTokens, clamped ≤0.95) and ONLY the bounded `fraction` is stored — there is NO raw
-- token count, cap, cost, or model column, so no internal magnitude can ever reach the wire or the learner
-- surface (the same denormalize-in-sink discipline research_event uses for sourceIndex). `phase` is the
-- pipeline-internal stream phase kept for DEBUGGING ONLY — it is NOT selected by the client getter, so it
-- never reaches the status payload or the UI. One row per run (PK run_id): the single-lesson path has
-- exactly one `code` step; the dormant curriculum path's N code steps would overwrite the one row, which is
-- acceptable for observability. A write fault (un-migrated table mid-deploy, a transient DB error) is
-- swallowed by the sink and never aborts the paid `code` stream.
CREATE TABLE IF NOT EXISTS code_progress (
  run_id     TEXT PRIMARY KEY,            -- one row per run (the single-lesson path has one code step)
  fraction   REAL NOT NULL,               -- bounded 0..~0.95, computed IN THE SINK; never a raw token count
  elapsed_ms INTEGER NOT NULL,            -- wall-clock since the code stream started (learner-safe timing)
  phase      TEXT,                         -- stream phase ('prefill'|'generating') — DEBUG ONLY, never served
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
