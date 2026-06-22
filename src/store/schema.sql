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

-- Run ownership stamped at DISPATCH (before the curriculum persists), so the hub can tell a caller's
-- own still-generating run (→ "generating") from a foreign/absent id (→ uniform 404) with no DB
-- existence oracle. The Job later writes the same sub onto curriculum.owner_sub at persist. ADR 0002 §5.
CREATE TABLE IF NOT EXISTS run_owner (
  run_id     TEXT PRIMARY KEY,
  owner_sub  TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The curriculum<->page JOIN: the seam that lets one page belong to many
-- curricula once sharing is enabled.
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

-- Per-step TIMING for the live generating timeline (issue #61). The GcpEngine stamps started_at
-- when a step REALLY runs (cache miss) and finished_at on completion — a cache HIT (a crash-resume of
-- an already-done step) writes nothing, so the original row stands and the timeline stays complete +
-- non-duplicated across a resume. Same (run, name, key) shape as step_result. Read ONLY by the live
-- generating UI while the run is in flight; the finished lesson page shows the artifact, not the
-- timeline. Like step_result + run_owner, `persistRun` PRUNES this run's rows in its transaction once
-- the curriculum lands — step_event is intentionally NOT kept for cross-run analysis (no such view).
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
