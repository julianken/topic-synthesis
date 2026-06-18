# ADR 0001 — Deployment, orchestration, durable execution, and component swappability

**Status:** Accepted (2026-06-18) · **Supersedes:** the Engine/Orchestration/deploy decisions in `docs/plans/walking-skeleton.md` (Trigger.dev self-host).

## Context

The walking-skeleton pipeline (ANALYSIS→SYNTHESIS over an injected `Engine` seam) is built and validated locally. Before adding the app + a deployment target, the owner asked three things: (1) the business logic must not be coupled to the frontend; (2) deploy on **GCP** with **Terraform**, **serverless by default unless there's a reason not to**; (3) make every workflow component — including orchestration — **easily swappable for testing**. Four multi-agent analysis passes (decoupling audit, GCP serverless topology, AI-workflow-store research, managed-orchestrator head-to-head) ground the decisions below; this ADR is the self-contained record.

## Decisions

### 1. Deployment topology — GCP serverless, everything scale-to-zero except the DB
- **Frontend + request API** → one **Cloud Run Service** (Next.js standalone, `min-instances=0`). Route handlers are the API: kick off a run (returns `202 + runId`), poll status, serve artifacts.
- **The pipeline** → a **Cloud Run Job** running the **Next-free `core` image** (`pg`/`ai`/`zod`, no `next`/`react`). The Service *triggers* a Job execution; it never runs the multi-minute pipeline in-process.
- **Why a Job, not a Function/Service request:** the pipeline is multi-minute with fan-out; Cloud Run Services/Functions cap at a 60-min request and throttle CPU outside a request. A Job gets CPU for the whole task (timeout to 7 days) and scales to zero between runs.
- **Hard rule:** never enable always-on CPU / `min-instances>0` — that single setting converts idle-$0 into a 24/7 bill.
- **Secrets** → Secret Manager + a runtime service account (Workload Identity); IAM DB auth so there is no DB password.
- **IaC** → Terraform, GCS state backend (native locking), thin local modules (artifact-registry, cloud-sql, secret-manager, cloud-run service+job, iam/WIF), workspaces per env. **Deferred** — see Sequencing.

