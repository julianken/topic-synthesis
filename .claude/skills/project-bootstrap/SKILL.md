---
name: project-bootstrap
description: Use when a fresh agent or human session needs to orient in this repo before doing work — confirm the instance is coherent (paths exist, pointers resolve, no contradictions with DESIGN.md), or stand up a new product by filling the template's placeholders. Triggers on "bootstrap", "orient in this repo", "where do I start", "validate the instance", "is this repo coherent", "get my bearings", "fill the template", "fill mode", "stand up a new product". Self-contained for worktree dispatch.
---

# Project bootstrap (julianken/topic-synthesis)

**Announce at start:** *"I'm using the project-bootstrap skill to orient in this repo (\<validate|fill\> mode)."*

The orientation checklist a session runs to confirm this repo is coherent before working in it, **and** the fill procedure that stamps a fresh product out of the unfilled template. The human/agent entry card is [`START_HERE.md`](../../../START_HERE.md); this skill is the checklist/procedure it points to. Read [`INSTANCE.md`](../../../INSTANCE.md) for instance facts (product, `gh` slug, optional Figma file, optional merge/review infra) and [`AGENTS.md`](../../../AGENTS.md) for process; this skill does not restate either.

## Modes

This repo is a **template** that can be in one of two states, distinguished by *content only* (the process shape always lives in `AGENTS.md`). Bootstrapping runs in one of two modes; pick by state:

| Mode | When | What it does | Status |
| --- | --- | --- | --- |
| **fill** | Unfilled template — files still contain `{{PLACEHOLDERS}}` | Substitute every placeholder (`Topic Synthesis`, `julianken/topic-synthesis`, optional `FIGMA_FILE_ID`/`julianken-bot`, …) from `.seed/placeholders.json` to stand up a new product from the scaffold. | **Implemented** — driver is [`scripts/fill-template.sh`](../../../scripts/fill-template.sh). |
| **validate** | Filled instance — every placeholder has a real value | Audit that the instance is coherent — files exist, pointers resolve, no contradictions with `DESIGN.md`. **Never** wipes or rewrites domain content. | **Implemented (this skill).** |

**Which mode am I in?** Run `grep -rl '{{' INSTANCE.md DESIGN.md README.md 2>/dev/null`. If it finds placeholders, you are in an **unfilled template** → run **fill**. If it finds none, you are in a **filled instance** → run **validate**. Do **not** re-run fill on an already-filled instance (it would have nothing to substitute and risks clobbering domain content).

## Fill mode

Fill stamps the template into a concrete product by replacing every `{{PLACEHOLDER}}` across the tracked text files. The authoritative glossary of placeholders is [`.seed/placeholders.json`](../../../.seed/placeholders.json) — every `{{KEY}}` that appears anywhere in the tree is declared there with a description and an illustrative `example`.

**Driver:** [`scripts/fill-template.sh`](../../../scripts/fill-template.sh) does the mechanical substitution and the safety checks. Don't hand-edit files placeholder-by-placeholder — run the script so the "no token left behind" verification runs too.

### Fill workflow

1. **Read the glossary.** Open [`.seed/placeholders.json`](../../../.seed/placeholders.json) and note which placeholders are **required** and which are **optional** (`"optional": true` — currently `julianken-bot` and `FIGMA_FILE_ID`). An optional placeholder left blank **disables its module** (the review bot / the Figma design source); the sections those modules own are marked OPTIONAL in `INSTANCE.md` and are deleted when blanked.
2. **Gather values.** Provide a value for every required placeholder. The script reads them from `.seed/answers.json` (a flat `{"KEY": "value", …}` map). Copy [`.seed/answers.example.json`](../../../.seed/answers.example.json) to `.seed/answers.json` and edit it, or assemble your own. If `.seed/answers.json` is absent, the script prints exactly which placeholders it needs and exits non-zero — it never guesses.
3. **Substitute.** Run `bash scripts/fill-template.sh`. It substitutes every `{{KEY}}` across tracked text files, **excluding** `.git/`, `.seed/`, `tmp/`, and `.remember/` (so the glossary, the answers, and scratch state are never rewritten). Optional placeholders left blank are blanked in place with a warning, so their clearly-marked OPTIONAL sections become deletable.
4. **Verify nothing remains.** The script **fails** if any required placeholder was unset or any `{{…}}` token survives the pass — a green run means the tree is fully stamped. (Re-run after fixing `.seed/answers.json` if it fails.)
5. **Reset README / DESIGN per product.** The template `README.md` describes *the template itself*; replace it with the new product's README. `DESIGN.md` is a blank stub (`§0 Token Manifest` + color/type/motion/components/accessibility headings, each "Fill per product") — fill it as the design source of truth before any UI work. Fill `INSTANCE.md` → "Status" with the lifecycle fact for the new repo, and delete the OPTIONAL `INSTANCE.md` sections whose placeholder you left blank.
6. **Validate the result.** Run `bash scripts/check-claude-shim.sh` and `bash scripts/validate-scaffolding.sh`; both must pass. Then run **validate mode** (below) against the now-filled instance to confirm coherence.

