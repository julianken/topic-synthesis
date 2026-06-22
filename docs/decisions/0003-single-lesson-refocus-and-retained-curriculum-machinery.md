# ADR 0003 — Single-lesson refocus, retained-dormant curriculum machinery, and the deferred route/table rename

**Status:** Accepted (2026-06-21) · **Relates:** epic #52 (CLOSED — the single-lesson refocus; children #47–#51, #61 merged), issue #68 (the concept-drift prevention system this ADR anchors). · **Does not supersede** 0001/0002 — it records a product-concept refocus those ADRs predate.

## Context

The product's central noun drifted. The codebase refocused from a tiered **curriculum** (many prerequisite-scaffolded pages) to **one interactive lesson** — `runLesson` (plan → research → brief → spec → code → critic → ONE page) is now driven by *every* entrypoint (`npm run skeleton`, the local-dev in-process fallback, and the deployed Cloud Run Job). The graph-based curriculum path (`runPipeline` → `graph` → `coverage-gate` → `hub`) is no longer driven by any entrypoint.

That refocus left two hazards a drift audit surfaced (issue #68):
1. **Stale product copy** survived on live user/LLM-facing surfaces ("Generate a curriculum", "tiered curriculum", "curriculum architect" prompts) while the shipped product builds exactly one lesson. (Reconciled in #67 + #68.)
2. **The retained machinery was un-annotated** — a reader (or a grep) could not tell deliberately-retained scaffolding from drift to fix.

This ADR is the durable, in-repo **citation target** for the `DORMANT:`/`RETAINED:` tags and the concept-drift gate, since epic #52 is CLOSED and a closed issue is not a stable anchor.

## Decisions

### 1. The canonical product noun is "one interactive lesson"
Every LIVE surface (user copy, LLM stage prompts, public metadata/tagline, route copy) describes the product as one interactive lesson. The canonical noun and the RETIRED-TERMS list (`curriculum` / `curricula` / `tiered` / `prerequisite knowledge graph` as *product descriptors*) live in `INSTANCE.md` → "Product concept (canonical noun)"; `scripts/check-concept-drift.sh` enforces it as a hard CI gate (via `scripts/validate-scaffolding.sh`, gated by `.github/workflows/scaffolding.yml`).

### 2. The curriculum machinery is RETAINED-DORMANT, not deleted
The curriculum path is the **roadmap north-star**: the future *curriculum-wrapper* milestone will decompose a topic → N lessons, each built via `runLesson`, then assemble them into a tiered hub. The existing graph/gate/hub machinery is the start of that wrapper, so it is **kept dormant**, not deleted:
- `src/pipeline/run-pipeline.ts` `runPipeline` (the curriculum run path), `src/pipeline/graph.ts`, `src/pipeline/coverage-gate.ts`, `src/pipeline/hub.ts`;
- the `PrereqGraphSchema` / `GatedGraph` domain types (`src/domain/stages.ts`);
- (these all remain unit-tested so the dormant path can't silently rot.)

Each retained site carries an inline `DORMANT(curriculum-wrapper — ADR-0003 / epic #52):` tag citing this ADR. That tag is both the human signal ("retained scaffolding, not drift") and the belt-and-suspenders for any future widening of the gate's allowlist over those files.

### 3. The `curriculum` / `curriculum_page` tables are RETAINED under their v1 names
The single-lesson run persists as a **one-page `curriculum` row** — `persistRun` / `getCurriculum` reuse the existing schema rather than introduce a parallel `lesson` store (ADR 0002 kept ownership a column on the same Postgres; this keeps the persistence surface single). The table NAMES are **code identifiers**, not live product descriptors, so they carry a `RETAINED(v1-persistence — ADR-0003):` tag in `src/store/schema.sql` and are fenced out of the concept-drift gate. The rename is deferred (Decision 4).

### 4. The `/curriculum` route + table rename is DEFERRED (with a redirect-shim plan)
Route topology and code identifiers — `/curriculum/{id}`, `/curriculum/{id}/artifact/{slug}`, `getCurriculum`, the `curriculum`/`curriculum_page` tables, and the persisted `page.href` written at `src/store/repo.ts` — are NOT renamed now. They are a separate, deferred refactor:
- **Leading future topology:** `/lesson` = the atom (one lesson), `/curriculum` = the wrapper hub (many lessons). Today's single-lesson product would live at `/lesson/{id}`; the wrapper milestone reintroduces `/curriculum/{id}` as the hub over several lessons.
- **The migration hazard:** existing persisted rows carry `page.href = /curriculum/{id}/artifact/{slug}`. A bare rename would 404 every old href.
- **The approach:** a **redirect shim** — keep `/curriculum/...` serving (302 → the new `/lesson/...` path) so old hrefs don't break, and write new rows at the new path. The rename lands only when the route churn buys something (the wrapper milestone), not for cosmetics.

This deferral is tracked in `GAPS.md` so it resurfaces when the wrapper milestone fires.

## Consequences
- `INSTANCE.md` carries the canonical-noun + retired-terms block; `AGENTS.md` carries the "concept/noun change OR a path made dormant → rename sweep" Update-Triggers row; `.claude/skills/reviewing/SKILL.md` carries the concept-drift reviewer pass (with the R7 exception).
- `scripts/check-concept-drift.sh` is a hard CI gate; a retired product noun on a live surface fails the build unless it is fixed or carries a `DORMANT:`/`RETAINED:`/`concept-drift-ok:` escape.
- The DORMANT/RETAINED tags across the curriculum machinery cite this ADR; clearing them (un-dormant-ing `runPipeline`) is the wrapper milestone's job, which will also execute the Decision-4 rename.
- This ADR records a **forward** refocus — ADRs 0001/0002 and the `docs/research/**` / `docs/plans/**` history are NOT retro-edited.
