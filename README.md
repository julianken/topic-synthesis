# agentic-seed

A **template for agentic repositories** — repos built largely by AI coding agents through reviewed, squash-merged PRs. It carries the process scaffolding (how agents work, how PRs get reviewed and merged, how docs are kept from drifting) with the product-specific content stripped out and replaced by `{{PLACEHOLDERS}}`. Use it to stand up a new project that ships the same way, without re-deriving the conventions each time.

This repo is itself unfilled: files contain `{{PLACEHOLDERS}}` (e.g. `{{PROJECT_NAME}}`, `{{OWNER}}/{{REPO}}`) rather than a real product's values. A *filled instance* has every placeholder replaced. See [`START_HERE.md`](./START_HERE.md) for how to tell which state a repo is in.

## What's inside

- **[`AGENTS.md`](./AGENTS.md)** — the source of truth for process: commit/PR conventions, the review-before-merge rule, agent guardrails (untrusted-data handling, anti-slopsquatting, no rubber-stamping), the HIL/`AGENT:` comment model, and the Update-Triggers table that binds every change to keep its docs current. Portable across products.
- **[`INSTANCE.md`](./INSTANCE.md)** — fill-in template for the instance facts: product name/tagline, the `{{LOCAL_FOLDER}}` ↔ `{{OWNER}}/{{REPO}}` identity, and the two optional modules below.
- **[`DESIGN.md`](./DESIGN.md)** — a blank design source-of-truth skeleton (tokens, color, type, motion, components, accessibility). Wins on any design conflict once filled.
- **[`CLAUDE.md`](./CLAUDE.md)** — a thin Claude-Code shim that imports `AGENTS.md` (shape enforced by `scripts/check-claude-shim.sh`). `GEMINI.md` is the equivalent shim for that tool.
- **Skills** ([`.claude/skills/`](./.claude/skills/)) — the PR/review/merge knowledge: `project-bootstrap` (orient/validate an instance), `pr-workflow`, `creating-prs`, `reviewing`, `issue-authoring`, `issue-plan-review`.
- **PR template & CI** — [`.github/PULL_REQUEST_TEMPLATE.md`](./.github/PULL_REQUEST_TEMPLATE.md), `.github/` scaffolding-validation CI, and `scripts/` guards (`check-claude-shim.sh`, `validate-scaffolding.sh`).
- **Optional modules** — **Mergify** (`.mergify.yml`, queue-based squash-merge), the **review bot** (`{{REVIEW_BOT}}`), and **Figma** (`{{FIGMA_FILE_ID}}`). Each is disabled by leaving its placeholder blank; see `INSTANCE.md` for how each section is gated.
- **[`.seed/placeholders.json`](./.seed/placeholders.json)** — the authoritative glossary: every `{{PLACEHOLDER}}` the template uses, with a description and an illustrative example value.

## How to use it

1. On GitHub, click **Use this template** to create a new repo from this one.
2. Fill the placeholders — run the `project-bootstrap` skill in **fill** mode, or `scripts/fill-template.sh` — which reads [`.seed/placeholders.json`](./.seed/placeholders.json), prompts for each value, and substitutes every `{{PLACEHOLDER}}` across the tree.
3. Disable the modules you don't want by leaving their optional placeholders (`{{REVIEW_BOT}}`, `{{FIGMA_FILE_ID}}`) blank, then delete the sections `INSTANCE.md` marks OPTIONAL.
4. Replace this README with your product's own, fill `DESIGN.md`, and confirm `scripts/check-claude-shim.sh` and `scripts/validate-scaffolding.sh` pass.

## License

MIT — see [`LICENSE`](./LICENSE).
