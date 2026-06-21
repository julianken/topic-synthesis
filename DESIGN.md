# DESIGN.md — Topic Synthesis

> **This file is the whole truth for design.** An agent that has never opened this app must be able to rebuild any surface to pixel fidelity from this document alone. Every value here is concrete and current. Where this file and the working build disagree, the build wins; reconcile this file to match it.
>
> **Authority:** shipped build > `DESIGN.md` > Figma (see AGENTS.md → "Design source of truth"). No Figma file is configured for this product yet, so `DESIGN.md` is the sole design source today.

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
- **Progress** — a single-lesson generating state: an eyebrow → "Generating…" → a `.lead` ("Researching and building your lesson.") + the spinner (`.generating`); the client polls run status (the one-page curriculum appears atomically when the run completes). No per-node timeline — the live path builds one lesson.
- **Single lesson** (`/curriculum/<id>`) — the read route for a completed single-lesson run. Standalone framing: the parent topic as eyebrow → the lesson title as `h1` → `.lead` (`level · depth N`), then the lesson's interactive artifact in the sandboxed `.artifact-frame` (`sandbox="allow-scripts"`, no `allow-same-origin`). When the run produced a non-`built` (`soon`/`text`) lesson, a labeled degraded state (`.lesson-degraded`: a status `.badge` with label + icon + a `.lead`) replaces the frame — never a blank iframe.
- **Curriculum hub** (tiered SITEMAP — DORMANT) — tier → category → page tiles; built tiles link to the page, `soon`/`text` tiles are muted with a status badge. Built by `tileView` + the tiered CSS (`.hub`/`.tier`/`.tiles`/`.tile*`/`.category*`); retained for the future curriculum-wrapper milestone (decompose → N lessons) but **not** rendered by `/curriculum/<id>` today, which renders the single lesson directly.
- **Page tile** (DORMANT — part of the tiered hub above) — title + status badge (`--status-built` / `--status-soon` / text).
- **Artifact frame** — sandboxed cross-origin iframe; the chrome supplies only the frame (a "report a problem" affordance is deferred).
- **Sign in** (`(auth)/sign-in`) — a `.wrap` card: eyebrow → h1 → `.lead` → a single "Continue with Google" `.btn`, with branded `.intake__error` states for a rejected / non-allowlisted account. The Google consent popup is the one external surface; no values beyond the §0 tokens.
- **Session top bar** (`.topbar`) — right-aligned; the signed-in email in `--text-muted` + a `.topbar__signout` text button in `--interactive` (focus-visible ring, reduced-motion-safe). Shown only when signed in, so the sign-in page stays chromeless.

## Accessibility
Target WCAG 2.2 AA. Visible `:focus-visible` ring (2px `--interactive`). Full keyboard operability of the form + hub. Status by label+icon, not color alone. Reduced motion honored (§Motion). Generated artifacts carry their **own** a11y contract (a generation target — see `docs/plans/`); the chrome never depends on an iframe's internals for its own accessibility.
