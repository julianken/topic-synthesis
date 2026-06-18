## Structure decision: topic-synthesis (Next.js 16 App Router, everything under `src/`)

### 0. Ground truth (verified against the live tree this turn)

I read the live tree before recommending. Current state:

- **Root `app/`** holds `globals.css`, `layout.tsx`, `page.tsx`. `layout.tsx` imports `'./globals.css'` (a *relative* import — it survives `git mv` untouched).
- **`src/`** holds `domain/`, `llm/`, `pipeline/`, `store/` — the four pure/server layers, no `app` inside it. `src/store/` already contains `migrate.ts` (the `db:migrate` entrypoint), `db.ts`, and `schema.sql`. `src/pipeline/` holds the seven stages + `deps.ts`, and **does not yet** contain `run-pipeline.ts`.
- **`tsconfig.json`**: `"@/*": ["./src/*"]`; `include` is `["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts", ".next/dev/types/**/*.ts"]`. Adding `src/app` needs **no** `paths` or `include` edit — but see §5/Risks: that broad `**/*.ts(x)` glob is exactly why the coming `src/trigger/` and `src/eval/` need an explicit guard.
- **`vitest.config.ts`**: `include: ['src/**/*.test.ts']`, `environment: 'node'`. It already matches `src/eval/smoke.test.ts` — and would *also* match a test placed under `src/trigger/` (see Risks).
- **`next.config.ts`** is `{}` with a comment that CSP is set per-response in the artifact route. No `app`/`dir` config to repoint.
- **`postcss.config.mjs`** uses Tailwind v4 via `@tailwindcss/postcss`, no content glob (v4 auto-detects). Its only `app/` reference is a stale doc-comment (`tokens live in app/globals.css`) — cosmetic.
- **`.gitignore`** (verified) ignores `node_modules/`, `.next/`, `out/`, `build/`, `next-env.d.ts`, `*.tsbuildinfo`, `.env`, `.env*.local`, `tmp/`, and tooling dirs. It ignores **neither `eval.sqlite` nor `.eval/`** — so a generated eval DB at either location would be committed unless this PR adds the entry.
- **No `trigger/`, `trigger.config.*`, `eval/`, `components/`, `engine/`, or `trace/` yet** — those are still-to-come per `docs/plans/walking-skeleton.md`.

**One correction to the *plan*, scoped precisely (the draft over-claimed here):** `AGENTS.md` line 106 is already **correct** — it says "the only LLM-SDK import site — Vercel AI SDK + provider packages." The stale `@anthropic-ai/sdk` naming survives only in `docs/plans/walking-skeleton.md` (lines 89 and 91), and `@anthropic-ai/sdk` is **not** an installed dependency. The actual LLM deps (`package.json`, verified) are `ai@6` + `@ai-sdk/anthropic` + `@ai-sdk/google` + `@ai-sdk/openai` + `@ai-sdk/openai-compatible`. So the import-boundary guard restricts **`ai` and `@ai-sdk/*`** to `src/llm/`. The only AGENTS.md drift this *move* creates is the `app/` → `src/app/` path string in its Layout line — its SDK wording needs no change.

### 1. TL;DR

