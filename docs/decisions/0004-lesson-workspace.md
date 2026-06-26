# ADR 0004 — The v11 lesson-workspace: measurable quality, a pipeline-produced workspace, and the chrome that frames it

**Status:** Accepted (2026-06-25) · **Relates:** the lesson-workspace epic — program view `docs/plans/lesson-workspace.md`; ADR-0003 (single-lesson refocus, which this builds on); #73 (the DESIGN.md `## Lesson layout` ledger) + #74 (the Figma design-file adoption). · **Forward-only** — records a goal-state decision; it **does not** edit or supersede ADRs 0001/0002/0003. The measure→produce→frame direction + these 13 architecture choices are **adopted**; the spike-gated (decision 8) and owner-confirmable (decisions 2 and 11-tagline) items are flagged *provisional* inline and settle before their gating issue codes. Execution is tracked in the program doc; this ADR is not re-opened as PRs land unless a spike forces a decision change.

## Context

The app is live on GCP and single-lesson (ADR-0003), but the deployed lesson is a **generic interactive blob**, not the locked v11 teaching workspace. Verified on `main` (commit `2a69326`):

- **Chrome is walking-skeleton:** an intake-form home (no library), a generating screen that is a spinner + per-step **text** timeline (not the graph-ledger view), and a lesson = generated HTML in a sandboxed iframe (`sandbox="allow-scripts"`, no `allow-same-origin`; no reader shell, no apparatus, no morph). `globals.css` materializes the original `## 0. Token Manifest` hex tokens, not the OKLCH retoken.
- **Pipeline is unaware of v11:** `PageSpec`/`PageArtifact` describe ONE generic interactive page; `spec→code` has never been told about the v11 layout (the DESIGN.md lesson-layout spec is injected into no prompt); the critic (`src/pipeline/critic.ts`) is a single LLM pass returning `{passed, critique}` that gates only on "teaches the goal + interactive + a11y + self-contained" — **zero pedagogy or layout scoring**; `judgeBrief` (`src/trace/judge.ts`) scores brief quality but is **eval-only, brief-only, and ungated**.
- **The captured vision** lives in `.superpowers/` mocks + the read-only Figma reference (file `upjG7gfzlkdojb8LLOwu6T`, adopted in #74). Two artifacts are already on `main`: the DESIGN.md `## Lesson layout` section (#73, carrying the four locked decisions, densify caps, invariants, anti-patterns near-verbatim from `.superpowers/lesson-layout-ledger.md`) and the Figma node map (#74). Everything else — the typed sectioned spec, the pedagogy critic, the whole chrome redesign — was **untracked** before this epic.

**The core insight this ADR is organized around:** the generated lesson is a **PIPELINE problem** (a contract + prompt + critic change — it is produced *inside* the sandboxed HTML document, not painted by app CSS), while the chrome is a **frontend problem** (it frames the iframe; it cannot itself make a lesson look like the mock). A beautiful frame around a vapid lesson is **not** the vision — so the pipeline work outranks and precedes the chrome, and the epic is risk-ordered **measure → produce → frame → motion**: first make lesson quality measurable (a graded, ledger-aware critic that *gates* `built`), then prove the workspace is producible within the real output-token budget (a typed sectioned `LessonSpec` shipped as a new `workflow_version` arm, A/B-comparable to the blob), then frame it in chrome built *around* the unchanged self-contained iframe.

## Decisions

The three flagged **[ADR]** are the binding architecture calls; the rest are program decisions recorded here for traceability. Two carry an **owner-confirmable** flag where a default is taken pending the owner's call.

### 1. [ADR] The lesson stays one self-contained inline-only HTML doc in the opaque-origin sandbox

`sandbox="allow-scripts"` (no `allow-same-origin`) under the `default-src 'none'` CSP (`src/app/artifact/serve.ts`), **unchanged in posture**. The v11 workspace is **produced BY THE PIPELINE** (sectioned contract → richer `spec`/`code` prompts → a ledger-graded critic), never by relaxing the boundary, hosting external assets, or forking the lesson into a multi-document app-shell — each of those is a separate trust-boundary ADR and is explicitly **rejected** here. The trust posture is unchanged, so `SECURITY.md` needs **no edit** (confirmed explicitly per the no-drift discipline; re-confirmed at TS-19, the one PR adding a new code path on the boundary).

### 2. [ADR] The card→reader morph animates the iframe CONTAINER box, never its contents

A single-document View-Transition morphs the `#readerPanel.morph-box` wrapper's real box; the sandboxed iframe contents are untouched, so the opaque-origin boundary holds. Every chrome AC that touches the iframe asserts `sandbox` + `ARTIFACT_CSP` are **byte-for-byte unchanged** across the morph. The morph is geometry the critic cannot judge, so it carries a code-owner `HIL:` sign-off (decision 10 / TS-21).

### 3. [ADR] The graded critic gates `built` on a threshold, scoring the CURRENT artifact only; regression-vs-best-prior is an OFFLINE eval, not an in-run gate

This is the load-bearing correctness fix. `critique()` in `runLesson` receives only the current artifact — there is **no** "best prior version" input wired into the gate, and `step_event`/trace data is per-run-transient. So the in-run critic gates the current artifact's teaching-quality + statically-anchored ledger conformance; **regression-vs-best-prior is realized as the existing eleatic `--baseline` offline trace-pairing** (`src/trace/reduce.ts`), never as a synchronous gate. Conflating the two (as the source ledger phrasing invites) produces an unbuildable AC; this decision splits them cleanly, and the critic schema (decision/TS-6) deliberately omits a `regressionVsBestPrior` sub-score.

**The gate change is arm-scoped, not a global default mutation** (decision 7 / ADR-0001 §5): the graded critic gates the v11 arm; the **blob arm keeps its binary gate** as the live default until the graded critic is calibrated on real runs. This is the kill-switch — a mis-calibrated graded critic cannot silently degrade the live blob path (R10 / TS-8).

### 4. Serve-time token injection requires a generation constraint, decided up front (the serve-injection ↔ generation coupling)

Re-theming already-generated lessons by injecting a `:root` token `<style>` at serve time only works if the generated doc **references `var()` tokens and does NOT hardcode its own `:root` color/geometry literals**. So the `code`-stage prompt (TS-12) is constrained to emit `var(--token)` references and no competing `:root` literal block, and serve-time injection (TS-19) is specified as injecting into the served HTML string with that contract assumed. The two are **coupled** and recorded here as one decision: TS-12 emits the contract, TS-19 relies on it.

### 5. [scoping of decision 3] The graded critic gates on the locked layout-ledger, restricted to STATICALLY-CHECKABLE proxies for geometry

An LLM reading HTML source cannot compute rendered bounding boxes, and the repo has **no headless renderer** (no jsdom/puppeteer/playwright in `package.json`). So the critic's *layout* sub-score is honestly scoped to what is checkable from source: presence of the named CSS-grid line set, a per-`<section>` subgrid, the `≤900px` collapse media query, no `:root` hardcoded-literal override, and the predict-gate-only structure — **plus** the LLM's pedagogy/densify judgement on prose + apparatus content. The named grid-line set is `[screen-start] [read] [gap] [panel] [scrub]`, and the `[scrub]` track exists for the in-iframe dot-scrubber (the ledger reserves it); the critic checks for the line *set* including `[scrub]`, and TS-12 emits it, so the scrubber is not orphaned. Pixel-exact stable-spine *verification* is deferred to a future render harness (a GAPS row, TS-4); the critic catches the structural anti-patterns it CAN see and grades teaching quality — it does not assert a `getBoundingClientRect` it cannot measure. **This is exactly why decision 10 exists:** "passes the critic" ≠ "looks like the mock," so an owner sign-off is the terminal gate, not the critic.

### 6. The locked layout-ledger is the standing acceptance bar, promoted into DESIGN.md

The `## Lesson layout` section already carries the four decisions near-verbatim (#73); promotion (TS-2) is a **status-flip** — drop "(design direction — not yet implemented)", mark it the LOCKED bar the critic gates against — plus reconciling any line the ledger phrases differently, **not** a content re-port. The critic prompt and every build diff against this on-`main` section.

### 7. v11 lands as a new `workflow_version`/StageBundle arm, A/B-comparable to the blob baseline

The sectioned schema bumps `LESSON_BRIEF_SCHEMA_HASH`; the prompt changes bump `PROMPTS_VERSION` — so the arm auto-distinguishes (ADR-0001 §5). The blob arm stays runnable so the graded critic proves the v11 win quantitatively. **The gating change rides this arm-scoping** (decision 3): "new behavior as a new arm, never mutate a default" applies to the *gate* too — the global default is not silently flipped to the graded LLM critic until calibration.

### 8. Token reconciliation is a Phase-0 blocker

`## 0. Token Manifest` IS the `globals.css` source, and the mock durations (200/440) disagree with `## 0` (120/220/360). TS-3 + `## 0` resolve every delta (OKLCH ramps, `--serif`, geometry/kind tokens, durations) as ADOPTED or KEPT-illustrative before any UI references an undefined token. The default (open question 5): **ADOPT** the OKLCH/serif/geometry/kind tokens (incl. `--scrub-w`) and the 200/440 durations — the mocks are the locked direction — recording a one-line rationale per token.

### 9. Curriculum/graph machinery stays DORMANT (ADR-0003)

The graph-ledger generating view reuses the LIVE single-lesson stage names (PLAN·RESEARCH·BRIEF·SPEC·CODE·CRITIC — **no GRAPH stage**) over the existing per-run `getStepEvents` stream; `step_event` does not graduate to durable storage; no `runPipeline`/`graph.ts` revival, no `/curriculum`→`/lesson` rename (that shim stays parked in `GAPS.md`). Any surfaced dormant vocabulary is tagged `DORMANT:`/`RETAINED:` so `scripts/check-concept-drift.sh` passes.

### 10. Terminal acceptance is an explicit human-owner visual-acceptance gate, not "all critics green"

Because the critic is honestly scoped to statically-checkable proxies + an LLM pedagogy judgement (decision 5), it cannot certify "this rendered lesson matches the v11 reference." So TS-15 (the produce-phase checkpoint lesson), TS-21 (the morph), and TS-25 (the final closeout) each carry a `HIL:` code-owner sign-off AC — `@julianken` (per `.github/CODEOWNERS`) confirms the rendered artifact matches the mocks/Figma reference. A `HIL:` from the code owner carries decision authority (AGENTS.md → HIL); it is the one gate that closes the "24 green issues still diverge from the mocks" hole. This is the epic's **terminal acceptance instrument** — green CI is necessary, not sufficient.

### 11. "lesson-workspace" and "library" are NEW canonical user-facing surface — additive descriptors, not a curriculum revival

The canonical noun is "one interactive lesson" (`INSTANCE.md` → "Product concept"). Adding "workspace" and "library" as user-facing vocabulary is a canonical-surface evolution: `check-concept-drift.sh` greps only the RETIRED terms (`curriculum`/`tiered`/`prerequisite knowledge graph`), so new nouns won't trip it — which is exactly why this ADR must declare them deliberately. **"library"** (the home that lists a user's lessons) and **"lesson-workspace"** (the v11 single-lesson layout) are recorded as **additive descriptors of the same single-lesson product**, not a curriculum revival; the RETIRED-terms list is unchanged. TS-26 reconciles `INSTANCE.md` (canonical-noun section) in the FRAME phase.

The public tagline/repo-description default is **unchanged for now** — "Generate an interactive, scaffolded lesson from a topic." (open question 6). *(Owner-confirmable: if the tagline should move once the library + reader ship, the orchestrator syncs the live value post-merge via `scripts/sync-repo-description.sh`; the reviewer only flags drift.)*

### 12. [Phase-0 lock] The cross-iframe progress/section-jump mechanism is decided here, not deferred to Phase 3

The opaque-origin iframe cannot be read by the parent without a `postMessage` contract. If that contract is wanted, the `code` stage must emit it — and the `code` stage ships in **Phase 2 (TS-13)**, long before the reader shell consumes it (TS-20, Phase 3). Deferring the choice to TS-20 would strand it: TS-13 would already have shipped without the contract, forcing a `code`-stage re-open. So the mechanism is locked at Phase 0:

- **Default — path (a):** the `code` stage emits a small `postMessage` contract (section list + scroll progress → parent), wired into TS-13's scope, enabling a real reading-progress bar + ⌘K section-jump + the in-iframe dot-scrubber's parent coordination (mock-faithful). TS-13 emits it; TS-20 consumes it (the parent reads *posted* progress/sections — it never reads the opaque-origin iframe DOM directly).
- **Alternative — path (b):** chrome-only progress affordances with the in-iframe TOC/scrubber-coordination deferred (a TS-4 GAPS row).

*(Owner-confirmable before TS-13 codes — open question 2. The default recorded here is path (a). TS-13 emits the contract **iff** path (a); TS-20 consumes whichever path is in force.)*

### 13. The library will durably hold a MIX of arms — "old lessons stay old," no backfill

Once both arms persist (TS-14), `listLessons` (TS-16) and the reader (TS-20) list blob-arm lessons (no sections/apparatus, possibly hardcoded `:root`) alongside v11-arm lessons. The accepted stance: **no migration/backfill of pre-v11 lessons; the library renders both shapes; serve-time injection (TS-19) re-themes only `var()`-contract lessons** (TS-19 AC2 documents this honestly). The card surfaces no per-arm badge by default (the `workflow_version` is queryable from the row if a future issue wants one — a GAPS-eligible follow-up, not in scope here).

## Open-question resolutions (the owner defaults this ADR records)

Each open question from the epic draft is recorded here as the decision in force. Two are flagged **owner-confirmable** — a default is taken so the program can proceed, but the owner may override before the gating issue codes.

1. **Output budget (gates Phase 2):** TS-5 is a **blocking feasibility spike** that measures real output against `code.ts`'s `maxTokens: 32000`. **Default if it exceeds the cap:** raise `maxTokens` to a recorded value **within the model's documented output limit** (anti-invention: the spike cites the limit), and/or adopt a two-pass shell-then-fill strategy. TS-5's measure is recorded as a **lower bound** on the real contract-driven prompt, so the chosen cap carries headroom.
2. **Cross-iframe progress/section-jump mechanism:** **Default — path (a):** the `code` stage emits a small `postMessage` contract (sections + scroll progress → parent) so the progress bar, ⌘K jump, and in-iframe dot-scrubber coordination are real and mock-faithful (decision 12). **Owner-confirmable before TS-13 codes.**
3. **Pixel-exact stable-spine verification:** **Accepted** — deferred to a future render harness (a TS-4 GAPS row), with the source-static proxies as the only in-CI gate for now. The mock-fidelity gap this leaves is covered by the code-owner `HIL:` visual sign-off (decision 10 / TS-15, TS-21, TS-25) — the owner is the terminal acceptance instrument the critic cannot be.
4. **Critic threshold + persistence shape:** a single documented `passed` threshold over the three sub-scores and a `critic_scores JSONB` column (vs typed columns) — JSONB keeps the migration trivial and the arm A/B-flexible. The JSONB column is **write-mostly for in-run gating**; the **queryable A/B substrate is the eleatic `_analysis` trace row** (TS-9/TS-14), not the column.
5. **Token reconciliation default (TS-3):** **ADOPT** the OKLCH/serif/geometry/kind tokens (incl. `--scrub-w`) and the 200/440 durations into `## 0` (the mocks are the locked direction), each tagged ADOPTED/KEPT-illustrative with a one-line rationale (decision 8).
6. **Canonical-surface stance / tagline:** "library" and "lesson-workspace" are **additive user-facing descriptors of the single-lesson product** (not a curriculum revival), with INSTANCE.md's canonical-noun reconciled in TS-26 (decision 11). The public repo-description/tagline stays **unchanged for now** — "Generate an interactive, scaffolded lesson from a topic." **Owner-confirmable if the tagline should move once the library ships** — then the orchestrator syncs the live value post-merge (the reviewer only flags drift).

## A note on the DESIGN.md heading anchor

DESIGN.md has **no numbered sections beyond `## 0`** — the lesson section is the `## Lesson layout (design direction — not yet implemented)` heading (which sits at line 49; the planning inputs mistook that *line number* for a "§49" section anchor). Every issue references it by that **heading text**, never a fabricated "§49" anchor (which would shift on any edit). This is a deliberate correction of a fabricated-anchor flaw in the planning inputs.

## Consequences

- The pipeline grows a graded critic schema (`CriticVerdict` v2), a typed sectioned `LessonSpec` + apparatus, and v11 `spec`/`code`/critic prompts — all shipped as a new `workflow_version` arm beside the runnable blob baseline (decision 7), so the win is A/B-provable.
- A `critic_scores JSONB` column lands on `concept_page` (the migration named in TS-8); `step_event` does NOT graduate to durable storage (decision 9).
- The chrome gains a library home, a reader shell wrapping the unchanged iframe, an OKLCH retoken reaching old lessons via serve-time injection (decision 4), and the signature card→reader container-box morph (decision 2) — none of which relaxes the trust boundary (decision 1).
- The terminal acceptance instrument is a code-owner `HIL:` visual sign-off (decision 10), not green CI.
- This ADR is **forward-only**: ADRs 0001/0002/0003 and the `docs/research/**` / `docs/plans/**` history are NOT retro-edited. `INSTANCE.md` is reconciled in TS-26; `SECURITY.md` needs no change (decision 1, re-confirmed at TS-19). The program view + dependency graph live in `docs/plans/lesson-workspace.md`.
