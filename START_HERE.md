# START HERE

Entry card for a fresh agent or human session. Read this first, then follow the ordered list below to orient before doing any work.

## Is this an unfilled template or a filled instance?

This repo can be in one of two states, and they differ only in *content*, never in *process shape* (which always lives in `AGENTS.md`):

- **Unfilled template** — files still contain `{{PLACEHOLDERS}}` (e.g. `Topic Synthesis`, `julianken/topic-synthesis`). It is a reusable scaffold, not a product yet. To stand up a product, **fill** the placeholders from [`.seed/placeholders.json`](.seed/placeholders.json) (project-bootstrap fill-mode, or `scripts/fill-template.sh`).
- **Filled instance** — every placeholder has been replaced with a real product's values (`INSTANCE.md`, `DESIGN.md`, and the domain docs carry concrete content). To work here, **validate** that the instance is coherent — files exist, pointers resolve, no contradictions with `DESIGN.md` — and do *not* re-run fill-mode.

Quick check: if `grep -r '{{' INSTANCE.md DESIGN.md` finds placeholders, you are in an unfilled template; otherwise it's a filled instance.

## Ordered read list

Read these in order; each says what it is the source of truth for.

1. **[`INSTANCE.md`](INSTANCE.md)** — *instance facts*: which product, the local-folder-vs-`gh`-slug identity (`topic-synthesis/` ↔ `julianken/topic-synthesis`), the optional Figma file + node map, and the optional Mergify/review infra. Go here first for "what repo is this and how does it ship."
2. **[`AGENTS.md`](AGENTS.md)** — *process* (portable across products): conventions, review dispatch, the Update Triggers table for keeping docs current, agent guardrails, the HIL/`AGENT:` comment rules.
3. **[`DESIGN.md`](DESIGN.md)** — *design source of truth*; **wins on any design conflict**. Token manifest (§0), color, type, motion, components, accessibility. Read before any UI, token, or motion work. (In an unfilled template this is a blank skeleton to fill per product.)
4. **Skills index** — [`.claude/skills/`](.claude/skills/): `project-bootstrap` (orient/validate or fill this instance), `pr-workflow` (instance facts + routing for open/review/merge), `creating-prs` (the five-section PR-body method) + `reviewing` (the bot-agnostic anti-slop review rubric), `issue-authoring` + `issue-plan-review` (spec a change, gate it before coding).

`CLAUDE.md` is a thin Claude-Code shim that imports `AGENTS.md`; read `AGENTS.md` for the binding rules.

## Bootstrap

To run the orientation checklist, use **[`.claude/skills/project-bootstrap/SKILL.md`](.claude/skills/project-bootstrap/SKILL.md)** — it documents validate vs fill modes and the validate checklist (paths exist, Update Triggers honored, no invented stack commands, no `DESIGN.md` contradictions).
