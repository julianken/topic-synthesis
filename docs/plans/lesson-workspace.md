# Plan — The v11 lesson-workspace epic

> **Status: DRAFT / proposed (2026-06-25).** Goal-state below; nothing here is built. The binding
> architecture decision (the *why* + the as-built calls) is
> [`docs/decisions/0004-lesson-workspace.md`](../decisions/0004-lesson-workspace.md), which is
> **Accepted** (the direction is adopted; spike-gated/owner-confirmable items flagged provisional
> inline). This program doc stays DRAFT until these PRs land. It is the **program view + dependency graph**, not a second
> copy of the per-issue specs — each GitHub issue body (TS-1…TS-26) is the spec, authored to the
> five-section `issue-authoring` shape. Read ADR-0004 for the architecture; read the issues for
> per-PR detail.

## Revisions from due-diligence review (2026-06-26)

A six-role due-diligence panel (+ a verification audit) reviewed the epic against `main` and returned "sound — apply targeted edits, don't rethink the spine." The nine revisions below are folded into ADR-0004 + this doc; the spine (measure→produce→frame→motion), the trust-boundary posture, and the arm-scoped kill-switch are unchanged.

1. **TS-8 is the full write-path, not "add a column."** Extend `CriticVerdict`/`CritiquedArtifact` to carry sub-scores; `persistRun` writes them from the already-in-scope `synth.artifact` (run-pipeline.ts:301) into the `concept_page` INSERT, **inside the atomic transaction, ordered before the per-run prune** so it rolls back with it; then add the `critic_scores JSONB` column. (Single-lesson path — NOT a `SitemapPage` re-thread, which is the dormant curriculum path.)
2. **New issue TS-5b — morph feasibility spike** (parallel to TS-5, gating before TS-17). The signature card→reader morph is cross-document against an **opaque iframe** the browser can't snapshot; the mocks demonstrate it **same-document only**. TS-5b decides cross-doc VT vs same-doc SPA shell vs box-only FLIP and states what the user sees when the iframe can't be snapshotted. ADR decision 2's fidelity claim is now **provisional pending TS-5b**.
3. **TS-5 is a GO/NO-GO, not a measure.** It decides one-pass vs two-pass shell-then-fill from a real *generated* emission and **asserts teaching density survives the cap** (the model sheds apparatus first under truncation). PRODUCE is budgeted two-pass until the spike proves otherwise.
4. **Pin the arm mechanism: a `StageBundle.critic` swap** (binary-critic fn for blob, graded-critic fn for v11) — the gate reading `passed` is unchanged and the kill-switch is arm-native. `RunOptions` carries no arm flag today; without this the R10 kill-switch is unverified prose.
5. **Decompose `teachingQuality`** into named learning-efficacy sub-criteria (hook on a real misconception; ≥1 retrieval/predict-then-reveal check with answer-specific feedback; claims grounded in brief findings; apparatus adds beyond prose); make the load-bearing pedagogy primitives non-optional in TS-10 (≥1 predict-gate + ≥1 self-check with an answerable item) or document why absent.
6. **Split calibration honestly + new issue TS-15b — real-run calibration + arm-promotion.** TS-7 keeps a unit test on threshold arithmetic over canned sub-scores and seeds a labeled good/vapid fixture corpus; a NAMED offline calibration step (live spend, non-CI) runs the real critic over it; TS-15b re-calibrates against real v11 emissions and owns the arm-promotion the kill-switch promise depends on. No wording implies CI proves vapidity-detection.
7. **Reword TS-9/TS-14: the A/B record is CLI-offline only.** `run-job.ts:66` passes `noopSink` and never judges; `judgeBrief` is CLI-only. TS-9 gates on the live path; the A/B `_analysis` record is produced **offline via the CLI bench** (`npm run skeleton --trace --baseline`), not folded from live traffic.
8. **TS-19 injection-safety AC.** Inject only a **fixed server-side-constant `:root` block** at a deterministic anchor with a defined `<head>`-absent fallback; a test asserts the served bytes stay ONE parseable document AND the CSP is byte-identical; **no per-lesson/per-user value** flows into the injected style (it executes unescaped under `style-src 'unsafe-inline'`; the sandbox is the only backstop, no DOMPurify in tree).
9. **postMessage receive-side discipline (TS-13/TS-20).** Parent validates `event.source === <readerIframe>.contentWindow` (NOT an origin string — origin is the literal `"null"` across the opaque boundary); the payload is untrusted coordinate-only DATA the parent never reflects into DOM/HTML/navigation/eval; parent→child targets a known origin, never `'*'`. Validated with a throwaway e2e consumer at TS-13 time.

