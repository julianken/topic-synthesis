# INSTANCE.md

<!-- INSTANCE FACTS for this specific product/repo: what it is, its GitHub identity,
and its (optional) merge/review infra. AGENTS.md is the source of truth for PROCESS
(how agents work); this file is the source of truth for INSTANCE (which product, which
repo, which merge setup). DESIGN.md remains the source of truth for design. Keep process
rules out of this file — they belong in AGENTS.md so the process shape stays portable. -->

## What this is
Topic Synthesis — Generate interactive, scaffolded learning curricula from a topic. A user enters a topic + settings; a multi-agent ANALYSIS→SYNTHESIS workflow researches it, builds a prerequisite knowledge graph, and generates a tiered curriculum of standalone, interactive HTML/Canvas/SVG/JS concept pages. Built largely by AI coding agents through reviewed, squash-merged PRs.

## Status
**Status: in design → building the walking skeleton (sub-project 1).** Pre-code: no `package.json`, build, test, or CI app checks exist yet. Code lands via reviewed PRs, starting from the walking-skeleton plan in `docs/plans/`. Until build/test commands are added to `AGENTS.md` → "Working in the tree", agents must not claim they exist (the anti-invention guardrail).

## Repo identity
Local folder `topic-synthesis/`; GitHub slug `julianken/topic-synthesis` — pass the slug to `gh`. Default branch `main`.

## Merge / review infra
- **Mergify** (`.mergify.yml`): an approved PR squash-merges through the queue via a standalone `@Mergifyio queue` comment. The merge *method* and its invariants are process — see `.claude/skills/pr-workflow/SKILL.md` and the user-level `mergify-merge-workflow` skill.
- **`@julianken-bot` is the sole non-author reviewer.** Direct push to `main` is blocked by a GitHub ruleset requiring 1 fresh approving review per HEAD from a non-author collaborator; the owner (`@julianken`, the lone code owner in `.github/CODEOWNERS`) authors PRs and can't self-approve, so `@julianken-bot` — the only other collaborator — is what unblocks merge.

<!-- Figma module disabled (FIGMA_FILE_ID left blank at bootstrap). To adopt later: add the
Figma file id + a node map section here, per docs/optional/figma.md. -->
