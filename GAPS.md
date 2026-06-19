# GAPS.md

A ledger of repo / agent-setup capabilities **deliberately not built yet**, each with the trigger that should wake it. A fresh template instance is typically pre-code, solo, and client-side, so most tooling a mature repo carries would have nothing to act on yet — no dependency graph to scan, no UI to guard, no deadline to age against. This file records *why* each deferred thing is absent and *what* should bring it back, so a deferred item resurfaces when its trigger fires instead of being silently forgotten or re-litigated.

Scope: the repo's tooling, CI, agents, skills, and process scaffolding. Not a product backlog — features/tools live in issues and [`DESIGN.md`](DESIGN.md), not here.

This file is itself drift-prone, so it sits in the [`AGENTS.md`](AGENTS.md) "Keeping docs and drift-prone files current" Update Triggers logic: when a process or roadmap change fires or retires one of the triggers below, reconcile this file in the same PR. A row whose trigger has already fired but is still parked under "Deferred" is a finding — raise it the way that section says (a non-blocking IMPORTANT note, never a merge blocker). Don't restate `AGENTS.md`, `DESIGN.md`, or `SECURITY.md` here; cross-reference them.

How to use a row: each is `Item | Trigger that should wake it | Why deferred`. Add a row when you consciously skip a capability that a future state will need; strike it through and annotate **WOKEN** (with a date) when its trigger fires and you build the thing in the same PR; delete it only once the woken note has outlived its usefulness.

---

## Deferred (build when the trigger fires)

The ledger starts **empty for a fresh instance** — there is no inherited backlog to carry. Populate it as you make deliberate deferral decisions for *this* product (e.g. dependency-hygiene tooling once a `package.json` and lockfile land, a commit-gated lint hook once there is shipping code, additional repo agents/skills once they exist).

Deferrals from the deployment/orchestration architecture ([`docs/decisions/0001`](docs/decisions/0001-deployment-orchestration-and-swappability.md)):

| Item | Trigger that should wake it | Why deferred |
| --- | --- | --- |
| Next-free `core` workspace package (extract domain/llm/pipeline/engine/store) | ~~The first cloud-deploy PR — the one adding the pipeline Job's Dockerfile~~ — **FIRED 2026-06-19, consciously RE-DEFERRED**; re-wake on image-pull-latency pain or a published-package need | The Job ships single-repo: `Dockerfile.job` runs `tsx src/eval/run-job.ts` with the full deps. The split (a smaller image dropping next/tsx from the Job runtime) is a size optimization, not a blocker — a scale-to-zero Job idling at $0 doesn't care about ~80MB of unused layers, and the import fence already guarantees the core is Next-free. Coupling is packaging-only + extraction stays a cheap file-move. |
| ~~Terraform / GCP deploy foundation (Cloud SQL, Secret Manager, Artifact Registry, IAM, GCS state)~~ — **WOKEN 2026-06-19** | ~~The local e2e produces a curriculum end-to-end~~ — fired | Applied: `infra/` Terraform provisioned `topic-synthesis-prod` — Cloud SQL Postgres 16 + registry + secrets + runtime SA. The remaining **Cloud Run Service+Job + WIF** are the active deploy PRs (the `GcpEngine` + `core`-workspace rows below cover the code half). |
| ~~`GcpEngine` (Postgres `step_results` adapter behind the `Engine` seam)~~ — **WOKEN 2026-06-19** | ~~Cloud-deploy phase~~ — built ahead of the Cloud Run Job | Built: `src/engine/gcp-engine.ts` + the `step_result` table — durable per-run step memoization (crash-resume reads completed steps back, never re-running paid work) + in-process fan-out dedup. Wired into the Cloud Run Job in the deploy PRs. |
| DBOS Transact (durable-execution library upgrade behind the same seam) | Durable-execution fragility: queue fan-out beyond `Promise.all`, human-in-the-loop waits, or crash-resume corner cases | The DIY `step_results` table suffices at current scale (~30–50 steps/run, bursty, solo). |
| Cloud Tasks (fan-out queue) | Synthesis fan-out must outlive one Job execution, OR cross-run rate-limiting against provider RPM/token caps | In-process `Promise.all` over one Job covers a ~10–15-node run. |
| Cloud Workflows / multi-task Job sharding | Cross-job orchestration, HIL pauses, or fan-out beyond one instance's RAM/CPU | Code-orchestration in one Job is the right fit; managed orchestrators add payload-limit + decomposition cost (see ADR §2). |
| Remove vestigial Redis from `docker-compose.yml` | A docker-compose / local-infra cleanup PR | Redis backed the dropped Trigger.dev; harmless but unused now. |
| ~~`@eleatic/eval` trace seam (`src/trace`)~~ — **WOKEN 2026-06-19** | ~~`@eleatic/eval` is published to npm (currently 404)~~ — fired: published `@0.1.0` | Built in this PR: the `TraceSink` observability port + `src/trace` (span/reduce/eleatic-adapter) + the `--trace` CLI flag, fenced so the package stays out of the app bundle. Was blocked on the sibling's npm publish. |
| `runPipeline` options-object refactor (collapse the 6 positional params) | `runPipeline` gains a 7th positional param, OR a caller mis-binds the positional args | The `TraceSink` (6th, after `stages`) was added positionally + defaulted so it's purely additive — zero blast radius on the 9 existing positional-arg tests. An options object is the cleaner shape once the arity grows again. |
| `src/app` → pipeline import boundary (the Service triggers the Job, doesn't run the pipeline) | The deployed Cloud Run Job model replaces in-process generation | The lean e2e runs the pipeline IN-PROCESS inside `src/app` (the Service) + reads the store from server components/route handlers, so a blanket `src/app`→pipeline/store ban would be wrong today. The fence ships with `core-no-frontend` only (ADR 0001 §4). |
| Full CI app-gates (run typecheck/test/build in CI) | The `core` workspace split lands, or flakiness slips past the bot review | PARTIAL: `.github/workflows/import-fence.yml` now does `npm ci` + `npm run lint:boundaries` in CI (the first code-level gate + the npm-ci-in-CI pattern). Extending it to typecheck/test/build is the remaining step; the `@julianken-bot` per-PR review (throwaway-clone gates) still covers those today. |

Deferral from the repo-description consistency mechanism:

| Item | Trigger that should wake it | Why deferred |
| --- | --- | --- |
| Nightly/scheduled GitHub-description drift gate (compare the live `gh` description to the `INSTANCE.md` canonical; open a `drift:docs` issue on mismatch) | The reviewer `--check` + orchestrator post-merge sync stops sufficing — i.e. the live description drifts **out-of-band** (edited directly on GitHub) more than once | Introduction-time drift is already covered: the reviewer runs `scripts/sync-repo-description.sh --check` on identity-touching PRs and the orchestrator syncs post-merge. A scheduled gate would catch only out-of-band edits, and the repo has **no nightly CI** to extend yet — not worth standing one up for a single string until out-of-band drift actually recurs. |
