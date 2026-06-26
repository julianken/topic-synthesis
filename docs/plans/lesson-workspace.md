# Plan — The v11 lesson-workspace epic

> **Status: DRAFT / proposed (2026-06-25).** Goal-state below; nothing here is built. The binding
> architecture decision (the *why* + the as-built calls) is
> [`docs/decisions/0004-lesson-workspace.md`](../decisions/0004-lesson-workspace.md), which is
> **Accepted** (the direction is adopted; spike-gated/owner-confirmable items flagged provisional
> inline). This program doc stays DRAFT until these PRs land. It is the **program view + dependency graph**, not a second
> copy of the per-issue specs — each GitHub issue body (TS-1…TS-26) is the spec, authored to the
> five-section `issue-authoring` shape. Read ADR-0004 for the architecture; read the issues for
> per-PR detail.

## Goal

Turn the deployed single lesson from a generic interactive blob into the **locked v11 teaching workspace** — a densified two-column prose-spine + apparatus-panel lesson with predict-gate interactives — and frame it in the redesigned chrome (library home, reader shell, card→reader morph, OKLCH retoken, stage-rail generating view). The lesson stays **one self-contained inline-only HTML document in the opaque-origin sandbox** throughout; new behavior lands as a new port adapter / `workflow_version` arm, never by mutating a default in place or relaxing the trust boundary. See **ADR-0004** for *why* this shape — and for the thirteen locked decisions and the open-question resolutions this program implements.

The terminal acceptance is an explicit **code-owner `HIL:` visual-acceptance gate** (ADR-0004 decision 10 / TS-25), not "24 green issues." Green issues are necessary, not sufficient: the graded critic certifies per-lesson teaching-quality + static structure; the owner certifies mock-fidelity the critic is honestly scoped *not* to be able to prove.

## Context

**Now (verified on `main`, commit `2a69326`):** live + deployed on GCP, single-lesson (ADR-0003). The chrome is the walking-skeleton (intake-form home, spinner + per-step **text** timeline, lesson = generated HTML in a sandboxed iframe with no reader shell/apparatus/morph); `globals.css` materializes the original `## 0` hex tokens. In the pipeline, `spec→code` has never been told about v11; the critic is a binary `{passed, critique}` pass with **zero pedagogy/layout scoring**; `judgeBrief` is eval-only and ungated.

