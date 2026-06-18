# topic-synthesis — Walking-Skeleton Implementation Plan

## Context

`topic-synthesis` is a new app: a user enters a topic + settings, a multi-agent
ANALYSIS→SYNTHESIS workflow generates an interactive, scaffolded learning
curriculum (standalone HTML/Canvas/SVG/JS concept pages in a tiered hub, modeled
on the hand-built `ai-concept-viz`). It is a platform of ~7 subsystems, so we
decomposed it and are building the **first sub-project: a thin, end-to-end
"walking skeleton."** Its job is to (1) de-risk the integration that actually
kills these projects — generation quality + the eval/trace seam — and (2) produce
**one real ~10-15 page STEM curriculum** you can look at and start a rubric
against. Two prior research workflows (`docs/research/`) ground every decision.

**Decisions locked in brainstorm (do not relitigate):**
- **Foundation:** the repo is created from the `julianken/agentic-seed` template —
  never hand-scaffolded. (Reinforced repeatedly; it carries the AGENTS.md process,
  DESIGN.md design-SoT, reviewed-PR flow, and CI.)
- **Launch scope:** STEM/technical vertical (matches the ai-concept-viz exemplars).
- **Data model:** share-ready schema, generate fresh in v1 (pages keyed by content
  identity so page-sharing is a later config change, not a rewrite).
- **Skeleton scope:** evaluable artifact + trace seam. Defer to later sub-projects:
  the full eval program, production telemetry/Braintrust + OTel dual-emit, the
  a11y + topic-admissibility gates, UI polish, page-reuse logic, online A/B.
- **Engine:** Trigger.dev v4, **self-hosted via Docker**, with **Postgres** as the
  app's system-of-record from day one.
- **Eval substrate:** `@eleatic/eval` (co-developed sibling `julianken/eleatic`),
  consumed as a git/local-path dependency (it is NOT on npm — verified 404).

## Step 0 — Bootstrap from agentic-seed (the public-repo init)

This is the first execution step the moment the plan is approved.

```sh
gh repo create julianken/topic-synthesis --template julianken/agentic-seed --public --clone
cd topic-synthesis
cp .seed/answers.example.json .seed/answers.json
```

Fill `.seed/answers.json`:
`PROJECT_NAME="Topic Synthesis"`, `PROJECT_TAGLINE` = "Generate interactive,
scaffolded STEM learning curricula from a topic" (editable), `OWNER=julianken`,
`REPO=topic-synthesis`, `LOCAL_FOLDER=topic-synthesis`, `DEFAULT_BRANCH=main`,
`CODEOWNER=julianken`, `LICENSE_HOLDER=julianken`, `YEAR=2026`,
`REVIEW_BOT=julianken-bot` (enabled), `FIGMA_FILE_ID=""` (Figma deferred).

```sh
bash scripts/fill-template.sh        # substitutes every {{PLACEHOLDER}}
# delete the OPTIONAL "Design / Figma" section in INSTANCE.md (FIGMA_FILE_ID blank)
# replace README.md, fill DESIGN.md §0 token manifest, set INSTANCE.md Status
bash scripts/check-claude-shim.sh    # expect: OK
bash scripts/validate-scaffolding.sh # expect: PASS
```

Then, per the worktree-only policy, all subsequent code lands via branches +
worktrees + reviewed PRs (review-bot + Mergify enabled). Post-create: add
`julianken-bot` as a review collaborator, set `main` branch protection (1
non-author review), install the Mergify app.

## Architecture

Two-phase, code-orchestrated pipeline behind a **pluggable `Engine` seam**, with
Trigger.dev v4 as the concrete durable engine (the user wants a real engine, so
there is no inline stub — the interface exists purely to keep stages
engine-agnostic and unit-testable):

```
topic+settings
  → Planner (Opus)                         decompose → research questions
  → Researchers (Sonnet, parallel fan-out) grounded retrieval w/ provenance
  → Graph-builder (Opus)                   prerequisite DAG + coverage_confidence
  → [grounding/coverage gate]              deterministic: build | text | soon | refuse-narrow
  → per node (map):  spec (Sonnet) → code (Sonnet) → 1 critic pass (Opus)
  → Hub assembler                          SITEMAP (tier→category→pages, built bool)
      ⤷ each stage emits a span → reduced to EvalTrace{spans} → local eleatic SQLite
```

Tiered models (`claude-opus-4-8` planner/graph/critic; `claude-sonnet-4-6`
researchers/first-draft synthesis), prompt-caching the shared graph/brief prefix;
assert `cache_read_input_tokens > 0` to catch silent cache misses. Confirm exact
model ids/pricing against the `claude-api` skill at build time.

## Repo / module layout (inside the filled scaffold)