(Should-fix/watch-items fold into their owning issues — see "Watch-items folded into issues" below.)

## Goal

Turn the deployed single lesson from a generic interactive blob into the **locked v11 teaching workspace** — a densified two-column prose-spine + apparatus-panel lesson with predict-gate interactives — and frame it in the redesigned chrome (library home, reader shell, card→reader morph, OKLCH retoken, stage-rail generating view). The lesson stays **one self-contained inline-only HTML document in the opaque-origin sandbox** throughout; new behavior lands as a new port adapter / `workflow_version` arm, never by mutating a default in place or relaxing the trust boundary. See **ADR-0004** for *why* this shape — and for the thirteen locked decisions and the open-question resolutions this program implements.

The terminal acceptance is an explicit **code-owner `HIL:` visual-acceptance gate** (ADR-0004 decision 10 / TS-25), not "24 green issues." Green issues are necessary, not sufficient: the graded critic certifies per-lesson teaching-quality + static structure; the owner certifies mock-fidelity the critic is honestly scoped *not* to be able to prove.

## Context

**Now (verified on `main`, commit `2a69326`):** live + deployed on GCP, single-lesson (ADR-0003). The chrome is the walking-skeleton (intake-form home, spinner + per-step **text** timeline, lesson = generated HTML in a sandboxed iframe with no reader shell/apparatus/morph); `globals.css` materializes the original `## 0` hex tokens. In the pipeline, `spec→code` has never been told about v11; the critic is a binary `{passed, critique}` pass with **zero pedagogy/layout scoring**; `judgeBrief` is eval-only and ungated.