> **Do not run fill on a filled instance.** Fill is for the unfilled template only. On a filled instance there are no `{{PLACEHOLDERS}}` to substitute, and re-running risks clobbering real domain content — use **validate** instead.

## Validate checklist

Run top-to-bottom against the **live tree** (`git status` / `ls` — don't trust a snapshot). Each item is mechanically checkable; if any fails, the instance is not coherent — report it, don't silently proceed.

1. **No unfilled placeholders.** `grep -rl '{{' INSTANCE.md DESIGN.md README.md` finds none. (If it does, the instance was never filled — switch to fill mode, don't validate.)
2. **Entry + orientation files exist.** `START_HERE.md`, `INSTANCE.md`, `AGENTS.md`, `DESIGN.md`, `CLAUDE.md`, and this skill are all present at their cited paths.
3. **Cross-pointers resolve.** Every path `START_HERE.md` links (`INSTANCE.md`, `AGENTS.md`, `DESIGN.md`, `.claude/skills/`, `.seed/placeholders.json`) and every path this skill links resolves to a real file/dir. No dead link.
4. **Instance facts present in `INSTANCE.md`.** It names the product, the local-folder-vs-`gh`-slug identity, and — where those optional modules are enabled — the Figma file id + node map and the Mergify/review infra. (It is the catalogue of instance facts; `AGENTS.md` stays process-only.)
5. **Update Triggers honored.** `AGENTS.md` carries the "Keeping docs and drift-prone files current" table; if your change touches anything it lists, you update the matching doc in the same PR (the table is the source of truth for which file maps to which change).
6. **No invented stack commands.** Confirm the lifecycle phase in `INSTANCE.md` → "Status". A fresh instance is pre-code — there is no `package.json`, build, or test command. Do **not** cite or run `npm`/build/test commands the repo doesn't have; `README.md` and `AGENTS.md` say build/run commands get added *when they exist*, not ahead of time (the binding rule is `AGENTS.md` → "Agent guardrails" → anti-invention).
7. **No contradictions with `DESIGN.md`.** `DESIGN.md` wins on any design conflict (`AGENTS.md` → "Design source of truth"). Confirm the `DESIGN.md` section anchors this checklist relies on actually resolve — they are real top-level sections, so a reference to them is well-founded, not a phantom anchor. **These anchors must resolve (lower bound):**
   - **§0 Token Manifest** — the authoritative source for every value, and where a live Figma value that disagrees gets reconciled as drift.
   - **Motion** — the motion source of truth any motion/transition work must match.
   - **Components** + **Accessibility** — the per-product component anatomy and the correctness rules the design depends on.

   The blank-stub `DESIGN.md` ships these headings already; a filled instance keeps them (possibly renumbered/renamed per product). If any listed anchor does not resolve in `DESIGN.md` (e.g. a renumber moved it), that is a contradiction to report and reconcile — update either `DESIGN.md` or this list in the same PR, per the Update Triggers table.

A pass means: all seven items hold and the cited anchors resolve. Report a one-line pass/fail per item; on any fail, name the file and what's wrong.

## Scope

- **Fill stamps; validate audits.** Fill mode substitutes placeholders (driven by `scripts/fill-template.sh`) to stand up a product; validate mode audits an already-filled instance and **does not** mutate domain content. Never run fill against a filled instance.
- **Don't duplicate.** This skill does not restate `INSTANCE.md`, `AGENTS.md`, or `DESIGN.md` content — it points to them. `START_HERE.md` is the entry that links here; `AGENTS.md` is not expanded with bootstrap prose.
