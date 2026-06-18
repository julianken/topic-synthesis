---
name: issue-authoring
description: Use when opening or rewriting an implementation issue or plan spec on {{OWNER}}/{{REPO}}. Triggers on "create issue", "write the issue", "issue spec", "implementation plan issue", or batch prep/planning work. Self-contained for worktree dispatch.
---

# Issue authoring ({{OWNER}}/{{REPO}})

**Announce at start:** *"I'm using the issue-authoring skill to draft an implementation-ready issue spec."*

GitHub slug: `{{OWNER}}/{{REPO}}`. After the issue is posted, **dispatch `issue-plan-review`** — the author must not self-approve in the same pass.

## Quality bar vs anti-pattern

| | Good | Bad |
| --- | --- | --- |
| Context | Grounded in **current repo facts** with links to committed files | Vague program-phase labels + `research/*.md` paths **not on `{{DEFAULT_BRANCH}}`** |
| Approach | Explains *why* this shape; names alternatives rejected | Jumps straight to bullet lists |
| Plan | Numbered steps or matrix; right-sized for solo pre-code repo | Thin Scope In/Out with no rationale |
| ACs | Atomic, independently verifiable | Bundled checkboxes ("find PR method" = many files) |
| Dependencies | Explicit dependency IDs from your tracker; clear Blocks | Vague "issues for skills" without concrete IDs |
| Review | Fresh-context plan review before implementation | Batch `gh issue create` + immediate rubber-stamp |

## Required issue body sections

Use these headers (adapt titles slightly if needed; keep the information):

### 1. Context & goal

- Who/what triggered this; link the program/plan doc (a committed `docs/plans/<plan>.md`, if the repo has one) for program context **or** a prior issue — never local-only paths.
- The **issue body is the spec** — do not assume a parallel committed copy under `docs/plans/issues/`.
- State constraints from `AGENTS.md` / `GAPS.md` that bind the work.
- One paragraph **goal** — outcome, not task list.

### 2. Approach

- Why this decomposition; what you are **not** duplicating (no second SoT).
- Right-sizing for pre-code / solo / agent-built context.

### 3. Concrete plan

Numbered steps or Scope **In** / **Out** with **rationale per bucket**. Cite real paths (`AGENTS.md`, `.claude/skills/…`) — verify they exist on `{{DEFAULT_BRANCH}}` **this turn** (`Read` / `ls`).

### 4. Acceptance criteria

- Each AC **one verifiable fact** — reviewer can check pass/fail without judgment calls.
- Split bundled ACs (e.g. "skill discovered" vs "skill content complete" are separate).
- Include doc-currency / `check-claude-shim.sh` when touching `AGENTS.md` or `CLAUDE.md`.

### 5. Depends on / Blocks

- Use concrete dependency IDs from your tracker.
- **Blocks** must name specific IDs, not categories.

## Workflow

```
1. Read current tree + any committed plan doc
2. Draft issue using sections above
3. gh issue create (or edit) — one issue at a time unless independent
4. Dispatch issue-plan-review — never self-approve in author pass
5. Fix from REQUEST_CHANGES; re-dispatch plan review
```

## Tripwires

- **Never cite `research/` or other uncommitted paths** — paste load-bearing context into the issue body, or commit a program doc under `docs/plans/` first (overview only, not per-issue duplicates).
- **Never batch-create issues from a script** without per-issue tree verification and a plan review each.
- **Never skip Approach** — if you cannot explain why, the issue is not ready.
- **Never reference a program-phase label alone** — link the committed plan doc (or the specific plan section).

## Program doc

If the repo has a committed program/plan doc under `docs/plans/`, link it here — it carries the dependency graph and the portable plan IDs the issues reference. (No program doc yet → ground the issue in committed repo facts and a prior issue instead.)
