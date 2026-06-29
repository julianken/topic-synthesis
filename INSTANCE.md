# INSTANCE.md

<!-- INSTANCE FACTS for this specific product/repo: what it is, its GitHub identity,
and its (optional) merge/review infra. AGENTS.md is the source of truth for PROCESS
(how agents work); this file is the source of truth for INSTANCE (which product, which
repo, which merge setup). DESIGN.md remains the source of truth for design. Keep process
rules out of this file — they belong in AGENTS.md so the process shape stays portable. -->

## What this is
Topic Synthesis — Generate an interactive, scaffolded lesson from a topic. A user enters a topic + settings; a multi-agent ANALYSIS→SYNTHESIS workflow researches it and synthesizes one standalone, interactive HTML/Canvas/SVG/JS lesson end-to-end. (Assembling many lessons into a tiered, prerequisite-scaffolded curriculum is roadmap — see `README.md`.) <!-- concept-drift-ok: roadmap north-star (the curriculum WRAPPER), not a present-tense product claim — see "Product concept" below + ADR-0003 --> Built largely by AI coding agents through reviewed, squash-merged PRs.

## Product concept (canonical noun)
The product's **canonical noun is "one interactive lesson"** — a single, standalone, interactive page synthesized from a topic. Every LIVE surface (user copy, LLM stage prompts, public product descriptors, route copy) describes the product in those terms. This is the single source `scripts/check-concept-drift.sh` enforces.

