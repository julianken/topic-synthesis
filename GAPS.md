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
| Next-free `core` workspace package (extract domain/llm/pipeline/engine/store) | The first cloud-deploy PR — the one adding the pipeline Job's Dockerfile (first moment a second deployable manifest exists) | Coupling is packaging-only + extraction is a cheap file-move (audit: 0 framework imports, no `@/` alias); premature before a second consumer exists. The import fence (shipped) keeps it cheap. |
| Terraform / GCP deploy (Cloud Run Service+Job, Cloud SQL, Secret Manager, WIF, GCS state) | The local e2e produces a curriculum end-to-end | The line: provision no cloud resource until the pipeline runs locally. |
| `GcpEngine` (Postgres `step_results` adapter behind the `Engine` seam) | Cloud-deploy phase (the pipeline runs as a Cloud Run Job) | `InlineEngine` suffices locally; durable cross-process resume only matters in the Job. The seam makes it a drop-in. |
| DBOS Transact (durable-execution library upgrade behind the same seam) | Durable-execution fragility: queue fan-out beyond `Promise.all`, human-in-the-loop waits, or crash-resume corner cases | The DIY `step_results` table suffices at current scale (~30–50 steps/run, bursty, solo). |
| Cloud Tasks (fan-out queue) | Synthesis fan-out must outlive one Job execution, OR cross-run rate-limiting against provider RPM/token caps | In-process `Promise.all` over one Job covers a ~10–15-node run. |
| Cloud Workflows / multi-task Job sharding | Cross-job orchestration, HIL pauses, or fan-out beyond one instance's RAM/CPU | Code-orchestration in one Job is the right fit; managed orchestrators add payload-limit + decomposition cost (see ADR §2). |
| Remove vestigial Redis from `docker-compose.yml` | A docker-compose / local-infra cleanup PR | Redis backed the dropped Trigger.dev; harmless but unused now. |
| `@eleatic/eval` trace seam (`src/trace`) | `@eleatic/eval` is published to npm (currently 404) | Blocked on the sibling package's publish. |
| Full CI app-gates (run typecheck/test/build in CI) | The `core` workspace split lands, or flakiness slips past the bot review | PARTIAL: `.github/workflows/import-fence.yml` now does `npm ci` + `npm run lint:boundaries` in CI (the first code-level gate + the npm-ci-in-CI pattern). Extending it to typecheck/test/build is the remaining step; the `@julianken-bot` per-PR review (throwaway-clone gates) still covers those today. |
