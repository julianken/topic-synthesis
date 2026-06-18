# Next.js structure — decision tails

## Recommended tree

# ── repo root (NOT under src/ — Next.js root requirements + tool configs) ──
# public/                        static assets — stay at root (create on first asset)
# package.json  tsconfig.json    @/* -> ./src/* (already correct); include globs all of src/ (see Risks)
# next.config.ts                 empty; per-response CSP lives in the artifact route
# postcss.config.mjs             Tailwind v4 (auto content-detect); fix stale app/globals.css comment
# vitest.config.ts               include: ['src/**/*.test.ts'] (covers src/eval; keep tests OUT of src/trigger)
# trigger.config.ts              NEW, at root: defineConfig from '@trigger.dev/sdk',
#                                dirs: ['./src/trigger']  (config file is root-only)
# .gitignore                     ADD eval-DB ignore in this PR (eval.sqlite or .eval/) — see Risks
# docker-compose.yml  .env.example  AGENTS.md / DESIGN.md / INSTANCE.md ...
# .eval/eval.sqlite (or ./eval.sqlite)  generated artifact — gitignored, never under src/

src/
  app/                          # Next.js App Router — ROUTING ONLY (RSC by default)
    globals.css                 #   moved from root app/; imported by layout via './globals.css'
    layout.tsx                  #   root layout: <html>/<body> + metadata (owns globals.css import)
    page.tsx                    #   intake-form landing
    api/
      generate/route.ts         #   POST -> tasks.trigger<typeof synthesizeCurriculum>() — TYPE-ONLY task import (lint-enforced)
    curriculum/
      [id]/page.tsx             #   tiered curriculum hub (RSC; imports @/store directly to read)
    artifact/
      [pageId]/route.ts         #   sandboxed artifact: Route Handler returns raw HTML + strict per-response CSP
                                #   + X-Content-Type-Options: nosniff. Isolation = hub's <iframe sandbox="allow-scripts">
                                #   (NO allow-same-origin) -> opaque origin. CEILING: same registrable origin as the hub
                                #   on a single Next deploy; true cross-origin host is a DEPLOYMENT change, not a path.

  components/                   # NEW (plan's top-level components/, now under src/) — shared route-adjacent UI
    curriculum-progress.tsx     #   the lone 'use client' island (useRealtimeRun); takes a public run token as a prop;
                                #   imports NO server-only module. (Route-PRIVATE UI -> src/app/<route>/_components/ instead.)

  domain/                       # EXISTING — pure types + Zod, no I/O, no next/*: settings · identity (contentIdentityKey) · stages (contracts) · sitemap.  NO barrel index.ts (cycle guard)
  llm/                          # EXISTING — the ONLY ai/@ai-sdk/* import site: client · models (tiers) · pricing · registry · cache  [import 'server-only']
  pipeline/                     # EXISTING — stages over injected StageDeps + the orchestrator:
                                #   planner · researcher · graph · coverage-gate · spec · code · critic · hub · deps
                                #   run-pipeline.ts  <- the engine-agnostic orchestrator (pure fn over the injected Engine seam)
                                #   [import 'server-only']; NO barrel index.ts (cycle guard)
  store/                        # EXISTING — Postgres: schema.sql · db.ts (pg pool) · migrate.ts (db:migrate entrypoint: tsx src/store/migrate.ts) · repo.ts  [import 'server-only']
  engine/                       # NEW (plan) — engine.ts (interface Engine { step<I,O> }) · trigger-engine.ts (Trigger.dev v4 impl)  [import 'server-only']
  trace/                        # NEW (plan) — the ONLY @eleatic/eval import site: span.ts · reduce.ts · eleatic-adapter.ts  [import 'server-only']
  trigger/                      # NEW (was sketched at ROOT) — Trigger.dev TASK files; discovered via dirs:['./src/trigger']
    synthesize-curriculum.ts    #   root orchestrator task (calls into pipeline/run-pipeline.ts via the Engine impl)
    synthesize-node.ts          #   per-node map task (spec -> code -> critic)
                                #   keep NO *.test.ts here: vitest's src/**/*.test.ts would run it in bare node w/o the Trigger harness
  eval/                         # NEW (was sketched at ROOT) — dev/CI harness, NOT routed app code
    run-skeleton.ts             #   E2E CLI driver (npm: tsx src/eval/run-skeleton.ts); writes eval.sqlite to the gitignored path
    smoke.test.ts               #   vitest smoke (matched by the existing src/**/*.test.ts glob)

