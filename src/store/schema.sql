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

-- One curriculum (a single topic request).
CREATE TABLE IF NOT EXISTS curriculum (
  id            TEXT PRIMARY KEY,
  topic         TEXT NOT NULL,
  settings_json JSONB NOT NULL,
  workflow_ver  TEXT NOT NULL REFERENCES workflow_version(id),
  run_id        TEXT REFERENCES run(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
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