1. **Do the one move and nothing more:** `git mv app src/app`, then verify no root `app/` survives. Next resolves `src/app` only when a root `app/` is absent; if both exist, behavior is governed by which directory the framework prefers — so the migration's first job is to ensure exactly one exists. The `@/*` → `./src/*` alias and the existing globs keep working with no `paths`/`include` edit.
2. **Keep `src/app` routing-only** (RSC by default), and keep the existing horizontal layers — `domain`, `llm`, `pipeline`, `store` — as **peer top-level `src/` folders**, joined by the coming `engine`, `trace`, `trigger`, `eval`. Next's project-structure guidance treats co-locating non-route code outside `app/` (whether under `src/` or not) as a supported pattern, not a mandate; it does not prescribe these specific folder names. Feature-folders are a poor fit here (one pipeline-feature ⇒ one mega-feature + a `shared/` catch-all), so horizontal layers stay.
3. **Resolve every tool that defaults to a root dir by config, not by exempting it from `src/`.** Trigger.dev discovers tasks via `dirs` in `trigger.config.ts`; set `dirs: ['./src/trigger']` (the config *file* stays at repo root). vitest's glob already covers `src/**`. The eval CLI runs as `tsx src/eval/run-skeleton.ts` via an npm script. The plan's earlier sketch of root `trigger/` + root `eval/` is superseded by the settled "everything under `src/`" decision.
4. **The sandboxed artifact is a Route Handler, not a page:** `src/app/artifact/[pageId]/route.ts` returns a raw `Response` with a strict per-response CSP + `X-Content-Type-Options: nosniff`. The actual isolation comes from the embedding hub's `<iframe sandbox="allow-scripts">` (no `allow-same-origin`), which forces an **opaque origin**. Note the ceiling (Risks): on a single Next deployment this route is served from the *same registrable origin* as the hub, so `sandbox` (opaque origin) is the only isolation a directory choice can buy — true cross-origin hosting is a deployment change, not a path. A `page.tsx` here would render in your RSC tree at your real origin and defeat the model.
5. **Enforce the boundaries with lint, not vibes:** `import 'server-only'` atop `llm`/`pipeline`/`store`/`engine`/`trace`; a dependency-cruiser/ESLint rule pinning `ai`/`@ai-sdk/*` to `src/llm` and `@eleatic/eval` to `src/trace`; a **no-cycles** rule guarding the DAG; and — because the Next app triggers tasks by `import type` only — a `no-restricted-imports` rule (or dependency-cruiser `not`) that flags a *value* import of a `@/trigger/*` task from `src/app`, since the type-only seam is otherwise unenforced (see Risks/ledger).

### 2. Confidence ledger

The "verified" rows below were verified against docs in a prior pass and carried specific doc versions; **Context7 was over quota this turn**, so I could not re-pull them — they are reproduced from the prior verification, not re-confirmed today. Rows marked "tree (this turn)" were verified against files this turn and are firm.