**The captured vision (the gap):** a locked v11 direction in `.superpowers/` mocks + the read-only Figma reference (file `upjG7gfzlkdojb8LLOwu6T`, #74). Two pieces are already on `main` — the DESIGN.md `## Lesson layout` section (#73) and the Figma node map (#74). The two pipeline reframes (typed sectioned `LessonSpec` + a pedagogy critic) and the whole chrome redesign were otherwise **UNTRACKED** before this epic.

**The organizing insight:** the generated lesson is a **PIPELINE problem** (a contract + prompt + critic change, produced *inside* the sandboxed HTML), while the chrome is a **frontend problem** (it frames the iframe; it can't make a lesson look like the mock). A beautiful frame around a vapid lesson is explicitly not the vision — so the pipeline work outranks and precedes the chrome.

## Phases (ordered) + sequencing rationale

**The spine is measure → produce → frame → motion**, because the dominant product risk is a vapid *generator* the binary critic can't detect — not a plain shell. We must be able to *detect* a generic lesson before we can credibly fix one, and the critic is the acceptance instrument every later phase leans on. Each phase ships independently: a graded critic that flags vapidity is valuable before v11 exists; v11 generation is valuable in today's plain iframe before the shell; the shell is valuable before the morph.

- **Phase 0 — Foundation (TS-1…TS-5, TS-5b):** convert the untracked vision into a forward ADR + this program doc, promote the ledger, resolve tokens, reconcile GAPS, **lock the cross-iframe mechanism (decision 12) and the canonical-surface stance (decision 11)** — and answer the two biggest unknowns the inputs under-gated: *can the model emit a v11-shaped workspace within the output-token budget, one-pass or two-pass, with teaching density surviving the cap?* (**TS-5, a blocking GO/NO-GO**) and *can the signature card→reader morph render against the opaque iframe at all, or does it degrade to box-only?* (**TS-5b, a feasibility spike** parallel to TS-5, gating before TS-17). No runtime behavior change except the spikes.
- **Phase 1 — MEASURE (TS-6…TS-9):** replace the binary critic with a graded rubric scoring **named learning-efficacy sub-criteria** (not one opaque `teachingQuality` scalar) + statically-checkable ledger conformance, gate `built` on a threshold via a `StageBundle.critic` swap (arm-scoped — decision 3/4) on every live run, persist the sub-scores via the full write-path (TS-8), and fold them into trace alongside `judgeBrief`. Calibrated honestly: a unit test on threshold arithmetic over canned sub-scores (CI), plus a NAMED offline calibration step over a labeled good/vapid fixture corpus (live spend, non-CI) — the threshold's correctness against *real* v11 emissions is owned by TS-15b, not Phase 1.
- **Phase 2 — PRODUCE (TS-10…TS-15):** extend the Analysis→Synthesis seam to a typed sectioned `LessonSpec` + apparatus (with the load-bearing pedagogy primitives **non-optional** — ≥1 predict-gate + ≥1 self-check carrying an answerable item — or a documented pedagogical reason absent), teach `spec→code` the workspace layout (emitting `var()`-referencing inline-only HTML incl. the `[scrub]` track; one-pass or the two-pass shell-then-fill TS-5 decided), **render the first real emission end-to-end early (TS-12b)**, land predict-gates, ship it as a new arm, A/B it against the blob, and **prove one real end-to-end lesson renders in the (still-unbuilt-chrome) iframe with owner sign-off** as the honesty checkpoint (TS-15). The contract precedes the prompts precedes an early *render* of the first emission precedes the critic that grades it precedes predict-gates precedes the arm precedes the checkpoint lesson. **TS-15b** (real-run calibration + arm-promotion) re-calibrates the threshold against the real v11 emissions TS-14/TS-15 produce.
- **Phase 3 — FRAME (TS-16…TS-20, TS-26):** build the chrome around the self-contained iframe — the `listLessons` store reader, the library home (FLIP origin), the OKLCH retoken + serve-time injection reaching old lessons (a fixed server-side-constant `:root` block — TS-19), and the reader shell (FLIP destination, consuming the decision-12 mechanism with the pinned postMessage receive-side discipline). The store reader precedes the library, the library precedes the FLIP, the token decisions precede the retoken precede serve-injection. **TS-5b's morph verdict gates TS-17** (it shapes the routing model of both the library and reader shell).
- **Phase 4 — MOTION (TS-21…TS-25):** the signature card→reader container-transform (receiver-guarantee + instant-swap fallback + reduced-motion + owner sign-off), the stage-rail + ledger generating view on the existing step stream, the unified motion catalog, and the terminal owner visual-acceptance closeout. Motion is last — it animates real boxes that only exist after the shell.

## Dependency graph (dual form)

**Edges (`A → B` = A blocks B):**
```
TS-1 ─┬─▶ TS-2 ─▶ TS-3 ─▶ TS-5 ─▶ TS-10
      ├─▶ TS-3 (also direct)
      ├─▶ TS-4
      └─▶ TS-5b                        (morph-feasibility spike, parallel to TS-5)
TS-2 ─▶ TS-6 ─▶ TS-7 ─▶ TS-8 ─▶ TS-9 ─▶ TS-10
TS-8 ─▶ TS-16                       (the migration is the binding node, not TS-9)
TS-10 ─▶ TS-11 ─▶ TS-12 ─▶ TS-12b ─▶ TS-13 ─▶ TS-14 ─▶ TS-15 ─▶ TS-15b
TS-3 ─▶ TS-17 ;  TS-3 ─▶ TS-18
TS-5b ─▶ TS-17                      (the morph verdict shapes the library+reader routing model)
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
      └─▶ TS-5b (morph spike) ───┼─▶ TS-17 (gates library/reader routing)
                  └─▶ TS-6 └─▶ TS-7 └─▶ TS-8 └─▶ TS-9 ┐
TS-5 + TS-9 ──────────────────────────────────────────┴─▶ TS-10 └─▶ TS-11 └─▶ TS-12 └─▶ TS-12b └─▶ TS-13 └─▶ TS-14 └─▶ TS-15(HIL) └─▶ TS-15b
TS-8 └─▶ TS-16 └─▶ TS-17 (+ TS-5b) └─▶ TS-26
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
| TS-5 | Generation feasibility **GO/NO-GO** (BLOCKING GATE for Phase 2) | 0 | TS-2, TS-3 | the one-pass-vs-two-pass strategy decision + proof teaching density survives the cap (fed to TS-10 before it codes) |
| TS-5b | **Morph-feasibility spike** (gates TS-17 — parallel to TS-5) | 0 | TS-1 | cross-doc VT vs same-doc SPA vs box-only FLIP, + what the user sees when the opaque iframe can't be snapshotted (may re-scope decision 2 / TS-25 down) |
| TS-6 | `CriticVerdict` v2: **named learning-efficacy** sub-criteria + ledger-conformance schema (graded-critic fn for the arm) | 1 | TS-2 | the decomposed graded critic schema + derived `passed` threshold + the `StageBundle.critic` arm fn |
| TS-7 | Rewrite the critic stage to grade against the ledger (statically-anchored) + seed the good/vapid fixture corpus | 1 | TS-6 | the ledger-aware critic prompt + verdict; a threshold-arithmetic unit test + the named offline-calibration step |
| TS-8 | Gate `built` via the `StageBundle.critic` swap (arm-scoped, kill-switch) + the **full sub-score write-path** (migration) | 1 | TS-7 | the arm-native gate + the `synth.artifact`→INSERT write (inside the atomic txn, before the prune) + `critic_scores JSONB` migration |
| TS-9 | Run the graded critic on the live/Job path; produce the A/B trace record **offline via the CLI bench** | 1 | TS-8 | gating on the live path; the A/B `_analysis` row produced by `npm run skeleton --trace --baseline` (NOT live telemetry) |
| TS-10 | Typed sectioned `LessonSpec` + per-section apparatus on the seam (pedagogy primitives **non-optional**) | 2 | TS-5, TS-9 | the sectioned spec + typed apparatus contract; ≥1 predict-gate + ≥1 self-check with an answerable item required (or a documented reason) |
| TS-11 | `spec` stage emits sectioned apparatus from the brief (within caps) | 2 | TS-10 | the v11 `spec` prompt emitting typed sections |
| TS-12 | `code` stage emits the named-grid two-column workspace (`var()`-referencing) | 2 | TS-11 | the v11 `code` prompt + the inline-only `var()` contract |
| TS-12b | Early end-to-end render of the first real `code` emission (thin-slice) | 2 | TS-12 | a rendered-artifact validation of the real contract |
| TS-13 | Predict-gate interactive + the decision-12 `postMessage` contract (iff path a; receive-side discipline pinned) | 2 | TS-12 | predict-then-reveal gating + (path a) the cross-iframe contract, validated with a throwaway e2e consumer at TS-13 time |
| TS-14 | Land v11 synthesis as a new `workflow_version` arm + A/B vs the blob (offline CLI bench) | 2 | TS-13 | the swappable v11 arm + the quantitative A/B record (CLI-offline `_analysis` row) |
| TS-15 | Honesty checkpoint: one real v11 lesson in the existing iframe, OWNER sign-off | 2 | TS-14 | a real v11 lesson + the code-owner `HIL:` visual acceptance |
| TS-15b | Real-run calibration + arm-promotion (live spend, non-CI) | 2 | TS-15 | the threshold re-calibrated against real v11 emissions + the arm-promotion decision the kill-switch promise depends on |
| TS-16 | `listLessons` owner-scoped store reader (JSONB-extracting `interactionKind`; tolerates null/mixed-shape rows) | 3 | TS-8 | the store reader the library needs (tolerates mixed arms incl. degraded `spec_json`-null rows) |
| TS-17 | Library home route: card grid of lesson posters (sole generation entry) | 3 | TS-16, TS-3, TS-5b | the library home (FLIP origin) — routing model shaped by TS-5b's morph verdict |
| TS-18 | OKLCH retoken of `globals.css` | 3 | TS-3 | the chrome re-themed to the `## 0`-decided tokens |
| TS-19 | Serve-time token injection so re-themes reach already-generated lessons (injection-safety AC) | 3 | TS-18, TS-12 | a **fixed server-side-constant `:root`** injected at a deterministic anchor (CSP/sandbox byte-unchanged; no per-lesson/user value; served bytes stay one parseable doc) |
| TS-20 | Reader shell: topbar + reading-progress + `#readerPanel.morph-box` wrapper | 3 | TS-19, TS-15 | the reader shell (FLIP destination), consuming decision-12; parent validates `event.source === readerIframe.contentWindow` (never an origin string), treats the payload as untrusted coordinate-only DATA |
| TS-26 | INSTANCE.md reconcile: canonical-surface stance + repo-description/tagline | 3 | TS-17 | the one drift-prone instance fact the new surface touches |
| TS-21 | Card→reader FLIP container-transform (animates the box; strategy = TS-5b's verdict) + OWNER sign-off | 4 | TS-20, TS-17 | the signature morph (cross-doc / SPA / box-only per TS-5b) + the code-owner `HIL:` motion acceptance |
| TS-22 | Receiver-guarantee checklist + instant-swap fallback + reduced-motion | 4 | TS-21 | the morph's robustness + reduced-motion paths |
| TS-23 | Stage-rail + ledger generating view on the existing `getStepEvents` stream | 4 | TS-20 | the upgraded generating view (LIVE stages, no durable store) |
| TS-24 | Apply the transitions-dev motion catalog across the chrome | 4 | TS-22, TS-23 | the unified motion language at `## 0` tokens |
| TS-25 | Owner visual-acceptance closeout: assembled chrome+lesson vs the v11 reference | 4 | TS-24 | the epic's terminal `HIL:` acceptance gate (morph fidelity re-scoped to TS-5b's verdict if box-only) |

## Recommended build order

`TS-1 → TS-2 → TS-3 → TS-4 → TS-5 → TS-5b → TS-6 → TS-7 → TS-8 → TS-9 → TS-10 → TS-11 → TS-12 → TS-12b → TS-13 → TS-14 → TS-15 → TS-15b → TS-16 → TS-17 → TS-26 → TS-18 → TS-19 → TS-20 → TS-21 → TS-22 → TS-23 → TS-24 → TS-25.`

(TS-5b only needs TS-1, so it parallels TS-2…TS-5 in Phase 0; it is listed after TS-5 in the linear order purely for readability — its hard requirement is "lands before TS-17 codes.")

**Parallelism:** TS-4 (GAPS) parallels TS-2/TS-3. **TS-5b (morph spike) parallels TS-5** and the whole MEASURE chain — it only blocks TS-17. The MEASURE chain (TS-6→TS-9) and TS-3/TS-5 can overlap once TS-2 lands. Within FRAME, the store/library chain (TS-16→TS-17→TS-26) parallels the token/serve chain (TS-18→TS-19) until both feed TS-20, but TS-17 also waits on TS-5b. **Highest-value standalone controls:** TS-9 (a graded critic flagging vapidity on every live v11 run) ships value *before any v11 generation matters*; TS-12b (the first real contract rendered) catches contract bugs before predict-gates/arm stack on top; TS-15 (one real v11 lesson in the plain iframe, owner-signed) ships the headline product win *before any chrome*. **Terminal gate:** TS-25's owner sign-off certifies "looks AND teaches like the mocks" — no green CI substitutes for it (ADR-0004 decision 10).

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
| TS-5 | this program doc (the spike's measured size + the one-pass/two-pass strategy decision + the teaching-density assertion); ADR-0004 references the decision. |
| TS-5b | this program doc (the morph-feasibility verdict — cross-doc/SPA/box-only); **ADR-0004 decision 2 + TS-21/TS-25 re-scoped down in the SAME PR if the verdict is box-only** (the provisional claim resolves here). |
| TS-6–TS-9 | `AGENTS.md` "Working in the tree" if a command/architecture note lands (then re-check `check-claude-shim.sh`); the schema change (TS-8) is a behavior change recorded where the migration lives. |
| TS-10–TS-15 | `AGENTS.md` "Working in the tree" for the new arm / contract notes; this program doc records the TS-14 A/B result; TS-15 carries the owner `HIL:` sign-off; **TS-12 corrects the stale `code.ts:31` DOMPurify comment** (per the AGENTS.md update-trigger — `serve.ts:9` says sanitization deliberately does NOT happen; the two currently contradict). |
| TS-15b | this program doc (the real-run-calibrated threshold + the arm-promotion decision); `AGENTS.md` "Working in the tree" if the live default arm flips (then re-check `check-claude-shim.sh`). |
| TS-16–TS-20 | `DESIGN.md` for every UI surface (library, reader shell, retoken — DESIGN.md wins on design conflict); `SECURITY.md: no change` re-confirmed at TS-19 (a new code path on the trust boundary, posture unchanged — the fixed-constant injection + the postMessage receive-side discipline keep it so); `check-concept-drift.sh` on all new route/user copy. |
| TS-26 | `INSTANCE.md` → "Product concept (canonical noun)" (the additive "library"/"workspace" stance) **and** the repo-description/tagline between the markers **if** it moves — then the issue names the post-merge **orchestrator** `scripts/sync-repo-description.sh` run (the reviewer flags drift, never runs the write). |
| TS-21–TS-25 | `DESIGN.md` `## Motion` reconciled in the same PR if any motion token/value changed; TS-21 + TS-25 carry the owner `HIL:` sign-offs. |

**The one live-state action no issue can own.** The GitHub repo-description is live metadata, not a file. The reviewer **detects** drift (on a PR touching `INSTANCE.md`/`README.md`, runs `scripts/sync-repo-description.sh --check` and raises a "repo-description drift (orchestrator action)" finding on mismatch); the **orchestrator** owns the write (`scripts/sync-repo-description.sh` post-merge). The tagline default is **unchanged** (ADR-0004 decision 11), so this fires only if the owner moves it.

## Risks + mitigations

| # | Risk | Mitigation |
| --- | --- | --- |
| R1 | **Output cap blocks v11, and the model sheds teaching apparatus first under truncation.** The v11 *reference mock*'s standalone HTML is large (a rough token count of the hand-built mock is well above `code.ts`'s `maxTokens: 32000`) — signaling a faithful one-pass *generated* render may truncate and degrade EVERY v11 lesson. Worse, under truncation the model drops the expensive predict-gates/self-checks first, so a structurally-complete render can be pedagogically thin. The mock's raw size is only a **signal**, not an authoritative figure. | **TS-5 is a BLOCKING GO/NO-GO**, not a measure: it runs a real *generated* emission, **decides one-pass vs two-pass shell-then-fill**, and its success criterion **asserts teaching density survives the cap** (not just structural completeness). The decision feeds TS-10 before it codes; PRODUCE is budgeted two-pass until proven otherwise; the measure is a **lower bound** so the chosen cap carries headroom. |
| R2 | **The critic claims geometry it cannot compute.** No headless renderer in the tree; an LLM can't measure `getBoundingClientRect`/overflow from source. | ADR-0004 decision 5 + TS-7 scope the critic to **statically-checkable proxies** (named-grid presence incl. `[scrub]`, per-section subgrid, collapse query, no `:root` override, predict-gate structure) + LLM pedagogy judgement; pixel-exact spine verification is a GAPS row (TS-4). The mock-fidelity gap is covered by the owner gate (R10 / decision 10 / TS-25). |
| R3 | **Regression-vs-best-prior as an in-run gate is unbuildable.** `critique()` gets only the current artifact; `--baseline` is an eleatic OFFLINE label. | ADR-0004 decision 3 **splits** it: the in-run critic gates the current artifact; regression-vs-best-prior is the eleatic `--baseline` OFFLINE eval (TS-14 records it). The schema (TS-6) omits a `regressionVsBestPrior` sub-score. |
| R4 | **Serve-time injection is a no-op for its goal** if generated docs hardcode their own `:root` literals. | ADR-0004 decision 4 **couples** TS-12 (emit `var()` refs, no competing `:root` block) with TS-19 (inject into that contract); TS-19 AC2 documents the honest limitation for blob-arm lessons (the "old stays old" stance, decision 13). |
| R5 | **Persistence migration omitted — and a column alone persists nothing.** No score column on `concept_page`, and the verdict object must actually be *written*. | TS-8 is the **full write-path**, not just the column: extend `CriticVerdict`/`CritiquedArtifact` to carry sub-scores; `persistRun` reads them from the already-in-scope `synth.artifact` (run-pipeline.ts:301 — no `SitemapPage` re-thread for the single-lesson path) and writes them in the `concept_page` INSERT (repo.ts:101-117), **inside the atomic txn, ordered before the per-run prune (repo.ts:133-135) so it rolls back with it**; then add the `critic_scores JSONB` column + the `db:migrate` run. **TS-16's dependency is TS-8** (the migration node), not TS-9 (CLI-offline trace, persists nothing). |
| R6 | **Cross-iframe progress/jump gap.** The opaque-origin iframe can't be read by the parent without a postMessage contract. | The mechanism is a **Phase-0 ADR-0004 decision (decision 12)**, EMITTED by TS-13 in Phase 2, CONSUMED by TS-20 in Phase 3 — never deferred to TS-20 (which would force a retroactive `code`-stage re-open). |
| R7 | **Over-bundled / flaky code-stage acceptance.** Gating a code-stage PR on a noisy LLM critic score is flaky. | TS-12/TS-13 are **split** (layout emission vs predict-gate) and assert static structure, NOT a critic score; the critic win is proven once in TS-14's A/B. TS-12b adds an early *rendered* validation without a flaky gate. |
| R8 | **Concept-drift CI + scale-to-zero.** The stage-rail view leans on dormant vocabulary; any always-on surface converts idle-$0 to a 24/7 bill. | TS-23 bounds to LIVE single-lesson stage names + the existing `getStepEvents` stream (no durable graduation, no `min-instances>0`), tags surfaced dormant vocabulary, gates on `check-concept-drift.sh`. No issue changes deploy topology. |
| R9 | **Process/doc drift across a long multi-phase epic.** Six+ drift-prone docs (incl. INSTANCE.md, SECURITY.md) + the orchestrator-owned repo-description sync can go stale. | The Sequencing & delivery table assigns each PR its Update-Triggers reconcile duty; **TS-26 reconciles INSTANCE.md**; TS-19 re-confirms SECURITY.md posture; GAPS rows (TS-4) carry wake triggers. (Distinct from the adoption gate's per-issue *spec* review.) |
| R10 | **A mis-calibrated graded gate degrades good lessons; or 24 green issues still diverge from the mocks.** A fixture-only unit test can't prove the threshold detects vapidity on *real* runs (every critic test mocks `completeObject`; CI runs `lint:boundaries` only). | **Three coupled mitigations.** *Kill-switch (now arm-native, not prose):* the gate is arm-scoped via a **`StageBundle.critic` swap** (decision 3/4) — `RunOptions` has no arm flag, so the blob arm keeps its binary-critic fn as the live default until promotion; a bad graded critic can't silently degrade the live path. *Honest calibration:* TS-7's unit test only checks threshold arithmetic over canned sub-scores (CI), a named offline step calibrates over labeled fixtures (live spend, non-CI), and **TS-15b re-calibrates against real v11 emissions + owns the arm-promotion** the kill-switch promise depends on — no wording implies CI proves vapidity-detection. *Owner gate:* decision 10 makes a code-owner `HIL:` visual sign-off the **terminal acceptance instrument** (TS-15, TS-21, TS-25) — the human certifies "looks AND teaches like the mocks." |
| R11 | **The signature card→reader morph may be unbuildable as demonstrated.** Library and reader are **separate App Router routes** (cross-document), and the receiver is an **opaque-origin sandboxed iframe the browser can't snapshot** into `::view-transition-*`; the mocks demonstrate the morph **same-document only** (`startViewTransition` + `body[data-screen]`; cross-doc `@view-transition` in zero mocks). | **TS-5b** (a feasibility spike before TS-17) decides cross-doc VT vs same-doc SPA shell vs box-only FLIP and states what the user sees when the iframe can't be snapshotted. **ADR decision 2's mock-fidelity claim is provisional pending TS-5b**; a box-only verdict re-scopes decision 2 + TS-21/TS-25 down in the same edit (R10's owner gate covers the residual fidelity gap). |
| R12 | **Two NEW code paths on the trust boundary** (serve-time injection TS-19; the cross-iframe postMessage TS-13/TS-20) are greenfield, with no safe in-repo pattern to inherit (zero postMessage usage in src; no DOMPurify). | *Injection (TS-19):* inject only a **fixed server-side-constant `:root` block** at a deterministic anchor with a `<head>`-absent fallback; a test asserts the served bytes stay ONE parseable document AND the CSP is byte-identical; **no per-lesson/user value** flows into the injected style (`style-src 'unsafe-inline'` executes it unescaped; the sandbox is the only backstop). *postMessage (TS-13/TS-20):* parent validates **`event.source === readerIframe.contentWindow`** (NOT an origin allowlist — origin is the literal `"null"` across the opaque boundary); payload is untrusted coordinate-only DATA never reflected into DOM/HTML/navigation/eval; parent→child targets a known origin, never `'*'`; validated with a throwaway e2e consumer at TS-13 time. |

## Open questions for the owner

ADR-0004 records the **default in force** for each (two flagged owner-confirmable); they are restated here so the program view carries them. The defaults let the program proceed; an owner override lands before the gating issue codes.

1. **Output budget + generation strategy (gates Phase 2):** TS-5 is a **GO/NO-GO** that decides **one-pass vs two-pass shell-then-fill** from a real *generated* emission and **asserts teaching density survives the cap** (not just structural completeness) — so the headline A/B isn't a tautology where v11 "wins" only on a layout-weighted score. If one-pass exceeds the cap: two-pass (default — net-new `code`-stage architecture, ≈double TS-12/12b/13) and/or raise `maxTokens` within the model's documented limit. TS-5 recommends; the call is the owner's; the decision feeds TS-10 before it codes. Favor headroom (TS-5's measure is a lower bound).
2. **Reading-progress / section-jump mechanism (decision 12 — locked at Phase 0):** **default path (a)** — the `code` stage emits a small `postMessage` contract (sections + scroll progress → parent), wired into TS-13. **Owner-confirmable before TS-13 codes** — deferring to TS-20 would strand TS-13.
3. **Pixel-exact stable-spine verification:** **accepted as deferred** to a future render-harness (GAPS row), with the source-static proxies as the only in-CI gate for now; the owner's `HIL:` visual sign-off (decision 10 / TS-15, TS-21, TS-25) covers the mock-fidelity gap.
4. **Critic threshold + persistence shape:** a single documented `passed` threshold over the **decomposed learning-efficacy + ledger-conformance** sub-scores + a `critic_scores JSONB` column written via TS-8's full write-path (inside `persistRun`'s txn, before the prune). The column is write-mostly for in-run gating; the queryable A/B substrate is the eleatic `_analysis` trace row, which is a **CLI-offline artifact** (TS-9/TS-14 via `npm run skeleton --trace --baseline`), not live telemetry — the Job passes `noopSink` and never judges.
5. **Token reconciliation default (TS-3):** **ADOPT** the OKLCH/serif/geometry/kind tokens (incl. `--scrub-w`) and the 200/440 durations into `## 0` (the mocks are the locked direction).
6. **Canonical-surface stance (decision 11 / TS-26):** "library" and "lesson-workspace" are **additive descriptors of the single-lesson product** (not a curriculum revival), INSTANCE.md reconciled accordingly. The public repo-description/tagline stays **unchanged for now** — "Generate an interactive, scaffolded lesson from a topic." **Owner-confirmable if it should move** once the library + reader ship (the orchestrator syncs it post-merge).
7. **Morph strategy (TS-5b — gates TS-17):** the card→reader morph is cross-document against an opaque iframe that can't be snapshotted; the mocks only demonstrate it same-document. TS-5b decides **cross-doc View-Transition vs same-doc SPA shell vs box-only FLIP** and states what the user sees in the box-only case. **ADR decision 2's mock-fidelity claim is provisional pending this spike** — a box-only verdict re-scopes decision 2 + TS-21/TS-25 down. No default is forced: the spike's finding is the decision.