# Risk to gate before src/trigger and src/eval land (see Risks): tsconfig `include` is **/*.ts(x), so it drags
# src/trigger/*.ts (imports @trigger.dev/sdk — NOT yet installed) and src/eval/run-skeleton.ts (a tsx CLI) into
# `npm run typecheck`/`npm run build`. Add a tsconfig `exclude` for those two dirs (or a separate tsconfig for tasks)
# in the SAME PR that introduces them, or the build can break before Trigger is even a dependency.

## Migration steps

1. Confirm the working tree is clean (`git status`) so the move is a reviewable, isolated diff.
2. `git mv app src/app` — moves globals.css, layout.tsx, page.tsx. layout.tsx's `import './globals.css'` is relative and needs no edit; the `@/*` -> ./src/* alias and the tsconfig/vitest globs are unchanged.
3. Verify exactly one app dir exists: `ls src/app` succeeds and `ls app` fails. If both exist, Next's resolution is ambiguous — delete the root one so only `src/app` remains.
4. Delete the stale build cache and any leftover root type shim before rebuilding: remove `.next/` (and a stray root `next-env.d.ts` if present) so App Router route types regenerate against `src/app` rather than the old `app/` path.
5. Run `npm run typecheck`, `npm test`, and `npm run dev` (then `npm run build`) to confirm zero churn: alias, relative CSS import, route types, and the existing src/ layers all still resolve.
6. Add the eval-DB ignore to `.gitignore` NOW (e.g. `eval.sqlite` or a `.eval/` dir) — before any eval run can produce a tracked DB. Decide the path here and use it consistently in the eval CLI and the `@eleatic/eval serve --db <path>` invocation.
7. Reconcile docs in this same PR: AGENTS.md Layout `app/` -> `src/app/` (SDK wording already correct, leave it); walking-skeleton.md move trigger/ app/ components/ eval/ under src/ and fix the line 89/91 `@anthropic-ai/sdk` comment to `ai`/`@ai-sdk/*`; postcss.config.mjs comment `app/globals.css` -> `src/app/globals.css`; write `No doc update needed` for DESIGN.md/INSTANCE.md unless a read finds an `app/` reference. Re-run `scripts/check-claude-shim.sh`.
8. When `src/trigger/` and `src/eval/` land (later PRs, not this move): in the SAME PR that introduces them, add a tsconfig `exclude` (or a dedicated tsconfig) for `src/trigger/**` and `src/eval/run-skeleton.ts` so `npm run typecheck`/`npm run build` don't drag in @trigger.dev/sdk (not yet a dep) or the tsx CLI; create root `trigger.config.ts` with `dirs: ['./src/trigger']`; add the `"skeleton": "tsx src/eval/run-skeleton.ts"` npm script.
9. When the boundaries are populated, add the lint guards as code (not just convention): `import 'server-only'` atop llm/pipeline/store/engine/trace; dependency-cruiser/ESLint pins for ai|@ai-sdk/* -> src/llm and @eleatic/eval -> src/trace; a no-circular rule over the DAG; and a no-restricted-imports rule that fails on a VALUE import of @/trigger/* from src/app (the type-only seam is otherwise unenforced).

## Conventions to adopt + enforce

- src/app is routing-only: routes, layouts, route handlers, metadata, and route-private _components/ — never domain/store/llm/pipeline logic.
- Shared route-adjacent UI lives in top-level src/components/ (the plan's components/, now under src/); curriculum-progress.tsx lives there. Use src/app/<route>/_components/ only for UI private to a single route.
- Server-only layers (llm, pipeline, store, engine, trace) start with `import 'server-only'`; the only 'use client' island is src/components/curriculum-progress.tsx, which imports no server-only module.
- ai and @ai-sdk/* are imported ONLY under src/llm/ (NOT @anthropic-ai/sdk, which is uninstalled); enforce with dependency-cruiser/ESLint, not convention.
- @eleatic/eval is imported ONLY under src/trace/ (the library the pipeline emits spans into), kept distinct from src/eval/ (the executable driver that reads eval.sqlite).
- Next triggers Trigger.dev tasks via a TYPE-ONLY import (import type + tasks.trigger<typeof task>()); a lint rule must FAIL the build on a value import of @/trigger/* from src/app, because the type-only seam does not self-enforce.
- run-pipeline.ts (the engine-agnostic orchestrator over the Engine seam) lives in src/pipeline/, alongside the stages and deps.ts.
- The db:migrate entrypoint is src/store/migrate.ts (already wired); the migration runner's home is fixed, not implicit.
- Import DAG is acyclic and one-directional (domain <- everything; store/llm/trace -> domain; pipeline -> domain + StageDeps; engine -> domain; trigger -> engine+pipeline+llm; app -> domain/store + trigger-by-type); enforce with a dependency-cruiser no-circular rule and avoid barrel index.ts files in the layers.
- Tests co-locate next to modules; src/eval/ holds the E2E driver + smoke.test.ts; NO *.test.ts under src/trigger/ (vitest would run it in bare node without the Trigger harness).
- trigger.config.ts stays at repo root with dirs:['./src/trigger']; the config file is root-only, only the task-discovery path moves under src/.
- The generated eval DB (eval.sqlite or .eval/) is a gitignored artifact written outside src/; never committed, never under src/.
- @/* is the canonical import form; no generic src/lib junk drawer.

## Open questions

- eval-DB path: `./eval.sqlite` at root vs a `.eval/` dir — either works once gitignored; pick one and use it consistently across the eval CLI and `@eleatic/eval serve --db <path>`. (Recommend `.eval/eval.sqlite` to keep the root tidy.)
- Scoping src/trigger and src/eval out of the Next/tsc typecheck: a tsconfig `exclude` is the lighter touch, but a dedicated tsconfig for the Trigger task graph (which has its own SDK + runtime assumptions) may be cleaner once @trigger.dev/sdk is installed — decide when that PR lands.
- trigger.config.ts `dirs` default could not be re-verified this turn (Context7 over quota). Setting `dirs: ['./src/trigger']` explicitly is correct regardless of the default; re-confirm the default against current Trigger.dev v4 docs when adding the config.
- Whether the artifact route ever needs true cross-origin isolation (a separate registrable origin / deployment) beyond the opaque-origin sandbox — a deployment decision, out of scope for this directory layout, flagged so a reader doesn't assume the route.ts path itself buys cross-origin.
- Whether to add a jsdom vitest project for src/components/ once client components surface (vitest.config currently runs node-only) — deferred until there is a component test to run.

## Risks

- BIGGEST UNEXAMINED RISK: tsconfig `include` is `**/*.ts(x)`, so after the move it type-checks ALL of src/ — including the coming src/trigger/*.ts (which import @trigger.dev/sdk, not yet a dependency) and src/eval/run-skeleton.ts (a tsx CLI). `npm run typecheck`/`npm run build` can break before Trigger is even installed. Mitigation: add a tsconfig `exclude` (or a dedicated tsconfig) for those two dirs IN THE SAME PR that introduces them. (The bare `git mv app src/app` move itself is safe — app is route code Next must type-check.)
- vitest `include: ['src/**/*.test.ts']` will collect any test placed under src/trigger/ and run it in the bare node env without the Trigger test harness (or two collectors contend over the file). Mitigation: keep Trigger task tests out of src/trigger/ entirely (convention above), or add a vitest exclude.
- If `.gitignore` is not updated in this PR, the first `tsx src/eval/run-skeleton.ts` writes a tracked `eval.sqlite` — committed by default (verified: .gitignore ignores neither eval.sqlite nor .eval/). Mitigation: add the ignore entry as part of the move PR.
- Stale `.next/` cache or a leftover root `next-env.d.ts` after the move can make src/app route types resolve against the old `app/` path until a clean rebuild — a post-move gotcha distinct from the 'two app dirs' one. Mitigation: delete `.next/` (and a stray root next-env.d.ts) and rebuild.
- The type-only task seam is NOT self-enforcing: a single value import of `@/trigger/*` from src/app silently pulls the whole task graph + AI SDK into the Next bundle. The 'High confidence' is about the exclusion MECHANISM existing, not about it being enforced here. Mitigation: a no-restricted-imports/dependency-cruiser rule that fails the build on a value import of @/trigger/* from src/app.
- Cycle risk: with every module one `@/*` hop away, a stray barrel index.ts in domain/ or pipeline/ is the usual way the domain<-everything DAG grows a silent cycle. dependency-cruiser pinning for the SDK boundaries does NOT catch this. Mitigation: add a no-circular rule and avoid barrel index.ts files in the layers.
- Artifact isolation ceiling: on a single Next deployment, src/app/artifact/[pageId]/route.ts is served from the SAME registrable origin as the hub, so sandbox=allow-scripts (opaque origin) is the only isolation the directory layout can buy. A reader could wrongly assume the route.ts path itself provides cross-origin isolation; true cross-origin hosting is a deployment change, not a directory change.
- Doc-accuracy risk corrected from the draft: AGENTS.md line 106 already names the Vercel AI SDK correctly — only walking-skeleton.md (lines 89/91) still says @anthropic-ai/sdk. Mis-listing an AGENTS.md SDK 'fix' would have a reviewer hunt for a non-existent change; the only AGENTS.md drift the move creates is the app/ -> src/app/ path token.
- Trigger.dev `dirs` default and the exact src-directory/route-handler doc citations were verified in a prior pass but NOT re-verified this turn (Context7 over quota). The tree-derived facts (paths, scripts, ignores, globs) are firm; the doc-version citations should be treated as prior-pass, not today's.
