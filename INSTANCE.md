# INSTANCE.md

<!-- INSTANCE FACTS for this specific product/repo: what it is, its GitHub identity,
and its (optional) merge/review infra. AGENTS.md is the source of truth for PROCESS
(how agents work); this file is the source of truth for INSTANCE (which product, which
repo, which merge setup). DESIGN.md remains the source of truth for design. Keep process
rules out of this file — they belong in AGENTS.md so the process shape stays portable. -->

## What this is
Topic Synthesis — Generate interactive, scaffolded learning curricula from a topic. A user enters a topic + settings; a multi-agent ANALYSIS→SYNTHESIS workflow researches it, builds a prerequisite knowledge graph, and generates a tiered curriculum of standalone, interactive HTML/Canvas/SVG/JS concept pages. Built largely by AI coding agents through reviewed, squash-merged PRs.

## Status
**Status: building the walking skeleton (sub-project 1).** The project foundation has landed — TypeScript + Next.js app, the share-ready Postgres schema + Docker infra, and the pure domain layer — with `npm` build/test commands documented in `AGENTS.md` → "Working in the tree". The multi-agent pipeline, the self-hosted Trigger.dev engine, the `@eleatic/eval` trace seam, and the UI land in subsequent PRs per `docs/plans/walking-skeleton.md`.

## Repo identity
Local folder `topic-synthesis/`; GitHub slug `julianken/topic-synthesis` — pass the slug to `gh`. Default branch `main`.

## Merge / review infra
- **Mergify** (`.mergify.yml`): an approved PR squash-merges through the queue via a standalone `@Mergifyio queue` comment. The merge *method* and its invariants are process — see `.claude/skills/pr-workflow/SKILL.md` and the user-level `mergify-merge-workflow` skill.
- **`@julianken-bot` is the sole non-author reviewer.** Direct push to `main` is blocked by a GitHub ruleset requiring 1 fresh approving review per HEAD from a non-author collaborator; the owner (`@julianken`, the lone code owner in `.github/CODEOWNERS`) authors PRs and can't self-approve, so `@julianken-bot` — the only other collaborator — is what unblocks merge.

<!-- Figma module disabled (FIGMA_FILE_ID left blank at bootstrap). To adopt later: add the
Figma file id + a node map section here, per docs/optional/figma.md. -->
