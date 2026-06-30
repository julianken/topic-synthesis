---
name: creating-prs
description: Use when drafting a PR body or deciding what goes in the description on julianken/topic-synthesis. Triggers on "draft a PR description", "what should the PR body say", "fill the PR template", "PR body sections", or a PR that came back with template-shaped feedback. The generic five-section method, conventional-commit rules, and plan-reference discipline — bot-agnostic, no credentials. Self-contained for worktree dispatch.
---

# Creating PRs — the body method

**Announce at start:** *"I'm using the creating-prs skill to fill the five-section PR body."*

This skill owns the **generic method** for a PR body: the five-section shape, conventional commits, the plan/issue reference, and the screenshot policy. It is **bot-agnostic** — it carries no review-bot (`@julianken-bot`) credentials and no merge mechanics. Read it alongside `.claude/skills/pr-workflow/SKILL.md`, which holds the **instance facts** (the ruleset, the merge-queue slug, the doc-currency checkbox) and routes the review and merge steps. A cold-start agent that can read only `.claude/skills/` can describe and fill the PR body from this file alone, without opening the owner's user-level `~/.claude/skills/`.

## No-drift relationship

The generic method here mirrors the user-level `creating-prs` skill (shared across the owner's repos). This repo-local copy is the canonical one for `julianken/topic-synthesis`; the user-level skill is the portable overlay. Per `AGENTS.md` → **Skill ownership** "No-drift rule": a change to either copy must update the other in the **same PR**, and the PR Summary must say so. On conflict, the repo-local copy wins for anything instance-specific; the user-level skill wins for the portable method itself.

## The five-section body

`.github/PULL_REQUEST_TEMPLATE.md` is the authority for the exact section bodies and checkboxes — paste it and fill it, don't reinvent it here. GitHub does **not** inject the template on API-created PRs, so with `gh pr create --body` you paste the template yourself and fill every section. Never let `gh` open a blank web-template PR; never drop a header to save tokens. Use `N/A — <reason>` where a section genuinely doesn't apply; never delete a header. The five sections, in order:

1. **Diagrams** — a Mermaid diagram (or several) showing the shape of the change: data flow, sequence, state machine, component tree, token/theme graph, route map. It is the **primary comprehension surface** for the reviewer — when present, the reviewer grasps shape in one pass and spends its budget on the diff. For a change that genuinely can't be diagrammed (one-line typo, dep bump, comment-only doc edit) write `N/A — <reason>`. A ` ```mermaid ` block that fails to parse renders as raw source on github.com — so **validate before posting** (the mechanical step below), and if a block fails, fix it (wrap a label containing punctuation in `"…"` — the common fix) before re-running.

   **Validate the body before posting (mechanical — do this every PR with a diagram).** Write the finished PR body to a file and render its mermaid with the shared renderer, then fix any non-zero exit *before* `gh pr create`:

   ```bash
   gh_body="$(mktemp)"; cat > "$gh_body" <<'EOF'
   …your filled five-section PR body…
   EOF
   bash scripts/check-mermaid.sh "$gh_body"   # exit 0 = all blocks render (or none); 1 = a block failed (fix it); 2 = toolchain/usage
   ```

   The script extracts every column-0 ` ```mermaid ` block and renders it via `npx … mmdc`; a non-empty SVG is the success signal (`mmdc -q` exits 0 even on a parse error, so exit code alone lies). This is the **proactive** author-side gate — the bot's R15 render check is reactive (it fires on the already-posted body), so by the time it catches a broken block it is already a github.com syntax error. A `Diagrams: N/A — <reason>` body has zero blocks and exits 0 (extract-before-render — no mmdc spawn), so running it costs nothing.
2. **Summary** — 1–3 bullets supporting the diagram. Lead with the **why**; the diagram already shows the *what*. Long prose makes the reviewer parse instead of review.
3. **Screenshots** — **REQUIRED** when the diff adds or modifies visible UI; otherwise `N/A — not UI`. Never commit PNGs and never use `raw.githubusercontent.com/<repo>/<branch>/...` URLs (they 404 once the branch is deleted on merge); use the user-attachments paste flow (the screenshot procedure is owned by `pr-workflow` → "Screenshots — never committed" and the user-level `pr-screenshots-via-user-attachments` skill). Test-only, type-only, comment-only changes under a UI directory use `N/A — not UI` — the diff is what matters, not the path. Pre-code there is no running UI yet, so this is `N/A — not UI` until a UI exists.

   _The screenshot toolchain (chrome-devtools paste flow) is an optional module — a consumer with no UI surface, or no browser-automation MCP, can skip it; the rule "never commit PNGs" still holds._
4. **Test plan** — the checklist of verifications you actually ran, with each box ticked or `N/A — <reason>`. This carries the **doc-currency checkbox** — see "Doc-currency" below. State the manual checks you ran (e.g. `scripts/check-claude-shim.sh` output, `ls`/grep confirmation of new files), not aspirational ones. Don't invent stack commands the repo doesn't have yet (pre-code: `npm run …` lines are `N/A — not configured` until a `package.json` lands).
5. **Plan / issue reference** — link the issue and/or `docs/plans/` task this PR implements, or write `Out of plan — <one-line reason>`; never leave it blank. Include `Closes #<issue>` so the merge auto-closes the issue. This is the bidirectional traceability link the reviewer uses to confirm the PR implements exactly the planned task — no scope creep, no skipped prereqs.

## Conventional commits

Conventional-Commit subject on every commit — `feat(scope):`, `fix:`, `chore:`, `docs:`, `test(scope):`, `refactor:`, etc. The body explains **why**, not what (the diff shows the what). No git trailer is configured, so append `Co-Authored-By: <model> <noreply@anthropic.com>` by hand, matching the authoring model. Don't recap the diff in the commit message.

## Doc-currency (before opening)

Before opening the PR, update — **in the same PR** — every drift-prone file your change affects, per the **Update Triggers table in `AGENTS.md`** (the source of truth for which file maps to which kind of change; don't carry a second copy of that mapping here). `DESIGN.md` wins on any design conflict. If `CLAUDE.md` or `AGENTS.md` changed, run `scripts/check-claude-shim.sh` and confirm it passes. If nothing applies, write `No doc updates needed` in the Summary. Tick the Test-plan doc-currency box (or `N/A — <reason>`), listing the docs you updated. A missed doc is an IMPORTANT finding **with an escape hatch — not a merge blocker** (see `pr-workflow`).

## What this skill does NOT own

- **The review** — dispatch a fresh-context reviewer; the rubric is `.claude/skills/reviewing/SKILL.md`. The bot identity (`@julianken-bot`) + credentials are an **optional module** — the user-level `reviewing-as-julianken-bot` skill (`docs/optional/review-bot.md` is the adopt-or-skip explainer, which points back at that overlay); blanking `julianken-bot` disables it and a human reviewer applies the rubric directly. Never `gh pr review` from the main session — that posts as the owner (`@julianken`) and can't satisfy the per-HEAD ruleset. (`pr-workflow` rule 2.)
- **The merge** — the merge-queue trigger as a standalone exact-body comment; never `gh pr merge`. (`pr-workflow` rule, user-level `mergify-merge-workflow`.) Mergify is an **optional module** — `docs/optional/mergify.md` is the adopt-or-skip explainer.
- **The instance facts** — the ruleset, the merge-queue slug, the `gh` repo slug: `.claude/skills/pr-workflow/SKILL.md` and `INSTANCE.md`.

## Tripwires

- **Never post a PR body with an unvalidated mermaid block.** Write the body to a file and run `bash scripts/check-mermaid.sh <file>` before `gh pr create`; a non-zero exit means a block is broken (or the toolchain is missing) — fix it first. A `Diagrams: N/A` body has no blocks and passes trivially. Don't rely on the bot's R15 to catch it — that's reactive, after the broken diagram is already live on github.com.
- **Never delete or skip a template section.** Use `N/A — <reason>`; a deleted header forces a review round-trip.
- **Never leave the Plan / issue reference blank.** Link the issue/plan or write `Out of plan — <reason>`; include `Closes #<issue>`.
- **Never `Screenshots: N/A — not UI` on a PR that changes visible UI.** Real UI changes never use `N/A`, even on a small diff.
- **Never invent a stack command** the repo doesn't have yet — pre-code, `npm run …` lines are `N/A — not configured`, not green checkmarks.
- **Never review from the main session.** Opening the PR is this skill; the review is a separate dispatched pass under a different identity (`reviewing` + the bot skill).