| Claim | Confidence | Basis |
|---|---|---|
| `git mv app src/app`; root config + `public/` stay at root | **High** | Next.js src-directory doc (prior pass, v16.2.9) |
| Next is unopinionated about non-route layout; the layer split is sanctioned, not mandated; no required `src/lib`; Next does not prescribe these folder names | **High** | Next.js project-structure doc (prior pass) |
| Exactly one of root `app/` / `src/app` must exist; ensure root `app/` is gone post-move | **High** | Next.js src-directory doc (prior pass) — phrased as "ensure one exists," not "Next silently prefers X" |
| `trigger.config.ts` at repo root; `dirs` accepts a custom path so `./src/trigger` is valid; setting `dirs` explicitly is recommended | **Medium** | Trigger.dev config-file doc (prior pass, v4) — could not re-verify the exact default this turn |
| `import 'server-only'` → build-time error on client import | **High** | Next.js Server/Client doc (prior pass) |
| `route.ts` nests at any leaf, returns a developer-controlled `Response` with custom headers, cannot coexist with `page.tsx` at the same segment | **High** | Next.js route.js API ref (prior pass) |
| Type-only task import keeps task code + its deps out of the Next build *mechanism exists*; it is **not** self-enforcing — a value import silently re-includes them unless a lint rule fails the build | **High (mechanism) / not enforced until the lint rule lands** | Trigger.dev triggering doc (prior pass) + the absence of any guard in this repo (tree, this turn) |
| Trigger.dev's own Next.js example uses a **root** `trigger/`; `./src/trigger` is our choice via `dirs`, idiomatic but not a CLI default | **Medium** | Trigger.dev Next.js guide (prior pass) |
| LLM single-import-site = `ai` + `@ai-sdk/*` (NOT `@anthropic-ai/sdk`, which is uninstalled) | **High** | `package.json` (tree, this turn) |
| `db:migrate` runs `tsx src/store/migrate.ts`; the migration runner is `src/store/migrate.ts` | **High** | `package.json` + `src/store/` listing (tree, this turn) |
| `run-pipeline.ts` belongs in `src/pipeline/` (engine-agnostic orchestrator over the Engine seam) | **High** | plan line 88 + AGENTS.md Layout (tree, this turn) |
| `.gitignore` ignores neither `eval.sqlite` nor `.eval/` today | **High** | `.gitignore` (tree, this turn) |
| `tsconfig include` `**/*.ts(x)` globs all of `src/` into typecheck/build; `vitest include` matches any `src/**/*.test.ts` | **High** | `tsconfig.json` + `vitest.config.ts` (tree, this turn) |
| Shared-UI home: top-level `src/components/` (the plan's choice) vs route-local `src/app/_components/` | **Medium** | both are Next-supported; reconciled below in favor of the plan |

### 3. Conventions to adopt + enforce

- **`src/app` is routing-only.** Routes, layouts, route handlers, metadata files, and route-local `_components/` only. All non-route logic lives in sibling `src/` layers. A private `_folder` opts out of routing; a `(group)` folder never creates a URL segment.
- **Shared UI home = top-level `src/components/` (reconciled with the plan).** The plan lists a top-level `components/` with `curriculum-progress.tsx`; under the settled "everything under `src/`" decision that becomes **`src/components/`**, and that is where `curriculum-progress.tsx` (the lone `'use client'` Realtime island) lives — it is consumed by the curriculum hub route, i.e. it is shared route-adjacent UI, not strictly route-local. Use `src/app/<route>/_components/` only for a component that is genuinely private to one route and never reused. This replaces the draft's "promote later" hedge with a definite home.
- **Server-only boundary.** `import 'server-only'` (add the `server-only` package) atop `src/llm`, `src/pipeline`, `src/store`, `src/engine`, `src/trace`. `src/components/curriculum-progress.tsx` receives a public run token as a prop and imports **no** server-only module.
- **LLM single-import-site.** `ai` and `@ai-sdk/*` only under `src/llm/`. Enforce with dependency-cruiser / ESLint `no-restricted-imports`.
- **Trace single-import-site.** `@eleatic/eval` only under `src/trace/` (`eleatic-adapter.ts`). Keep `src/trace` (library: the pipeline emits spans into it) distinct from `src/eval` (executable driver + smoke test that *reads* `eval.sqlite`).
- **Type-only task trigger — enforced, not assumed.** `src/app/api/generate/route.ts` does `import type { synthesizeCurriculum } from '@/trigger/synthesize-curriculum'` + `tasks.trigger<typeof synthesizeCurriculum>(...)`. Add a `no-restricted-imports` / dependency-cruiser rule that **fails the build** on a *value* import of `@/trigger/*` from `src/app`; the type-only seam does not self-enforce.
- **Import DAG (no cycles), with a no-cycles guard.** `domain` ← everything; `store`/`llm`/`trace` → `domain` only; `pipeline` → `domain` + injected `StageDeps`; `pipeline/run-pipeline.ts` → stages + the `Engine` interface from `engine` (by type); `engine` → `domain` (+ Trigger SDK); `trigger` → `engine` + `pipeline` + `llm`; `app` → `domain`/`store` for reads, `trigger` **by type only**. `domain` and `pipeline` import no `next/*`. Add a dependency-cruiser `no-circular` rule: with every module one `@/*` hop away, a stray `index.ts` barrel in `domain/` or `pipeline/` is the usual way this DAG silently grows a cycle, and the no-cycles rule is the enforcement that actually protects it. Avoid barrel `index.ts` files in the layers for the same reason.
- **Test placement.** Co-locate unit tests next to modules (`src/pipeline/graph.test.ts`); reserve `src/eval/` for the cross-stage E2E driver + `smoke.test.ts`. Keep tests **out of `src/trigger/`**: vitest's `src/**/*.test.ts` would otherwise collect a Trigger task test and run it in the bare node env without the Trigger test harness (a real failure mode, not just tidiness).
- **`@/*` alias is the canonical import form** (`@/domain`, `@/llm`, `@/trigger/...`). No generic `src/lib` junk drawer — the repo already has named layers.

### 4. Tensions vs "everything under `src/`" — and the resolution

Every tension resolves to a **config override**, never an exception to the rule:

1. **Trigger.dev** (plan sketched root `trigger/`; Trigger's own Next.js example uses root `trigger/`). Resolve: tasks at `src/trigger/`, `dirs: ['./src/trigger']` in the **root** `trigger.config.ts`. The config *file* stays at repo root; only the discovery path moves.
2. **vitest** root `vitest.config.ts` already matches `src/**/*.test.ts` — no change, but see the `src/trigger/` test-collection caveat above and the typecheck caveat below.
3. **eval CLI** (`run-skeleton.ts`) — run via `"skeleton": "tsx src/eval/run-skeleton.ts"`. The generated `eval.sqlite` is an artifact, not source: write it to a **gitignored** location and add the ignore entry in this PR (see §5/Risks). `npx @eleatic/eval serve --db <path>` reads it; never write it under `src/`.
4. **Next.js itself.** The only genuine "must": exactly one of root `app/` / `src/app` exists post-move (delete the root one), and `public/` + all config + `.env*` stay at root. A future middleware/proxy must live **inside** `src/` under the src layout.

### 5. Migration from today (ordered; executable list in migrationSteps)

The structural move is a single `git mv`; the rest is land-as-you-go placement plus doc + ignore-file reconciliation. Because the alias already points at `./src/*` and `app/layout.tsx` imports `./globals.css` relatively, there is **no import or alias churn**. Three things the draft missed are folded into the steps:

- **`db:migrate` has a concrete home.** It already runs `tsx src/store/migrate.ts`; the move does not touch it. Stated here so the migration runner's location is not left implicit.
- **`.gitignore` must gain the eval-DB ignore in the same PR** — otherwise the first `tsx src/eval/run-skeleton.ts` produces a tracked `eval.sqlite`.
- **A clean `.next` rebuild after the move** — `tsconfig` includes `.next/types/**` and `.next/dev/types/**`; a stale `.next/` cache or a leftover root `next-env.d.ts` can make `src/app` route types resolve against the old path. Delete `.next` and rebuild so App Router route types regenerate for `src/app`.

### 6. Doc-currency (the repo's Update-Triggers rule binds this change)

Same-PR reconciliation, corrected so it no longer asserts a non-existent AGENTS.md fix and no longer omits `.gitignore`:

- **`.gitignore`** — **add** an ignore entry for the generated eval DB (e.g. `eval.sqlite` or a `.eval/` dir, matching the path chosen in step 6). Omitting this commits the DB. (Was missing from the draft's list.)
- **`AGENTS.md` → "Working in the tree → Layout"** — change the `app/` path token to `src/app/`. **Its SDK wording is already correct** ("Vercel AI SDK + provider packages") and needs no edit. Then re-run `scripts/check-claude-shim.sh`.
- **`docs/plans/walking-skeleton.md`** — move the `trigger/`, `app/`, `components/`, `eval/` blocks under `src/` (→ `src/trigger`, `src/app`, `src/components`, `src/eval`), and correct the line 89 + line 91 `@anthropic-ai/sdk` comment to `ai`/`@ai-sdk/*`. The plan's `app/`-prefixed route paths on lines 137/149/186/204 become `src/app/`.
- **`postcss.config.mjs`** — fix the stale `app/globals.css` doc-comment → `src/app/globals.css`.
- **`DESIGN.md` §0** — only if it references `app/globals.css` for token materialization; on inspection it does not appear to (no `app/` hit in the grep), so write `No doc update needed` for it unless a later read finds one.
- **`INSTANCE.md`** — only if its layout/status prose names root `app/`; no `app/` hit in the grep, so `No doc update needed` absent a found reference.
- For any listed file that does not actually reference the path, write `No doc update needed` for it explicitly, per the rule.