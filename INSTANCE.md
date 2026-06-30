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

## Design / Figma (source of truth, agent-synced)
`FIGMA_FILE_ID` is configured, so the Figma module (`docs/optional/figma.md`) is **on**, and this file is the product's **visual source of truth, kept in LOCKSTEP with the shipped UI**: agents use BOTH the Figma MCP read tools AND its **write tools** (`use_figma` / `generate_figma_design` / `create_new_file` / `upload_assets`) — **any frontend change keeps the matching Figma frame(s) in lockstep, agent-authored** — for an issue-driven change the frame is authored/updated at the **issue stage** (design-first, pre-code-gated, referenced in the issue body) and the PR implements to it, reconciling Figma only if the build diverges; a direct issue-less PR authors the frame in that same PR (see AGENTS.md → "Design source of truth" + the Update-Triggers Figma row). A pure §0 token-*value* change with unchanged composition is the one exception — it stays on `serve.test.ts` + `DESIGN.md` §0 (the captured frames bind no variables), so refreshing a frame's swatches is opportunistic, not mandatory. The old read-only / human-only-edits policy is **RETIRED**: it let Figma silently drift out of sync with the build across dozens of frontend PRs. Direction: Figma still *leads* for net-new design (design-first); for a change to an already-shipped surface the frame is *updated to the intended change at the issue stage* — the build then implements to it, reconciling on divergence — so either way the PR ends with Figma and the build in agreement, and "ahead of the shipped chrome" as a steady state is retired (the full issue-stage lifecycle lives in AGENTS.md → "Design source of truth"). On a genuine value conflict the resolution order stays **shipped build > `DESIGN.md` > Figma** — the build is what ships and only `DESIGN.md` §0 is CI-guarded against the code — so a still-disagreeing Figma value is drift to reconcile into `DESIGN.md` §0 (and back into Figma) in a PR. The ranking breaks a momentary tie; lockstep is the duty that removes it.

- **File:** `upjG7gfzlkdojb8LLOwu6T` — <https://www.figma.com/design/upjG7gfzlkdojb8LLOwu6T> ("Topic Synthesis — Design System & Screens", in *Julian's team*).
- **MCP quirk (load-bearing):** `get_metadata` with **no** `nodeId` lists only the **first** page (`Feature Screens`) — always pass an explicit page node-id from the map below. Live variable reads **do** resolve here (`get_variable_defs` returns the §0 tokens on nodes that bind them; the four captured screen frames bind none and return `{}`).

### Page / node map

| Page | Page node | Key nodes |
| --- | --- | --- |
| **Overview** | `9:2` | Product header + File map; Foundation/§0 token block `9:15` |
| **Feature Screens** | `0:1` | Sign-in `5:2` · Library `6:2` · Generating `1:2` · Lesson workspace `3:2` · Lesson workspace — degraded (held) `93:2` · Lesson workspace — degraded (failed) `96:2` · Lesson workflow — completed (frozen) `103:2` |
| **User Journey** | `9:3` | 5-stage learner map `12:5` |
| **User Flows** | `9:4` | App navigation `19:5` · Generation pipeline (ANALYSIS→SYNTHESIS) `19:6` |
| **Storyboards** | `9:5` | Card→reader morph `30:6` · Predict-then-reveal `30:7` · Generating→reveal `30:8` |
| **Journeys, Stories & Motion** | `9:6` | Motion system `35:2` |
| **App Flow (End-to-End)** | `9:7` | Click-through prototype; flow start `42:6` |

**Pending Figma frames (agent-authored) — lesson-deletion affordances (flagged by [#207](https://github.com/julianken/topic-synthesis/issues/207)).** The lesson-deletion epic adds deletion + recovery surfaces the Figma file does not yet contain: a delete affordance on the **Library** frame `6:2` and the **Lesson workspace** frame `3:2` (both on the **Feature Screens** page `0:1`), plus a **new Recently-deleted (recovery shelf)** frame. An agent adds these frames (the Library `6:2` / Lesson-workspace `3:2` delete affordance + the new Recently-deleted shelf) when the lesson-deletion epic's frontend surfaces land — under the lockstep convention — and records the new node-ids in the map above once they exist. No node-id is listed for them here yet: these are pending frames, so the map carries no invented id for them. (The deletion epic's frontend issues — #201–#205 — were authored before the issue-stage-authoring amendment (#226) and are **grandfathered under #222**, so their frames stay PR-time-authored as stated above; a deletion surface authored *after* the amendment follows the issue-stage rule — AGENTS.md → "Design source of truth".)