**The captured vision (the gap):** a locked v11 direction in `.superpowers/` mocks + the read-only Figma reference (file `upjG7gfzlkdojb8LLOwu6T`, #74). Two pieces are already on `main` — the DESIGN.md `## Lesson layout` section (#73) and the Figma node map (#74). The two pipeline reframes (typed sectioned `LessonSpec` + a pedagogy critic) and the whole chrome redesign were otherwise **UNTRACKED** before this epic.

**The organizing insight:** the generated lesson is a **PIPELINE problem** (a contract + prompt + critic change, produced *inside* the sandboxed HTML), while the chrome is a **frontend problem** (it frames the iframe; it can't make a lesson look like the mock). A beautiful frame around a vapid lesson is explicitly not the vision — so the pipeline work outranks and precedes the chrome.

## Phases (ordered) + sequencing rationale

**The spine is measure → produce → frame → motion**, because the dominant product risk is a vapid *generator* the binary critic can't detect — not a plain shell. We must be able to *detect* a generic lesson before we can credibly fix one, and the critic is the acceptance instrument every later phase leans on. Each phase ships independently: a graded critic that flags vapidity is valuable before v11 exists; v11 generation is valuable in today's plain iframe before the shell; the shell is valuable before the morph.

- **Phase 0 — Foundation (TS-1…TS-5):** convert the untracked vision into a forward ADR + this program doc, promote the ledger, resolve tokens, reconcile GAPS, **lock the cross-iframe mechanism (decision 12) and the canonical-surface stance (decision 11)** — and answer the biggest unknown the inputs under-gated: *can the model emit a v11-shaped workspace within the 32000-token cap at all?* (TS-5, a blocking spike). No runtime behavior change except the spike.
- **Phase 1 — MEASURE (TS-6…TS-9):** replace the binary critic with a graded rubric scoring teaching quality + statically-checkable ledger conformance, gate `built` on a threshold (arm-scoped — decision 3) on every live run, persist the sub-scores (migration named), and fold them into trace alongside `judgeBrief`. Calibrated fixture-first so a known-vapid fixture scores below threshold *before* any v11 generation leans on it.
- **Phase 2 — PRODUCE (TS-10…TS-15):** extend the Analysis→Synthesis seam to a typed sectioned `LessonSpec` + apparatus, teach `spec→code` the workspace layout (emitting `var()`-referencing inline-only HTML incl. the `[scrub]` track), **render the first real emission end-to-end early (TS-12b)**, land predict-gates, ship it as a new arm, A/B it against the blob, and **prove one real end-to-end lesson renders in the (still-unbuilt-chrome) iframe with owner sign-off** as the honesty checkpoint (TS-15). The contract precedes the prompts precedes an early *render* of the first emission precedes the critic that grades it precedes predict-gates precedes the arm precedes the checkpoint lesson.
- **Phase 3 — FRAME (TS-16…TS-20, TS-26):** build the chrome around the self-contained iframe — the `listLessons` store reader, the library home (FLIP origin), the OKLCH retoken + serve-time injection reaching old lessons, and the reader shell (FLIP destination, consuming the decision-12 mechanism). The store reader precedes the library, the library precedes the FLIP, the token decisions precede the retoken precede serve-injection.
- **Phase 4 — MOTION (TS-21…TS-25):** the signature card→reader container-transform (receiver-guarantee + instant-swap fallback + reduced-motion + owner sign-off), the stage-rail + ledger generating view on the existing step stream, the unified motion catalog, and the terminal owner visual-acceptance closeout. Motion is last — it animates real boxes that only exist after the shell.

## Dependency graph (dual form)

**Edges (`A → B` = A blocks B):**
```
TS-1 ─┬─▶ TS-2 ─▶ TS-3 ─▶ TS-5 ─▶ TS-10
      ├─▶ TS-3 (also direct)
      └─▶ TS-4
TS-2 ─▶ TS-6 ─▶ TS-7 ─▶ TS-8 ─▶ TS-9 ─▶ TS-10
TS-8 ─▶ TS-16                       (the migration is the binding node, not TS-9)
TS-10 ─▶ TS-11 ─▶ TS-12 ─▶ TS-12b ─▶ TS-13 ─▶ TS-14 ─▶ TS-15
TS-3 ─▶ TS-17 ;  TS-3 ─▶ TS-18
TS-16 ─▶ TS-17 ─▶ TS-26
TS-18 ─▶ TS-19 ;  TS-12 ─▶ TS-19
TS-19 ─▶ TS-20 ;  TS-15 ─▶ TS-20         (TS-15 includes its HIL owner sign-off)
TS-20 ─▶ TS-21 ;  TS-17 ─▶ TS-21 ─▶ TS-22
TS-20 ─▶ TS-23
TS-22 ─▶ TS-24 ;  TS-23 ─▶ TS-24 ─▶ TS-25
```

**ASCII blocks-tree (primary chains):**
```
TS-1 └─▶ TS-2 └─▶ TS-3 └─▶ TS-5 ┐
                  └─▶ TS-6 └─▶ TS-7 └─▶ TS-8 └─▶ TS-9 ┐
TS-5 + TS-9 ──────────────────────────────────────────┴─▶ TS-10 └─▶ TS-11 └─▶ TS-12 └─▶ TS-12b └─▶ TS-13 └─▶ TS-14 └─▶ TS-15(HIL)
TS-8 └─▶ TS-16 └─▶ TS-17 └─▶ TS-26
TS-3 └─▶ TS-18 └─▶ TS-19 (+ TS-12) ┐
TS-15(HIL) + TS-19 ────────────────┴─▶ TS-20 └─▶ TS-21(HIL) (+ TS-17) └─▶ TS-22 ┐
TS-20 └─▶ TS-23 ┐
TS-22 + TS-23 ──┴─▶ TS-24 └─▶ TS-25(HIL — terminal)
```

| TS-id | Title | Phase | Depends-on | Lands |
| --- | --- | --- | --- | --- |
| TS-1 | FORWARD ADR-0004 + this program doc | 0 | — | the epic's two committed files (this is that issue) |
| TS-2 | Promote the locked lesson-layout ledger into DESIGN.md (status-flip) | 0 | TS-1 | the LOCKED acceptance bar the critic gates against |
| TS-3 | Resolve token reconciliation in DESIGN.md `## 0` | 0 | TS-1 | a resolved ADOPTED/KEPT decision per token delta |
| TS-4 | GAPS.md reconcile: defer rows with wake triggers | 0 | TS-1 | the deferred-with-trigger ledger entries |
| TS-5 | Generation feasibility spike (BLOCKING GATE for Phase 2) | 0 | TS-2, TS-3 | proof v11 fits the output-token budget (or the recorded mitigation) |
| TS-6 | `CriticVerdict` v2: graded teaching + ledger-conformance schema | 1 | TS-2 | the graded critic schema + derived `passed` threshold |
| TS-7 | Rewrite the critic stage to grade against the ledger (statically-anchored) | 1 | TS-6 | the ledger-aware critic prompt + verdict |
| TS-8 | Gate `built` on the graded critic (arm-scoped, kill-switch) + persist sub-scores (migration) | 1 | TS-7 | the arm-scoped gate + `critic_scores JSONB` migration |
| TS-9 | Run the graded critic on the live/Job path + fold sub-scores into trace | 1 | TS-8 | gating independent of tracing; scores in the `_analysis` row |
| TS-10 | Typed sectioned `LessonSpec` + per-section apparatus on the seam | 2 | TS-5, TS-9 | the sectioned spec + typed apparatus contract |
| TS-11 | `spec` stage emits sectioned apparatus from the brief (within caps) | 2 | TS-10 | the v11 `spec` prompt emitting typed sections |
| TS-12 | `code` stage emits the named-grid two-column workspace (`var()`-referencing) | 2 | TS-11 | the v11 `code` prompt + the inline-only `var()` contract |
| TS-12b | Early end-to-end render of the first real `code` emission (thin-slice) | 2 | TS-12 | a rendered-artifact validation of the real contract |
| TS-13 | Predict-gate interactive + the decision-12 `postMessage` contract (iff path a) | 2 | TS-12 | predict-then-reveal gating + (path a) the cross-iframe contract |
| TS-14 | Land v11 synthesis as a new `workflow_version` arm + A/B vs the blob | 2 | TS-13 | the swappable v11 arm + the quantitative A/B record |
| TS-15 | Honesty checkpoint: one real v11 lesson in the existing iframe, OWNER sign-off | 2 | TS-14 | a real v11 lesson + the code-owner `HIL:` visual acceptance |
| TS-16 | `listLessons` owner-scoped store reader (JSONB-extracting `interactionKind`) | 3 | TS-8 | the store reader the library needs (tolerates mixed arms) |
| TS-17 | Library home route: card grid of lesson posters (sole generation entry) | 3 | TS-16, TS-3 | the library home (FLIP origin) |
| TS-18 | OKLCH retoken of `globals.css` | 3 | TS-3 | the chrome re-themed to the `## 0`-decided tokens |
| TS-19 | Serve-time token injection so re-themes reach already-generated lessons | 3 | TS-18, TS-12 | re-theming of `var()`-contract lessons (CSP/sandbox unchanged) |
| TS-20 | Reader shell: topbar + reading-progress + `#readerPanel.morph-box` wrapper | 3 | TS-19, TS-15 | the reader shell (FLIP destination), consuming decision-12 |
| TS-26 | INSTANCE.md reconcile: canonical-surface stance + repo-description/tagline | 3 | TS-17 | the one drift-prone instance fact the new surface touches |
| TS-21 | Card→reader FLIP container-transform (animates the box) + OWNER sign-off | 4 | TS-20, TS-17 | the signature morph + the code-owner `HIL:` motion acceptance |
| TS-22 | Receiver-guarantee checklist + instant-swap fallback + reduced-motion | 4 | TS-21 | the morph's robustness + reduced-motion paths |
| TS-23 | Stage-rail + ledger generating view on the existing `getStepEvents` stream | 4 | TS-20 | the upgraded generating view (LIVE stages, no durable store) |
| TS-24 | Apply the transitions-dev motion catalog across the chrome | 4 | TS-22, TS-23 | the unified motion language at `## 0` tokens |
| TS-25 | Owner visual-acceptance closeout: assembled chrome+lesson vs the v11 reference | 4 | TS-24 | the epic's terminal `HIL:` acceptance gate |

## Recommended build order

`TS-1 → TS-2 → TS-3 → TS-4 → TS-5 → TS-6 → TS-7 → TS-8 → TS-9 → TS-10 → TS-11 → TS-12 → TS-12b → TS-13 → TS-14 → TS-15 → TS-16 → TS-17 → TS-26 → TS-18 → TS-19 → TS-20 → TS-21 → TS-22 → TS-23 → TS-24 → TS-25.`

**Parallelism:** TS-4 (GAPS) parallels TS-2/TS-3. The MEASURE chain (TS-6→TS-9) and TS-3/TS-5 can overlap once TS-2 lands. Within FRAME, the store/library chain (TS-16→TS-17→TS-26) parallels the token/serve chain (TS-18→TS-19) until both feed TS-20. **Highest-value standalone controls:** TS-9 (a graded critic flagging vapidity on every live v11 run) ships value *before any v11 generation matters*; TS-12b (the first real contract rendered) catches contract bugs before predict-gates/arm stack on top; TS-15 (one real v11 lesson in the plain iframe, owner-signed) ships the headline product win *before any chrome*. **Terminal gate:** TS-25's owner sign-off certifies "looks AND teaches like the mocks" — no green CI substitutes for it (ADR-0004 decision 10).

## Sequencing & delivery

Build in the recommended order, each PR in a worktree, each fresh-context bot-reviewed per HEAD, squash-merged via Mergify (`@Mergifyio queue`). The local-test entrypoints (`npm run skeleton`, `npm run job`) prove the pipeline phases against `InlineEngine`/the durable `GcpEngine` with no live chrome; the TS-5 spike and the TS-15 / TS-21 / TS-25 owner sign-offs are **operational checkpoints at delivery**, gated on owner go-ahead.

**Per-issue plan-review gate (the adoption gate — structural, not optional).** Every TS-N issue is posted one at a time and gets a **fresh-context `@julianken-bot` plan review before any implementation PR** (per AGENTS.md → "Review dispatch", `.claude/skills/issue-plan-review/SKILL.md`). No self-approval; the session that authored an issue does not also review it; **no boilerplate APPROVE templates** — the plan review carries a verification ledger, cited files-read-this-turn, ≤3 findings, and an explicit verdict. This is a *spec*-review gate (distinct from R9's *doc*-drift duty below). Until ADR-0004 + this doc land on `main` (TS-1), the epic is a draft, not adoptable.

**Per-PR doc-currency duty (the AGENTS.md Update-Triggers reconcile, in the same PR).** Each PR reconciles every drift-prone file its diff implies, or writes `No doc updates needed` with justification:

| PR | Update-Triggers reconcile duty |
| --- | --- |
| TS-1 | `docs/decisions/0004-lesson-workspace.md` + `docs/plans/lesson-workspace.md` (this PR); no AGENTS/CLAUDE edit, but `scripts/check-claude-shim.sh` is run + recorded green; ADR-0004 names `SECURITY.md: no change` + `INSTANCE.md: reconciled in TS-26`. |
| TS-2 | `DESIGN.md` `## Lesson layout` (status-flip + reconcile); `.superpowers/lesson-layout-ledger.md` marked promoted; `check-claude-shim.sh` + `check-concept-drift.sh`. |
| TS-3 | `DESIGN.md` `## 0. Token Manifest` (a resolved decision per token delta). |
| TS-4 | `GAPS.md` (the deferred-with-trigger rows; any woken trigger struck-through `WOKEN`). |
| TS-5 | this program doc (the spike's measured size + chosen cap/strategy); ADR-0004 references the decision. |
| TS-6–TS-9 | `AGENTS.md` "Working in the tree" if a command/architecture note lands (then re-check `check-claude-shim.sh`); the schema change (TS-8) is a behavior change recorded where the migration lives. |
| TS-10–TS-15 | `AGENTS.md` "Working in the tree" for the new arm / contract notes; this program doc records the TS-14 A/B result; TS-15 carries the owner `HIL:` sign-off. |
| TS-16–TS-20 | `DESIGN.md` for every UI surface (library, reader shell, retoken — DESIGN.md wins on design conflict); `SECURITY.md: no change` re-confirmed at TS-19 (a new code path on the trust boundary, posture unchanged); `check-concept-drift.sh` on all new route/user copy. |
| TS-26 | `INSTANCE.md` → "Product concept (canonical noun)" (the additive "library"/"workspace" stance) **and** the repo-description/tagline between the markers **if** it moves — then the issue names the post-merge **orchestrator** `scripts/sync-repo-description.sh` run (the reviewer flags drift, never runs the write). |
| TS-21–TS-25 | `DESIGN.md` `## Motion` reconciled in the same PR if any motion token/value changed; TS-21 + TS-25 carry the owner `HIL:` sign-offs. |

**The one live-state action no issue can own.** The GitHub repo-description is live metadata, not a file. The reviewer **detects** drift (on a PR touching `INSTANCE.md`/`README.md`, runs `scripts/sync-repo-description.sh --check` and raises a "repo-description drift (orchestrator action)" finding on mismatch); the **orchestrator** owns the write (`scripts/sync-repo-description.sh` post-merge). The tagline default is **unchanged** (ADR-0004 decision 11), so this fires only if the owner moves it.

## Risks + mitigations

| # | Risk | Mitigation |
| --- | --- | --- |
| R1 | **Output cap blocks v11.** The v11 mock measures ~37,869 tokens vs `code.ts`'s `maxTokens: 32000`; a faithful one-pass render may truncate and degrade EVERY v11 lesson to `soon`. | **TS-5 is a BLOCKING entry gate**, not a footnote: it measures real output and records the mitigation (a `maxTokens` raise within the model's documented limit, and/or a two-pass shell-then-fill) before the contract+critic span is committed; its measure is recorded as a **lower bound** on the real prompt (TS-5 AC2), so the chosen cap carries headroom. |
| R2 | **The critic claims geometry it cannot compute.** No headless renderer in the tree; an LLM can't measure `getBoundingClientRect`/overflow from source. | ADR-0004 decision 5 + TS-7 scope the critic to **statically-checkable proxies** (named-grid presence incl. `[scrub]`, per-section subgrid, collapse query, no `:root` override, predict-gate structure) + LLM pedagogy judgement; pixel-exact spine verification is a GAPS row (TS-4). The mock-fidelity gap is covered by the owner gate (R10 / decision 10 / TS-25). |
| R3 | **Regression-vs-best-prior as an in-run gate is unbuildable.** `critique()` gets only the current artifact; `--baseline` is an eleatic OFFLINE label. | ADR-0004 decision 3 **splits** it: the in-run critic gates the current artifact; regression-vs-best-prior is the eleatic `--baseline` OFFLINE eval (TS-14 records it). The schema (TS-6) omits a `regressionVsBestPrior` sub-score. |
| R4 | **Serve-time injection is a no-op for its goal** if generated docs hardcode their own `:root` literals. | ADR-0004 decision 4 **couples** TS-12 (emit `var()` refs, no competing `:root` block) with TS-19 (inject into that contract); TS-19 AC2 documents the honest limitation for blob-arm lessons (the "old stays old" stance, decision 13). |
| R5 | **Persistence migration omitted.** No score column on `concept_page`. | TS-8 AC1 **names the migration** (a `critic_scores JSONB` add) + the `db:migrate` run. **TS-16's dependency is TS-8** (the migration node), not TS-9 (trace-folding, persists nothing). |
| R6 | **Cross-iframe progress/jump gap.** The opaque-origin iframe can't be read by the parent without a postMessage contract. | The mechanism is a **Phase-0 ADR-0004 decision (decision 12)**, EMITTED by TS-13 in Phase 2, CONSUMED by TS-20 in Phase 3 — never deferred to TS-20 (which would force a retroactive `code`-stage re-open). |
| R7 | **Over-bundled / flaky code-stage acceptance.** Gating a code-stage PR on a noisy LLM critic score is flaky. | TS-12/TS-13 are **split** (layout emission vs predict-gate) and assert static structure, NOT a critic score; the critic win is proven once in TS-14's A/B. TS-12b adds an early *rendered* validation without a flaky gate. |
| R8 | **Concept-drift CI + scale-to-zero.** The stage-rail view leans on dormant vocabulary; any always-on surface converts idle-$0 to a 24/7 bill. | TS-23 bounds to LIVE single-lesson stage names + the existing `getStepEvents` stream (no durable graduation, no `min-instances>0`), tags surfaced dormant vocabulary, gates on `check-concept-drift.sh`. No issue changes deploy topology. |
| R9 | **Process/doc drift across a long multi-phase epic.** Six+ drift-prone docs (incl. INSTANCE.md, SECURITY.md) + the orchestrator-owned repo-description sync can go stale. | The Sequencing & delivery table assigns each PR its Update-Triggers reconcile duty; **TS-26 reconciles INSTANCE.md**; TS-19 re-confirms SECURITY.md posture; GAPS rows (TS-4) carry wake triggers. (Distinct from the adoption gate's per-issue *spec* review.) |
| R10 | **A mis-calibrated graded gate degrades good lessons; or 24 green issues still diverge from the mocks.** | **Two coupled mitigations.** *Kill-switch:* the graded gate is **arm-scoped** (decision 3/7, TS-8 AC2) — the blob arm keeps its binary gate as the default until calibration, so a bad graded critic can't silently degrade the live path. *Owner gate:* decision 10 makes a code-owner `HIL:` visual sign-off the **terminal acceptance instrument** (TS-15, TS-21, TS-25) — the human certifies "looks AND teaches like the mocks." |

## Open questions for the owner

ADR-0004 records the **default in force** for each (two flagged owner-confirmable); they are restated here so the program view carries them. The defaults let the program proceed; an owner override lands before the gating issue codes.

1. **Output budget (gates Phase 2):** if TS-5 finds v11 exceeds 32000 tokens — raise `maxTokens` within the model's documented limit (default), or a two-pass shell-then-fill `code` strategy? TS-5 recommends; the call is the owner's. Favor headroom (TS-5's measure is a lower bound).
2. **Reading-progress / section-jump mechanism (decision 12 — locked at Phase 0):** **default path (a)** — the `code` stage emits a small `postMessage` contract (sections + scroll progress → parent), wired into TS-13. **Owner-confirmable before TS-13 codes** — deferring to TS-20 would strand TS-13.
3. **Pixel-exact stable-spine verification:** **accepted as deferred** to a future render-harness (GAPS row), with the source-static proxies as the only in-CI gate for now; the owner's `HIL:` visual sign-off (decision 10 / TS-15, TS-21, TS-25) covers the mock-fidelity gap.
4. **Critic threshold + persistence shape:** a single documented `passed` threshold over the three sub-scores + a `critic_scores JSONB` column (write-mostly for in-run gating; the queryable A/B substrate is the eleatic `_analysis` trace row, not the column).
5. **Token reconciliation default (TS-3):** **ADOPT** the OKLCH/serif/geometry/kind tokens (incl. `--scrub-w`) and the 200/440 durations into `## 0` (the mocks are the locked direction).
6. **Canonical-surface stance (decision 11 / TS-26):** "library" and "lesson-workspace" are **additive descriptors of the single-lesson product** (not a curriculum revival), INSTANCE.md reconciled accordingly. The public repo-description/tagline stays **unchanged for now** — "Generate an interactive, scaffolded lesson from a topic." **Owner-confirmable if it should move** once the library + reader ship (the orchestrator syncs it post-merge).
