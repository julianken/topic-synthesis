# DESIGN.md — Topic Synthesis

> **This file is the whole truth for design.** An agent that has never opened this app must be able to rebuild any surface to pixel fidelity from this document alone. Every value here is concrete and current. Where this file and the working build disagree, the build wins; reconcile this file to match it.
>
> **Authority:** shipped build > `DESIGN.md` > Figma (see AGENTS.md → "Design source of truth"). A Figma design file is now configured as a **read-only design-direction reference** (`INSTANCE.md` → "Design / Figma (read-only)"); `DESIGN.md` remains the design source of truth and wins on any conflict — a disagreeing Figma value is reconciled into §0 here, never built from.

**This is v0**, scoped to the walking-skeleton chrome (intake form, curriculum hub, page tile, progress, sandboxed artifact frame). It grows as surfaces land. Keep raw literals in §0 only; reference tokens by name everywhere else.

---

## 0. Token Manifest

**Color primitives**
- `--c-ink-950 #0a0d12` · `--c-ink-900 #11151c` · `--c-ink-800 #1a212b` · `--c-ink-700 #2a333f`
- `--c-fog-100 #e8edf3` · `--c-fog-300 #aab6c4` · `--c-fog-500 #6b7888`
- `--c-accent-500 #5b9dff` · `--c-accent-400 #8bb8ff`
- `--c-built-500 #3ecf8e` · `--c-soon-500 #c9a227` · `--c-danger-500 #ff6b6b`

**Semantic** (reference primitives)
- bg: `--bg-app → ink-950` · `--bg-surface → ink-900` · `--bg-raised → ink-800` · `--border → ink-700`
- text: `--text → fog-100` · `--text-muted → fog-300` · `--text-faint → fog-500`
- interactive: `--interactive → accent-500` · `--interactive-hover → accent-400`
- status: `--status-built → built-500` · `--status-soon → soon-500` · `--status-error → danger-500`

**Type scale (rem)** `--fs-hero 2.5` · `--fs-h1 1.875` · `--fs-h2 1.375` · `--fs-body 1` · `--fs-small 0.875` · `--fs-mono 0.9375`
**Space (rem)** `--sp-1 .25` · `--sp-2 .5` · `--sp-3 .75` · `--sp-4 1` · `--sp-5 1.5` · `--sp-6 2` · `--sp-7 3`
**Radii** `--r-sm 6px` · `--r-md 10px` · `--r-lg 16px`
**Motion** `--dur-fast 120ms` · `--dur-base 220ms` · `--dur-slow 360ms` · `--ease-out cubic-bezier(.16,1,.3,1)` · `--ease-in-out cubic-bezier(.65,0,.35,1)`

## Color & contrast
Dark, technical palette (inspired by the ai-concept-viz explainers). Body `--text` on `--bg-app` clears WCAG AA for normal text; muted text used only at ≥ `--fs-body`. Status is always conveyed by **label + icon**, never color alone. Target: WCAG 2.2 AA.

