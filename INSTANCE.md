# INSTANCE.md

<!-- INSTANCE FACTS for this specific product/repo: what it is, its GitHub identity,
and its (optional) merge/review infra. AGENTS.md is the source of truth for PROCESS
(how agents work); this file is the source of truth for INSTANCE (which product, which
repo, which merge setup). DESIGN.md remains the source of truth for design. Keep process
rules out of this file — they belong in AGENTS.md so the process shape stays portable. -->

## What this is
Topic Synthesis — Generate interactive, scaffolded learning curricula from a topic. A user enters a topic + settings; a multi-agent ANALYSIS→SYNTHESIS workflow researches it, builds a prerequisite knowledge graph, and generates a tiered curriculum of standalone, interactive HTML/Canvas/SVG/JS concept pages. Built largely by AI coding agents through reviewed, squash-merged PRs.

## Status
**Status: DEPLOYED on GCP Cloud Run; auth subsystem underway.** The full e2e ships and runs in the cloud — a topic produces a browsable, interactive curriculum (multi-agent pipeline → Postgres → sandboxed artifact iframes), observable via the published `@eleatic/eval` trace seam. **Deployed** via Terraform (`infra/`): the `topic-synthesis-prod` project (Cloud SQL Postgres 16, Artifact Registry, Secret Manager, the runtime SA) + the Cloud Run **Service** (scale-to-zero app) + the pipeline + one-shot migrate **Jobs** + the durable `GcpEngine` (Postgres step-memoization) — see `docs/decisions/0001-deployment-orchestration-and-swappability.md`. The Service is kept **private** (no public binding) pending auth. The **auth subsystem** — managed GCP Identity Platform + an `owner_sub`-on-Postgres ownership column + an `AuthProvider` port; the Google OAuth web client is a one-time manual seam — is being built per `docs/decisions/0002-auth-architecture.md` + `docs/plans/auth-subsystem.md`. Build/test commands: `AGENTS.md` → "Working in the tree".

## Repo identity
Local folder `topic-synthesis/`; GitHub slug `julianken/topic-synthesis` — pass the slug to `gh`. Default branch `main`.

## GitHub repository description
The repo's one-line GitHub description (the `gh repo edit --description` value) is canonical here and pushed to GitHub by `scripts/sync-repo-description.sh`. Keep it matching the README tagline; the AGENTS.md Update Triggers row reconciles the two in the same PR. Syncing the live value is an **orchestrator** action — a reviewer only flags drift (see AGENTS.md → "Keeping docs and drift-prone files current"). The script reads the single line between the markers below:

<!-- REPO_DESCRIPTION:START -->
Generate interactive, scaffolded learning curricula from a topic.
<!-- REPO_DESCRIPTION:END -->

## Merge / review infra
- **Mergify** (`.mergify.yml`): an approved PR squash-merges through the queue via a standalone `@Mergifyio queue` comment. The merge *method* and its invariants are process — see `.claude/skills/pr-workflow/SKILL.md` and the user-level `mergify-merge-workflow` skill.
- **Head branches auto-delete on merge** (`delete_branch_on_merge=true`, set repo-wide). GitHub removes the **remote** head branch when a PR merges; **local worktrees** (the worktree-only policy creates one per change) are cleaned up operator-side, never by GitHub or Mergify.
- **`@julianken-bot` is the sole non-author reviewer.** Direct push to `main` is blocked by a GitHub ruleset requiring 1 fresh approving review per HEAD from a non-author collaborator; the owner (`@julianken`, the lone code owner in `.github/CODEOWNERS`) authors PRs and can't self-approve, so `@julianken-bot` — the only other collaborator — is what unblocks merge.

<!-- Figma module disabled (FIGMA_FILE_ID left blank at bootstrap). To adopt later: add the
Figma file id + a node map section here, per docs/optional/figma.md. -->
