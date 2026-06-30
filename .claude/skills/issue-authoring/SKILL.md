---
name: issue-authoring
description: Use when opening or rewriting an implementation issue or plan spec on julianken/topic-synthesis. Triggers on "create issue", "write the issue", "issue spec", "implementation plan issue", or batch prep/planning work. Self-contained for worktree dispatch.
---

# Issue authoring (julianken/topic-synthesis)

**Announce at start:** *"I'm using the issue-authoring skill to draft an implementation-ready issue spec."*

GitHub slug: `julianken/topic-synthesis`. After the issue is posted, **dispatch `issue-plan-review`** — the author must not self-approve in the same pass.

## Quality bar vs anti-pattern

| | Good | Bad |
| --- | --- | --- |
| Context | Grounded in **current repo facts** with links to committed files | Vague program-phase labels + `research/*.md` paths **not on `main`** |
| Approach | Explains *why* this shape; names alternatives rejected | Jumps straight to bullet lists |
| Plan | Numbered steps or matrix; right-sized for solo pre-code repo | Thin Scope In/Out with no rationale |
| ACs | Atomic, independently verifiable | Bundled checkboxes ("find PR method" = many files) |
| Dependencies | Explicit dependency IDs from your tracker; clear Blocks | Vague "issues for skills" without concrete IDs |
| Review | Fresh-context plan review before implementation | Batch `gh issue create` + immediate rubber-stamp |
| Figma (frontend) | Frame authored/updated design-first + pre-code-gated at the issue stage; node-id(s) cited | A surface-changing issue with no Figma frame, no gate, and no carve-out |

## Required issue body sections

Use these headers (adapt titles slightly if needed; keep the information):

### 1. Context & goal

- Who/what triggered this; link the program/plan doc (a committed `docs/plans/<plan>.md`, if the repo has one) for program context **or** a prior issue — never local-only paths.
- The **issue body is the spec** — do not assume a parallel committed copy under `docs/plans/issues/`.
- State constraints from `AGENTS.md` / `GAPS.md` that bind the work.
- One paragraph **goal** — outcome, not task list.

### 1a. Figma design (FRONTEND issues — REQUIRED; non-visual issues write `N/A — non-visual`)

For an issue that changes a rendered surface (a UI route/page, a component's rendered output, layout/geometry, motion, or structural user-facing copy a frame depicts), author the design FIRST, at the issue stage — the issue carries the visual design the PR implements to:

- **Author/update the frame(s)** in the design-SoT Figma file `upjG7gfzlkdojb8LLOwu6T` via the Figma MCP write tools (`use_figma` / `generate_figma_design` / `create_new_file` / `upload_assets`; method owned by the `figma-generate-design` skill). NET-NEW surface with no frame yet → author a NEW frame. ALREADY-SHIPPED surface → UPDATE its existing frame to the new intent.
- **Gate it pre-code:** dispatch a fresh-context reviewer with `.claude/skills/reviewing-figma-designs/SKILL.md` (you authored the frame, so the separation rule forbids self-gating in the same pass). It writes a `Figma-Design-Verdict: APPROVE|REQUEST_CHANGES` file; iterate to APPROVE.
- **Reference it here:** name the frame node-id(s) + the state of each (new / updated) + the gate verdict — e.g. "Generating `1:2` (updated, topic header); pre-code Figma gate: APPROVE." The PR will IMPLEMENT TO these frames and reconcile back into Figma only if the build diverges.

**Carve-outs** — write the literal phrase in this section *instead of* a frame when one applies (the plan-review gate accepts each; none is REQUEST_CHANGES):
- `N/A — non-visual` — the issue changes no rendered surface (backend / pipeline / domain / store / engine / telemetry / infra / test-only / a non-visual refactor).
- `N/A — de-minimis, no perceptible delta` — a microcopy or one-line-CSS tweak with no perceptible layout/visual change (the AGENTS.md de-minimis escape, applied at the issue stage).
- `Figma update deferred — no MCP write access` — the authoring dispatch lacks Figma MCP write tools; defer the frame and open a `drift:docs` follow-up (never silently skip), and the build PR catches it up.

Authority is unchanged: shipped build > `DESIGN.md` > Figma; only DESIGN.md §0 is CI-guarded — the frame is the picture of the target, §0 holds the token values.

### 2. Approach

- Why this decomposition; what you are **not** duplicating (no second SoT).
- Right-sizing for pre-code / solo / agent-built context.

### 3. Concrete plan

Numbered steps or Scope **In** / **Out** with **rationale per bucket**. Cite real paths (`AGENTS.md`, `.claude/skills/…`) — verify they exist on `main` **this turn** (`Read` / `ls`).

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
2. (FRONTEND) Author/update the matching Figma frame(s) via the MCP write tools (design-first); dispatch reviewing-figma-designs (fresh context) for the pre-code Figma gate; iterate to APPROVE
3. Draft issue using sections above — reference the frame node-id(s) + gate verdict in the §1a Figma design section
4. gh issue create (or edit) — one issue at a time unless independent
5. Dispatch issue-plan-review — never self-approve in author pass
6. Fix from REQUEST_CHANGES; re-dispatch plan review
```

## Tripwires

- **Never cite `research/` or other uncommitted paths** — paste load-bearing context into the issue body, or commit a program doc under `docs/plans/` first (overview only, not per-issue duplicates).
- **Never batch-create issues from a script** without per-issue tree verification and a plan review each.
- **Never skip Approach** — if you cannot explain why, the issue is not ready.
- **Never reference a program-phase label alone** — link the committed plan doc (or the specific plan section).
- **Never open a FRONTEND issue without the §1a Figma design section** — author/update the matching frame design-first, gate it pre-code (`reviewing-figma-designs`), and cite the node-id(s); a non-visual issue writes `N/A — non-visual` (or the de-minimis / capability-gap-deferral carve-out).

## Program doc

If the repo has a committed program/plan doc under `docs/plans/`, link it here — it carries the dependency graph and the portable plan IDs the issues reference. (No program doc yet → ground the issue in committed repo facts and a prior issue instead.)