**RETIRED TERMS** (as *present-tense product descriptors*) — the product refocused from a tiered curriculum to one lesson (epic #52; ADR-0003), so these must not describe the shipped product on a live surface: <!-- concept-drift-ok: meta-prose naming the retired terms it governs -->

- `curriculum` / `curricula` <!-- concept-drift-ok: the retired-terms catalogue itself -->
- `tiered` <!-- concept-drift-ok: the retired-terms catalogue itself -->
- `prerequisite knowledge graph` <!-- concept-drift-ok: the retired-terms catalogue itself -->

Each retired term remains LEGITIMATE — and passes the gate — in exactly three places:
1. **History:** `docs/decisions/**` + `docs/research/**` (+ `docs/plans/**`) — never retro-edit the record; these trees are fenced out of the gate. <!-- concept-drift-ok: names the fenced history trees -->
2. **Roadmap north-star:** the curriculum *wrapper* over the single-lesson workflow is the next sub-project (see `README.md` Status). A live-surface line that references the roadmap carries an inline `concept-drift-ok: roadmap north-star` comment. <!-- concept-drift-ok: describes the roadmap carve-out -->
3. **Retained dormant code / schema + the deferred DB table-name rename:** the curriculum machinery is RETAINED (not deleted) for the wrapper milestone and carries an inline `DORMANT:` / `RETAINED:` tag citing ADR-0003. The `/lesson` route + read-path identifiers were renamed off the dead noun (#172, executing ADR-0003 §4); the `curriculum`/`curriculum_page` **table names** stay a DEFERRED rename, also per ADR-0003. <!-- concept-drift-ok: describes the retained-machinery + deferred-table-rename carve-out -->

The gate's escape hatch is per-line: a matched line passes if it is absent, carries a `DORMANT:`/`RETAINED:` tag, or carries a `concept-drift-ok: <reason>` comment. The process trigger (when a concept change or a new dormancy fires the rename sweep) lives in `AGENTS.md` → "Keeping docs and drift-prone files current".

**Additive Phase-3 surface nouns (sanctioned).** Two NEW user-facing surfaces wrap the unchanged single-lesson product: the **library** (the home that lists a user's lessons — the sole generation entry) and the **lesson-workspace** (the v11 single-lesson reader layout). Both are **additive descriptors of the same single-lesson product** — they describe *how* one lesson is browsed and listed, not a tiered-curriculum return. They are deliberately declared here (not silently added) because `check-concept-drift.sh` greps only the RETIRED terms above, so net-new nouns never trip the gate — exactly why their canonical-surface status is recorded by hand. The library lists a user's *single* lessons (a flat owner-scoped list, not a prerequisite-scaffolded curriculum); the lesson-workspace is the *single-lesson* layout. They are NOT a curriculum revival, so the RETIRED-terms list (above) is unchanged. <!-- concept-drift-ok: meta-prose contrasting the retained-dormant curriculum concept, per program-doc decision 11 --> The rationale (the dependency graph, the locked decisions) lives in the program doc, not here — see [`docs/plans/lesson-workspace.md`](https://github.com/julianken/topic-synthesis/blob/main/docs/plans/lesson-workspace.md) → decision 11.

## Status
**Status: DEPLOYED on GCP Cloud Run; auth subsystem SHIPPED.** The full e2e ships and runs in the cloud — a topic produces one browsable, interactive lesson (multi-agent pipeline → Postgres → sandboxed artifact iframe), observable via the published `@eleatic/eval` trace seam. **Deployed** via Terraform (`infra/`): the `topic-synthesis-prod` project (Cloud SQL Postgres 16, Artifact Registry, Secret Manager, the runtime SA) + the Cloud Run **Service** (scale-to-zero app) + the pipeline + one-shot migrate **Jobs** + the durable `GcpEngine` (Postgres step-memoization) — see `docs/decisions/0001-deployment-orchestration-and-swappability.md`. The **auth subsystem** is **in place** (the #41–#45 epic merged): managed GCP Identity Platform + an `owner_sub`-on-Postgres ownership column + an `AuthProvider` port, with a branded Google sign-in, the authenticated spend gate, and owner-scoped private reads all live — per `docs/decisions/0002-auth-architecture.md` + `docs/plans/auth-subsystem.md`; the Google OAuth web client + the auth env (`NEXT_PUBLIC_FIREBASE_*` build args + `AUTH_ALLOWLIST`, see `SECURITY.md` → "Authentication & access") are the one-time deploy seams. Build/test commands: `AGENTS.md` → "Working in the tree".

## Repo identity
Local folder `topic-synthesis/`; GitHub slug `julianken/topic-synthesis` — pass the slug to `gh`. Default branch `main`.

## GitHub repository description
The repo's one-line GitHub description (the `gh repo edit --description` value) is canonical here and pushed to GitHub by `scripts/sync-repo-description.sh`. Keep it matching the README tagline; the AGENTS.md Update Triggers row reconciles the two in the same PR. Syncing the live value is an **orchestrator** action — a reviewer only flags drift (see AGENTS.md → "Keeping docs and drift-prone files current"). The script reads the single line between the markers below:

<!-- REPO_DESCRIPTION:START -->
Generate an interactive, scaffolded lesson from a topic.
<!-- REPO_DESCRIPTION:END -->

## Merge / review infra
- **Mergify** (`.mergify.yml`): an approved PR squash-merges through the queue via a standalone `@Mergifyio queue` comment. The merge *method* and its invariants are process — see `.claude/skills/pr-workflow/SKILL.md` and the user-level `mergify-merge-workflow` skill.
- **Head branches auto-delete on merge** (`delete_branch_on_merge=true`, set repo-wide). GitHub removes the **remote** head branch when a PR merges; **local worktrees** (the worktree-only policy creates one per change) are cleaned up operator-side, never by GitHub or Mergify.
- **`@julianken-bot` is the sole non-author reviewer.** Direct push to `main` is blocked by a GitHub ruleset requiring 1 fresh approving review per HEAD from a non-author collaborator; the owner (`@julianken`, the lone code owner in `.github/CODEOWNERS`) authors PRs and can't self-approve, so `@julianken-bot` — the only other collaborator — is what unblocks merge.

## Design / Figma (read-only)
`FIGMA_FILE_ID` is configured, so the Figma module (`docs/optional/figma.md`) is **on**: agents read this file over the Figma MCP **read tools only** — a human edits the design, agents never call a write tool. Authority ranking is **shipped build > `DESIGN.md` > Figma**; a live Figma value that disagrees with `DESIGN.md` is drift to reconcile into `DESIGN.md` §0, not a binding source. The file is a *design-direction reference* (it captures the lesson-workspace redesign + flows), ahead of the shipped chrome — so the build, then `DESIGN.md`, still win.

- **File:** `upjG7gfzlkdojb8LLOwu6T` — <https://www.figma.com/design/upjG7gfzlkdojb8LLOwu6T> ("Topic Synthesis — Design System & Screens", in *Julian's team*).
- **MCP quirk (load-bearing):** `get_metadata` with **no** `nodeId` lists only the **first** page (`Feature Screens`) — always pass an explicit page node-id from the map below. Live variable reads **do** resolve here (`get_variable_defs` returns the §0 tokens on nodes that bind them; the four captured screen frames bind none and return `{}`).

### Page / node map

| Page | Page node | Key nodes |
| --- | --- | --- |
| **Overview** | `9:2` | Product header + File map; Foundation/§0 token block `9:15` |
| **Feature Screens** | `0:1` | Sign-in `5:2` · Library `6:2` · Generating `1:2` · Lesson workspace `3:2` |
| **User Journey** | `9:3` | 5-stage learner map `12:5` |
| **User Flows** | `9:4` | App navigation `19:5` · Generation pipeline (ANALYSIS→SYNTHESIS) `19:6` |
| **Storyboards** | `9:5` | Card→reader morph `30:6` · Predict-then-reveal `30:7` · Generating→reveal `30:8` |
| **Journeys, Stories & Motion** | `9:6` | Motion system `35:2` |
| **App Flow (End-to-End)** | `9:7` | Click-through prototype; flow start `42:6` |