## Watch-items folded into issues (should-fix — non-blocking)

These do not gate Phase 0 and are NOT separate issues; each folds into its owning issue's ACs as that issue is authored:

- **Graded-critic live INPUT cost (→ TS-5 / TS-15b):** the critic runs on Opus embedding the full artifact HTML on every live run; TS-5 also records critic input-token cost on a near-cap artifact and decides whether the graded critic stays on Opus or drops a tier.
- **`var()`-only artifact not self-contained at rest (→ TS-12 / TS-19):** a `var()`-only doc renders unstyled if served without TS-19's injection; TS-12 specifies the injected token set + a self-contained fallback so an un-injected serve still renders.
- **`listLessons` null/mixed-shape tolerance (→ TS-16):** `interactionKind` lives only in `spec_json`, `null` for degraded lessons; the JSONB extraction tolerates null/old-shape rows (folded into the TS-16 row above).
- **OKLCH retoken larger than "retoken" (→ TS-3 / TS-18):** new `--serif`/geometry families + a serif font the manifest lacks + a 200/440-vs-120/220/360 duration conflict; TS-3 reconciles DESIGN.md §Typography, not just §0 color/duration.
- **SECURITY.md "no change" is conditional (→ TS-16/17/20 reviewer check):** true at the boundary, but the affirmative owner-scoping claim now covers the new read surfaces; phrased "posture holds IFF the new read surfaces stay owner-scoped," made a reviewer check.
- **Stale `code.ts:31` DOMPurify comment (→ TS-12):** contradicts `serve.ts:9`; corrected in TS-12 (folded into the TS-10–TS-15 doc-currency row above).