### 2. Orchestration — code-orchestration in the Job, NOT a managed workflow tool
The pipeline's control flow (fan-out with fan-in **barriers**: wait for all researchers before the graph; wait for all built pages before the hub) already exists as tested TypeScript in `run-pipeline.ts`. We keep it there.
- **Cloud Workflows — rejected (deferred):** 512 KB total-variable cap per execution → our multi-page fan-in (several ~50 KB HTML pages) blows it → forces payload-by-handle indirection the in-process Job avoids; it does **not** do cross-run step memoization (so we'd keep `step_results` anyway); and it forces every stage into its own HTTP-callable service while our gate/hub logic can't live in 400-char YAML expressions.
- **Cloud Composer (Airflow)** — avoid (~$400/mo always-on, scheduled-ETL shaped). **Vertex AI Pipelines** — avoid (ML-training DAGs, ~2-min per-step cold starts). **Application Integration** — avoid (iPaaS). **Eventarc + Pub/Sub** — defer (event choreography makes the joins harder).
- **Cloud Tasks — reserved (`use-for-part`):** adopt later *only if* synthesis fan-out must outlive a single Job execution, or for cross-run rate-limiting against provider RPM/token caps.
- **Flips toward a managed orchestrator** when: cross-run/cross-job coordination, human-in-the-loop pauses (hours/days mid-run), fan-out beyond one instance's RAM, or team > 1 (a visible execution graph earns its keep). None true today.

### 3. Durable execution + workflow store — one Postgres, `GcpEngine` behind the seam (drop Trigger.dev)
- **One Cloud SQL Postgres** holds *both* app records (curricula, pages, runs) **and** workflow execution state (`step_results`). Not a separate store: the DB is already always-on (~$8/mo sunk), so workflow state adds ~$0; and the memoization commit can share a transaction with the app-record write → exactly-once semantics for *paid* LLM steps. (Firestore would win only if the app store weren't already Postgres; Redis/Mongo/Temporal/Restate all add standing cost or a second store for capability Postgres already covers.)
- **`GcpEngine`** implements the existing `Engine.step(name, key, fn)` seam against a `step_results(run_id, step, key) → jsonb` table (`INSERT … ON CONFLICT DO NOTHING`). A Job retry reads completed steps back and skips them — durable resume with **no always-on component**. Because `key` is already a content hash, the same table also gives cross-curriculum page reuse.
- **DBOS Transact** (durable execution as a *library on Postgres*, no server) is the **in-model upgrade path** behind the same seam, adopted only when a concrete need fires (queue fan-out, human-in-the-loop, crash-resume fragility). DBOS keys steps positionally, so it would sit *on top of* the content-hash table, not replace it.
- **Self-hosted Trigger.dev is dropped** — it is always-on (webapp + worker + Redis, ~$15–40/mo standing), which fights scale-to-zero, and its one advantage (durable memoization) we already own via the seam. **Consequence:** Redis in `docker-compose.yml` is now vestigial (it backed Trigger.dev) — remove in a cleanup or keep reserved.
- **Observability stays separate:** traces go to the eleatic eval seam (SQLite, local) now / an OTel sink later — never folded into `step_results`.

### 4. Decoupling — import fence now, Next-free `core` workspace split at the deploy PR
The decoupling audit verified the core is **import-clean** (zero `next`/`react` imports across every core file; relative paths, no `@/` alias; the eval CLI already runs the pipeline outside Next). The coupling is **packaging-only**, so extraction is a cheap file-move + manifest split, not a rewrite.
- **Now:** a CI **import fence** (fail the build if anything under `src/{domain,llm,pipeline,engine,store,eval}` imports `next`/`react`/`react-dom`/`server-only`) + name the ports. Starts green; makes the zero-coupling impossible to regress when the API route lands.
- **Deferred trigger:** extract `core` into its own Next-free workspace package **in the first PR of the cloud-deploy phase** — the same PR that adds the Job's Dockerfile (the first moment a second deployable/manifest exists). Earlier is premature; later forces the Job image to drag in `next`/`react`.

### 5. Component swappability (the testing + eval-arm seam)
**Every workflow component is a pluggable adapter behind a named port with a real default.** "Swap a component for testing" and "run an A/B eval arm" are the *same* capability — a `workflow_version` is a frozen choice across these seams (`{stages, models, engine}`).

| Component | Port | Swap for testing / eval |
| --- | --- | --- |
| Orchestration | `Engine.step` | `InlineEngine` (local/tests) ↔ `GcpEngine` (Postgres) ↔ a fault-injecting engine to test crash-resume |
| Stages | an injectable stage set | swap `graph` for a fixture or a v2 algorithm without touching the rest |
| LLM client + web search | `StageDeps` | real ↔ fakes ↔ recorded cassettes ↔ a cheap model |
| Per-stage model | `StageModel` overrides | the A/B arm (already shipped) |
| Store | `StoreDeps` | Postgres ↔ in-memory for tests |

All seams exist today **except** the injectable stage set — `run-pipeline` currently imports the stages directly. Closing that gap (pass a stage bundle, real defaults) is the one code change this principle requires, delivered in the structural PR.

## Sequencing
1. **Finish the local e2e** on `InlineEngine` + local Postgres first — it must produce a curriculum locally before any cloud resource is provisioned.
2. **Structural insurance now** (no cloud): the import fence, named ports, the injectable stage set. The `GcpEngine`/`step_results` adapter is local-testable too (it's just Postgres memoization).
3. **At cloud-deploy** (only after the local e2e is green): the `core` workspace split + Job Dockerfile, then all Terraform + the Jobs-API trigger wiring.
4. **Defer until a trigger fires:** DBOS, Cloud Tasks, Cloud Workflows, multi-task Job sharding.
- **The line:** write **zero Terraform** until the pipeline produces a curriculum locally.

## Cost
Idle ≈ **$8/mo** (Cloud SQL `db-f1-micro`, the only non-scale-to-zero piece; the chosen all-GCP option). Per-run is **dominated by LLM tokens** (~$0.21/cheap run); GCP compute is rounding error (free tier absorbs dozens of runs). Owner chose Cloud SQL over Neon (idle-$0 but a second non-GCP vendor) for trust-boundary/IAM uniformity.

## Consequences
- `docs/plans/walking-skeleton.md` Engine/Orchestration/deploy sections are superseded by this ADR (banner added there).
- Trigger.dev (`trigger-engine.ts`, `src/trigger/`, `trigger.config.ts`, Realtime progress) is removed from the roadmap; the Cloud Run Job + `GcpEngine` replaces it. Progress is the app polling "does curriculum `<runId>` exist yet" (atomic `persistRun`).
- Redis is vestigial (see Decision 3).
- The deferred items are tracked in `GAPS.md`.