```
src/
  domain/      settings.ts · identity.ts (contentIdentityKey) · stages.ts (stage contracts — the spine) · sitemap.ts
  pipeline/    planner.ts · researcher.ts · graph.ts · coverage-gate.ts · spec.ts · code.ts · critic.ts · hub.ts · run-pipeline.ts (pure fn over an injected Engine)
  llm/         client.ts · models.ts (tiers) · pricing.ts (MODEL_PRICING map + estimateCostUsd) · cache.ts   ← only @anthropic-ai/sdk import site
  engine/      engine.ts (interface Engine { step<I,O>(name,key,fn) }) · trigger-engine.ts (Trigger.dev v4 impl)
  trace/       span.ts (EvalSpan collector) · reduce.ts (→ EvalTrace{spans}) · eleatic-adapter.ts   ← only @eleatic/eval import site
  store/       schema.sql (Postgres) · db.ts (pg pool + migrate) · repo.ts (typed upsert/read by content identity)
trigger/       synthesize-curriculum.ts (root orchestrator) · synthesize-node.ts (per-node map: spec→code→critic)
app/           page.tsx (intake form) · api/generate/route.ts (trigger run) · curriculum/[id]/page.tsx (hub) · artifact/[pageId]/route.ts (cross-origin CSP)
components/     curriculum-progress.tsx (useRealtimeRun progress)
eval/          run-skeleton.ts (E2E CLI driver) · smoke.test.ts (vitest)
docker-compose.yml   Postgres (app + trigger DBs) + Redis + Trigger.dev self-host stack
```

## Data model (share-ready, Postgres)

Tables (DDL in `src/store/schema.sql`); the share-ready invariant is the **keys**:
- `concept_page` — keyed by content identity `(concept_slug, settings_bucket,
  content_hash)`; `status` (built|text|soon), `spec_json`, `html`, `coverage_conf`,
  `workflow_ver`. v1 always inserts fresh; the identity key lets two curricula
  point at one row later.
- `curriculum` — `topic`, `settings_json`, `workflow_ver`, `run_id`.
- `curriculum_page` — the curriculum↔page **join** (tier, category, ordinal) — the
  seam that enables page-sharing later.
- `workflow_version` — `id` = content-hash of DAG+prompts+pinned model
  snapshots+templates; `model_snapshots` JSON (the pinned dated snapshot ids).
- `run` — one generation run (mirrors an eleatic `eval_run` 1:1); `cost_usd`,
  `eleatic_run_id` (the only cross-store link into `eval.sqlite`).

The app store (Postgres) is **separate** from the eleatic eval store (`eval.sqlite`).

## Pipeline stage contracts (`src/domain/stages.ts`)

Each stage is a pure `(input, ctx) => Promise<output>` over typed contracts:
`TopicRequest → Plan → Research → PrereqGraph → GatedGraph → PageSpec →
PageArtifact → CritiquedArtifact → SitemapHub`. `coverage-gate.ts` and `hub.ts`
are pure (no LLM); the gate is a HARD gate (rejects on cycle, on an uncited node,
or near-zero coverage). `ctx` carries the LLM client + the span collector.

## Orchestration (Trigger.dev v4, self-hosted via Docker)

- Root task `synthesize-curriculum`: admit → plan → research `batchTriggerAndWait`
  fan-out → graph → gate → per-node `batchTriggerAndWait` map → assemble reduce.
- `synthesize-node`: `spec → code → 1 critic pass` as memoized sub-steps;
  `queue.concurrencyLimit` caps Claude pressure/spend.
- **Memoization = cost control:** on retry, completed researchers/graph/passed
  nodes are read from the durable store, never re-run (the Critic never re-runs on
  an already-passing node). Every child trigger carries `idempotencyKey =
  hash(workflowVersionId, stage, inputHash)` so a re-entrant parent never spawns a
  duplicate paid run. Pass an Anthropic request idempotency key on each Messages
  call; treat `stop_reason: "refusal"` as a handled gate outcome, not a retry.
- **Trigger from Next.js:** `app/api/generate/route.ts` uses a type-only import +
  `tasks.trigger<typeof synthesizeCurriculum>()`; returns `{runId, publicAccessToken}`.
- **Progress:** Trigger.dev **Realtime** (`useRealtimeRun`/`useRealtimeStream`,
  Apache-2.0/Electric, works self-hosted) — no hand-rolled SSE. The workflow pushes
  `phase`/`progress`/per-node status into run metadata.
- **Local infra:** `docker-compose up` brings up Postgres + Redis + the Trigger.dev
  self-host stack; `npm run dev` runs the Next app; `npx trigger.dev dev` runs the
  worker against the local stack.

## Artifact runtime (sandboxed)

Generated pages render in a **cross-origin iframe** with `sandbox="allow-scripts"`
**without** `allow-same-origin` (the load-bearing pair). `app/artifact/[pageId]/route.ts`
serves the HTML cookieless with a server-set CSP `default-src 'none'; script-src
'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'`.
DOMPurify sanitizes the HTML before store/serve. Hub output matches ai-concept-viz's
`window.SITEMAP` shape (tier→category→pages, `built` bool); `built = route==='built'
&& critic.passed` — a degraded/failed node renders `built:false` ("soon").