## Typography
Chrome: system UI stack (`ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif`). Code/tokens (and generated pages' code): monospace (`ui-monospace, SFMono-Regular, Menlo, monospace`). Scale per §0; line-height 1.5 body / 1.2 headings.

## Motion
Transitions use the **`transitions-dev`** snippet catalog (copy-paste CSS, no runtime dependency) at the §0 durations/easings. Allowed in the skeleton: staggered hub-tile reveal, modal/panel open, status-badge change, progress updates. **Reduced motion:** `@media (prefers-reduced-motion: reduce)` removes non-essential transitions and staggers; status/progress change instantly.

## Components (skeleton surfaces)
- **Intake form** — topic field + settings (level, depth); submit triggers a generation run.
- **Progress** — a single-lesson generating state: an eyebrow → "Generating…" → a `.lead` ("Researching and building your lesson.") + the spinner (`.generating`); the client polls run status (the one-page curriculum appears atomically when the run completes). Above the spinner, a **per-step timeline** (`.timeline`) renders the run's pipeline steps as they happen: each finished step shows its wall-clock duration (e.g. `3.2s`); the one in-progress step shows a **live ticking elapsed timer** that freezes into a duration on completion; a failed step is labeled (`· failed`, `--status-error`). The timeline is driven by the status poll's owner-scoped `steps` (the durable per-step timing the Job records); it is absent until the first step lands and is reduced-motion-safe (the timer is a number, not a transition). The timer/durations use the monospace stack with tabular figures so the digits don't jitter (§Typography).
- **Single lesson** (`/curriculum/<id>`) — the read route for a completed single-lesson run. Standalone framing: the parent topic as eyebrow → the lesson title as `h1` → `.lead` (`level · depth N`), then the lesson's interactive artifact in the sandboxed `.artifact-frame` (`sandbox="allow-scripts"`, no `allow-same-origin`). When the run produced a non-`built` (`soon`/`text`) lesson, a labeled degraded state (`.lesson-degraded`: a status `.badge` with label + icon + a `.lead`) replaces the frame — never a blank iframe.
- **Curriculum hub** (tiered SITEMAP — DORMANT) — tier → category → page tiles; built tiles link to the page, `soon`/`text` tiles are muted with a status badge. Built by `tileView` + the tiered CSS (`.hub`/`.tier`/`.tiles`/`.tile*`/`.category*`); retained for the future curriculum-wrapper milestone (decompose → N lessons) but **not** rendered by `/curriculum/<id>` today, which renders the single lesson directly.
- **Page tile** (DORMANT — part of the tiered hub above) — title + status badge (`--status-built` / `--status-soon` / text).
- **Artifact frame** — sandboxed cross-origin iframe; the chrome supplies only the frame (a "report a problem" affordance is deferred).
- **Sign in** (`(auth)/sign-in`) — a `.wrap` card: eyebrow → h1 → `.lead` → a single "Continue with Google" `.btn`, with branded `.intake__error` states for a rejected / non-allowlisted account. The Google consent popup is the one external surface; no values beyond the §0 tokens.
- **Session top bar** (`.topbar`) — right-aligned; the signed-in email in `--text-muted` + a `.topbar__signout` text button in `--interactive` (focus-visible ring, reduced-motion-safe). Shown only when signed in, so the sign-in page stays chromeless.

## Lesson layout (LOCKED — the standing acceptance bar)

The **LOCKED** spec the generated single-lesson page is built and critiqued against — the standing acceptance bar the graded critic gates the artifact on and every build diffs against. This section wins on any lesson-layout conflict and is the single source of truth (it supersedes the scratch ledger, now promoted here — see below). The reference implementation is the scratch mockup `.superpowers/topic-synthesis-lesson-workspace-v11.html`. The in-run critic (TS-7) scores the **current** artifact against this bar only; *regression vs. the best prior version* is an **offline** eleatic `--baseline` bench comparison, **not** an in-run critic gate (program decision 3 — see the program doc, `docs/plans/lesson-workspace.md`; this section does not restate the program decisions, it points at them).

**The workspace.** A lesson is a two-column **workspace**, never a page-container/void: a frozen reading column (measure ~62ch) plus an always-full **apparatus panel** docked beside it. The whole reading+panel assembly is capped (~1500–1640px) and centered with equal gutters; "use the area" is satisfied by the full apparatus column, not by stretching prose to the viewport edge. Surfaces use the dark §0 tokens; the card↔reader morph lives on a single `#readerPanel.morph-box` wrapper.

**Four locked decisions:**
1. **Densify every section.** Each section carries a curated apparatus stack — key-term glosses (term dotted in prose, definition in the panel), a where-am-I/progress cue, a teaching mini-figure where it helps, live readouts when a component runs, sources where they exist. The working column is full on *every* section — full **because each section carries apparatus, NOT because citations exist** (typically only a fraction of sections cite a source). Apparatus must *add* what the prose doesn't already state — never filler — capped at ≤3 glosses + ≤1 mini-figure per section to avoid a dashboard.
2. **Lone element centers its text.** A genuinely standalone element with no apparatus beside it sets its text `text-align:center`, applied at the block/section level — never per-paragraph alternation inside a paired section.
3. **Cap + center the assembly.** Capped width, equal gutters, **nothing pinned to the true viewport edge** — scrubbers and controls live inside the capped frame, not against the screen edge.
4. **Stable spine (HARD rule — wins all conflicts).** The reading column holds the *exact* same horizontal position and width for every paragraph and across section boundaries. A lone element center-aligns its text *within* the fixed column; it never moves the column. Zero left-right jitter.

**Named grid-line set (the critic-gated literal).** The lesson workspace is a CSS grid whose canonical column track names are `[screen-start] [read] [gap] [panel] [scrub]`. This is the abbreviated set the critic gates on and the synthesis stage emits — TS-7's `code` critic checks for its presence (including `[scrub]`) and TS-12's `code` stage emits it, so the literal lives **here** (which wins on design conflict) and both reference this one source. The `[scrub]` track is reserved for the in-iframe dot-scrubber rail, parked inside the capped frame so the scrubber is not an orphaned track and nothing is pinned to the true viewport edge. The v11 reference mock materializes a fuller line set (`[screen-start] [read-start] … [read-end] [gap] [panel-start] … [panel-end] [scrub] … [screen-end]`) as the reference implementation; the abbreviated names above are the canonical critic-gated set, not the only legal track labels.

**Per-section composition** (decided per section, not one global pick):
- **With apparatus** (≈all sections post-densify): a 2-column unit — frozen prose spine on the left (text left-aligned), apparatus docked in the right panel track beside it.
- **Without apparatus** (rare): prose stays on the same fixed spine, text center-aligned, panel track absent — the spine does not move.

**Invariants:** two columns max — never one, never three. Interactive components (the Play interactive) get a full-width bounded plate, fully visible, with no prose overlap. Citations render beside their text in the panel, never a lone card in a void. Responsive: collapse to one column ≤~900px (apparatus reflows directly under the prose it annotates); no horizontal overflow at 390 (the topbar fits within the viewport; the wordmark is hidden ≤640). Reduced-motion + a11y are correctness, not polish (§Motion, §Accessibility).

**Anti-patterns (rejected — must not recur):** reserved/empty margin · single column · prose-over-component occlusion · per-paragraph horizontal jitter · lopsided/left-pinned prose with dead right · an edge-pinned lone element at wide viewports · clipped figures or labels.

**Provenance.** The scratch constraint ledger `.superpowers/lesson-layout-ledger.md` (LOCKED 2026-06-24) is **promoted** into this section — `DESIGN.md` `## Lesson layout` is now the source of truth and wins on any conflict; the scratch ledger is retained as the provenance record only, not the SoT.

## Accessibility
Target WCAG 2.2 AA. Visible `:focus-visible` ring (2px `--interactive`). Full keyboard operability of the form + hub. Status by label+icon, not color alone. Reduced motion honored (§Motion). Generated artifacts carry their **own** a11y contract (a generation target — see `docs/plans/`); the chrome never depends on an iframe's internals for its own accessibility.
