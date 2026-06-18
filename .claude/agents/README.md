# `.claude/agents/` — Subagent index for `{{OWNER}}/{{REPO}}`

This directory holds repo-specific subagents for `{{OWNER}}/{{REPO}}` (local folder
`{{LOCAL_FOLDER}}/`). Agents placed here are dispatchable via the `Task` tool from a
session running at the repo root. The slug/folder are restated here on purpose —
worktree-isolated dispatches don't load `AGENTS.md`/`INSTANCE.md`; the canonical
catalogue of instance facts (product, slug, design file, merge/review infra) is
`INSTANCE.md`.

## Agents

**The seed ships with no agents.** Agents are opt-in: this index is empty until you
add one. Add a row to the table below as you create each agent file.

| Agent | Purpose | When to dispatch |
|---|---|---|
| _(none yet)_ | — | — |

The most common agent to add first is an **optional review bot** that posts the
gating PR verdict under a machine-user identity. That module — whether to adopt it,
the credential split, and how the bot loads its token — is documented in
[`docs/optional/review-bot.md`](../../docs/optional/review-bot.md). The **review
content** (the anti-slop rubric) is bot-agnostic and lives in
[`.claude/skills/reviewing/SKILL.md`](../../.claude/skills/reviewing/SKILL.md),
which carries no credentials; an agent file here would only wire dispatch + identity,
not restate that rubric. Blanking `{{REVIEW_BOT}}` disables the review-bot module.

## How a skill or session dispatches an agent

```
Task tool, subagent_type: <agent-name>
Prompt: <minimal context only — PR or issue number, repo slug, working directory>
```

The subagent runs in its own context window; control returns to the parent session
for follow-up. A skill that needs a pass references the agent by name and dispatches
it the same way — it does **not** inline the agent's checklist.

## Conventions

- **Hard constraints live in the agent body, not in CLAUDE.md/AGENTS.md.**
  Worktree-isolated dispatches do **not** load CLAUDE.md or AGENTS.md, so any
  non-negotiable rule must be restated in the agent file or the repo skill it loads.
- **`tools:` is a least-privilege allowlist** — start strict; expand only on observed need.
- **`DESIGN.md` (and AGENTS.md) stay the source of truth.** Agents reference them by
  section — they never restate or fork specs into their own body.
- **Reviewer agents post gated verdicts; non-review agents report only.** A reporting
  agent (e.g. a design pass) does not approve PRs; only the review-bot identity posts
  the gating verdict, per the routed skill.

## Adding agents

1. One agent per file: filename = `<name>.md`, matching frontmatter `name`.
2. Required frontmatter: `name`; `description` (trigger-rich, ≥1 `<example>`); `tools`; `model`; `skills` when a repo skill loads.
3. Self-contained body — restate hard constraints for worktree dispatch.
4. **Add a row to the Agents table above** (replace the `(none yet)` placeholder row).
5. Point at skills / `AGENTS.md` sections instead of duplicating process docs.

Once a third agent lands, a `_patterns.md` crosswalk may earn its place — not before.
