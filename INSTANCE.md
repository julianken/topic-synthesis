# INSTANCE.md

<!-- INSTANCE FACTS for this specific product/repo: what it is, its GitHub identity,
its (optional) Figma design file, and its (optional) merge/review infra. AGENTS.md is
the source of truth for PROCESS (how agents work); this file is the source of truth for
INSTANCE (which product, which repo, which Figma file, which merge setup). DESIGN.md
remains the source of truth for design. Keep process rules out of this file — they belong
in AGENTS.md so the process shape stays portable across products.

THIS IS A FILL-IN TEMPLATE. Replace every {{PLACEHOLDER}} with the value declared in
.seed/placeholders.json (project-bootstrap fill-mode does this, or run it by hand). The
two OPTIONAL sections below are gated on optional placeholders: if {{FIGMA_FILE_ID}} is
blank, DELETE the "Design / Figma" section; if {{REVIEW_BOT}} is blank, DELETE the
"Merge / review infra" review-bot bullet (and the whole section if you also have no
Mergify). -->

## What this is
{{PROJECT_NAME}} — {{PROJECT_TAGLINE}}. Built largely by AI coding agents through reviewed, squash-merged PRs.

## Status
**Status: fill per product** (e.g. "in design — pre-code; no `package.json`, build, or CI app checks yet"). This is the lifecycle fact for *this* repo. Build/test/run commands don't exist until they're added to `AGENTS.md` → "Working in the tree"; until then, agents must not claim them (the tool-agnostic rule is `AGENTS.md` → "Agent guardrails" → anti-invention).

## Repo identity
Local folder `{{LOCAL_FOLDER}}/`; GitHub slug `{{OWNER}}/{{REPO}}` — they may differ, so pass the slug to `gh`. Default branch `{{DEFAULT_BRANCH}}`.

## Design / Figma (OPTIONAL — delete this whole section if {{FIGMA_FILE_ID}} is blank)

`DESIGN.md` is the source of truth for design (see AGENTS.md → "Design source of truth" for the authority ranking). The instance facts about *this product's* Figma file live here.

The design system lives in Figma (file `{{FIGMA_FILE_ID}}`). Read it via the Figma MCP **read tools only** — `get_metadata`, `get_design_context`, `get_screenshot`, `get_variable_defs`, `get_code_connect_map`, `get_libraries`, `search_design_system`, `whoami`. **Never** call a write tool (`use_figma`, `create_new_file`, `generate_figma_design`, `generate_diagram`, `upload_assets`, `add_code_connect_map`): agents read Figma; a human edits it.

**Authority:** shipped build > `DESIGN.md` > Figma. `DESIGN.md` wins on any design conflict; a live Figma value that disagrees with it does **not** bind the build — it's *drift to reconcile into `DESIGN.md` in a PR*. Never build straight from a live Figma node, and don't paste its raw hexes/Tailwind — translate to `DESIGN.md` tokens. The two do not auto-sync.

**Flow:** for a known node call `get_design_context` directly; for a large/unknown subtree call `get_metadata(<node>)` first to scope, then `get_design_context`; use `get_screenshot` for visual reference. A URL's `?node-id=<n-n>` is the tool's `nodeId: <n:n>` (hyphen → colon).

**Node map** — *per-product node map goes here*: list this product's Figma pages and screens with their node-ids (URL form `https://figma.com/design/{{FIGMA_FILE_ID}}/?node-id=<n-n>`). Node-ids are drift-prone (a frame rename/reorder can renumber them) — the AGENTS.md Update-Triggers row, not the ids, is the safety net. If live Variable reads and Code Connect are unavailable on this Figma plan (`get_variable_defs` → `{}`), treat Figma as visual reference, not a token feed.

## Merge / review infra (OPTIONAL — trim to what this repo actually uses)
- **Mergify** (`.mergify.yml`): an approved PR squash-merges through the queue via a standalone `@Mergifyio queue` comment. The merge *method* and its invariants are process — see `.claude/skills/pr-workflow/SKILL.md` and the user-level `mergify-merge-workflow` skill. *(Delete this bullet if the repo does not use Mergify.)*
- **`@{{REVIEW_BOT}}` is the sole non-author reviewer** *(OPTIONAL — delete this bullet if {{REVIEW_BOT}} is blank)*. Direct push to `{{DEFAULT_BRANCH}}` is blocked by a GitHub ruleset requiring 1 fresh approving review per HEAD from a non-author collaborator; the owner (`@{{CODEOWNER}}`, the lone code owner in `.github/CODEOWNERS`) authors PRs and can't self-approve, so `@{{REVIEW_BOT}}` — the only other collaborator — is what unblocks merge.