## Trace seam (eleatic)

Per the verified `@eleatic/eval` API (no `@eleatic/trace` package exists):
`openStore('eval.sqlite')` → `recordRun({id, label, baseline, config:{version,
modelSnapshots}, startedAt})` (run = workflow VERSION) → per page `recordRow({runId,
rowKey: contentIdentityKey, output, expected:null, scores, metadata, trace})` where
`trace` is `EvalTrace{spans}` (one `EvalSpan` per stage: planner/researcher/graph/
spec/code/critic; `metrics.costUsd` injected from `src/llm/pricing.ts` since cost is
NOT derivable from tokens) → `finalizeRun(runId, {rowCount, metrics})` → explore via
`npx @eleatic/eval serve --db eval.sqlite`. `tsconfig.json` must set
`exactOptionalPropertyTypes` (eleatic's store throws on `undefined` optional keys —
omit absent keys). The single-seam adapter pattern mirrors the proven photo-curation
adapter in `bird-watch` (reference only; depend on public `julianken/eleatic`).

## Error handling

- Thin-coverage node → `text` (cited text page) or `soon` (placeholder) per
  coverage thresholds; **never fabricate** an interactive page on thin coverage.
- Per-stage retry is delegated to the Engine (Trigger.dev policies); pipeline code
  contains no retry logic.
- Partial failure: a node that exhausts retries becomes `soon`; `assembleHub`
  always runs, so a 12/15-built curriculum ships rather than failing. Failed nodes
  still land an eleatic row (span `status:'error'`) so the trace captures failures.

## Critical files to create

`src/domain/stages.ts` (contracts), `src/pipeline/run-pipeline.ts` (engine-agnostic
orchestration), `src/engine/engine.ts` + `src/engine/trigger-engine.ts`,
`trigger/synthesize-curriculum.ts` + `trigger/synthesize-node.ts`,
`src/llm/pricing.ts`, `src/trace/eleatic-adapter.ts`, `src/store/schema.sql`,
`app/artifact/[pageId]/route.ts`, `app/api/generate/route.ts`, `docker-compose.yml`,
`eval/run-skeleton.ts`, `eval/smoke.test.ts`.

## Reuse

`@eleatic/eval` API (openStore/recordRun/recordRow/finalizeRun + the opaque
`trace` blob + `eleatic serve`); ai-concept-viz's `window.SITEMAP` + per-page
conventions; the agentic-seed scaffold + its skills/CI; the bird-watch
photo-curation `eleatic-adapter.ts` / `pricing.ts` as a proven single-seam pattern.

## Build sequence

1. Step 0 bootstrap (above) → first PR is the filled scaffold.
2. `docker-compose.yml` + Postgres schema + Trigger.dev self-host running locally.
3. `src/domain/stages.ts` + `src/llm/` (client/models/pricing/cache).
4. Pipeline stages + `run-pipeline.ts` (test each stage with a stubbed client).
5. `engine/` (Engine interface + Trigger.dev impl) + the two `trigger/` tasks.
6. `trace/` seam + eleatic git dep + `store/` repo.
7. `app/` intake + hub + sandboxed artifact route + Realtime progress.
8. `eval/run-skeleton.ts` + `eval/smoke.test.ts`.

## Verification (end-to-end, on the laptop via Docker)

1. `docker-compose up` (Postgres + Redis + Trigger.dev), `npx trigger.dev dev`, `npm run dev`.
2. `npm run skeleton -- --topic "Fourier transforms" --level intermediate` → generates
   a curriculum; prints curriculum id + per-stage cost; assert `cache_read_input_tokens>0`.
3. Open `/curriculum/[id]` → tiered hub with **10-15 nodes**, most `built`, thin ones
   `soon`/`text`. Click a built page → the cross-origin iframe loads; Canvas/SVG works;
   devtools shows the `default-src 'none'` CSP + `sandbox="allow-scripts"` (no
   `allow-same-origin`).
4. `npx @eleatic/eval serve --db eval.sqlite` → **1 run** (config.version = the
   workflow_version, baseline set), **N rows** (one per page), each row's trace drawer
   shows one span per stage with `durationMs`, tokens, and a populated `costUsd`.
5. `npm test` (vitest smoke): hub has ≥1 tier and 10-15 pages each with a boolean
   `built`; every built page has sanitized non-empty `html` + a non-empty
   `a11yContract`; the eleatic store has exactly 1 run + page-count rows with finite
   `costUsd`; a forced thin-coverage node routes to `soon`/`text` (not fabricated); an
   XSS probe renders inert after DOMPurify.

## Out of scope (later sub-projects)

Full eval program + frozen gold set; production telemetry + Braintrust + OTel
dual-emit seam; deterministic a11y/render gates + topic-admissibility classifier as
hardened components; page-sharing/reuse logic; online A/B; UI polish (transitions-dev).
