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
3. **Retained dormant code / schema / route identifiers:** the curriculum machinery is RETAINED (not deleted) for the wrapper milestone and carries an inline `DORMANT:` / `RETAINED:` tag citing ADR-0003; code identifiers and route topology (`/curriculum/{id}`, `getCurriculum`, the `curriculum`/`curriculum_page` tables) are a DEFERRED rename, also per ADR-0003. <!-- concept-drift-ok: describes the retained-machinery + deferred-rename carve-out -->

The gate's escape hatch is per-line: a matched line passes if it is absent, carries a `DORMANT:`/`RETAINED:` tag, or carries a `concept-drift-ok: <reason>` comment. The process trigger (when a concept change or a new dormancy fires the rename sweep) lives in `AGENTS.md` → "Keeping docs and drift-prone files current".

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

<!-- Figma module disabled (FIGMA_FILE_ID left blank at bootstrap). To adopt later: add the
Figma file id + a node map section here, per docs/optional/figma.md. -->
