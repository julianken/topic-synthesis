# ADR 0002 — Authentication, identity, and user-ownership

**Status:** Accepted (2026-06-19) · **Builds on:** ADR 0001 (preserves its §3 one-Postgres and §5 swappable-behind-a-port decisions; adds the first managed external dependency it did not anticipate).

## Context

The walking skeleton is deployed live on GCP Cloud Run (Service + pipeline Job + Cloud SQL), but **unauthenticated**: `POST /api/generate` mints a runId and dispatches a paid Cloud Run Job with zero identity check, and every stored curriculum/artifact is world-readable to anyone with the id. Before opening the Service beyond a private URL, the owner asked for auth with four properties: (1) **stay on GCP** and maximize Terraform; (2) **scale-to-zero / low cost**; (3) **own, branded UI** (no hosted login page); (4) auth **decoupled** from the rest of the app "as much as possible from the start" — and asked whether a *users service* and an *auth service* are separate concerns. Two adversarial design-panel passes (auth-architecture-design, then gcp-auth-users-decomposition) ground the decisions below; this ADR is the self-contained record.

## Decisions

### 1. Identity is BOUGHT, not built — GCP Identity Platform (managed)
Authentication (sign-in, token mint/verify, IdP federation, revocation) is a managed dependency: **GCP Identity Platform** — the GA `google_identity_platform_*` Terraform resources (the GCP face of the same `identitytoolkit.googleapis.com` backend as Firebase Auth; **not** the beta `google_firebase_*` provider layer). Server-side verification is the `firebase-admin` Node SDK (`verifySessionCookie`/`verifyIdToken`/`createSessionCookie`/`revokeRefreshTokens`), which checks signatures against in-memory-cached public certs — **zero network on the common path**, exactly right for a `min-instances=0` Service. ~50k MAU free, scale-to-zero. We own no credential storage and no password crypto.
- **Why managed:** self-hosting (better-auth on a custom Firestore adapter) scored worst on security in the panel — a hand-written transactional adapter is an auth-critical correctness surface (a token-consume path that can double-spend under optimistic concurrency), and it transfers an auth CVE stream onto a solo operator for benefits that are theoretical at free-tier scale.
- **Google IdP ONLY** (decision 5) — `email_verified` is trustworthy only because Google is the sole IdP. Adding a second IdP must be a visible Terraform diff, never silent.

### 2. User/ownership data stays in Postgres — `owner_sub` column, NOT a second store
Curriculum ownership is an `owner_sub TEXT` column on the existing `curriculum` table (the verified Google `sub`), written inside `persistRun`'s existing single transaction. **This preserves ADR 0001 §3** ("one Cloud SQL Postgres holds everything; Firestore would win only if the app store weren't already Postgres" — and it *is* Postgres).
- The owner's "separate scale-to-zero database" instinct was analyzed and deliberately **not** taken for the users data: **auth needs no application database at all** (Identity Platform owns the credential/session store), and the only domain data — a tiny ownership edge + an allowlist — is cheapest, transaction-safe, and consistency-simplest as a column on a DB we already pay for. A separate users store (Neon or Firestore) is **$0 net** but adds a second consistency domain (ownership writes can't share `persistRun`'s commit), a second IAM surface, and an api-key in TF state — cost without a benefit here.

### 3. Decomposition — split the CONCERNS into ports, not the deployables
A new **`AuthProvider` port** (pure types in `src/domain`, the `firebase-admin` adapter confined to one file in `src/app`) plus **owner-scoped queries in the existing store layer** — both **in-process, one deployable**. This mirrors ADR 0001 §5 (every component swappable behind a port: `Engine`, `TraceSink`, …): the IdP swaps by interface, not by network boundary.
- **Two deployables (an "auth service" + a "users service") are rejected** as microservice theater for a single front-end / team-of-one — *and* foreclosed by the `*.run.app` Public-Suffix-List cookie trap (a cookie set by a separate auth host is never sent to the app host without a custom domain or reverse proxy). The answer to "auth service AND users service?" is therefore: **managed identity + a thin in-app users module** — two ports, zero services.

### 4. Own, branded UI — headless client SDK
The login UI is first-party React styled from `DESIGN.md` §0 tokens, driven by the **headless** `firebase/auth` client SDK (`signInWithPopup(GoogleAuthProvider)`) — no FirebaseUI widget, no hosted/redirect login page. The Google consent screen is the one unavoidable external redirect (an OAuth requirement, not a hosted *login* page). The client ID token is exchanged at a route handler for an httpOnly session cookie.

### 5. Security spine (binding on implementation)
- **Spend gate:** `POST /api/generate` runs an *authoritative* `verifySessionCookie({ checkRevoked: true })` + `email_verified === true` + a **sub-keyed allowlist** check **before** any runId/dispatch/in-process spend. The allowlist is load-bearing: `email_verified` alone is open registration on a money endpoint (financial-DoS — any throwaway Google account passes). The gate sits **above** the dispatch-vs-in-process branch (both spend).
- **Artifact privacy gates on the OWNING CURRICULUM, not the pageId.** `pageId = contentIdentityKey` is a ~64-bit content hash *shared across curricula by design* (`curriculum_page` is many-to-one), so a per-pageId capability token is theater. The artifact is authorized through `assertOwns(sub, curriculumId)`, riding the httpOnly session cookie (the same-origin `/artifact` GET *can* read it; only the sandboxed iframe DOM is opaque-origin) — never a bearer token in the URL.
- **Uniform 404** (not 403) for absent-or-not-owned across hub/detail/status — including timing/error-indistinguishability — kills the existence oracle.
- **Two distinct verify methods** (`verifySessionCookie` vs `verifyIdToken`), no polymorphic entrypoint, closing the confused-deputy class.
- **Fail-closed** default-deny choke point; `AUTH_DEV_BYPASS` is hard-gated to non-production and not satisfiable from request input. Revocation via `revokeRefreshTokens` + `checkRevoked` on the gate and on private reads (or a documented short cookie TTL).

## Consequences

- **$0 net new always-on cost** — Identity Platform is free under 50k MAU; the existing Cloud SQL (~$8/mo) stays the sole always-on piece. No second datastore.
- **First managed external dependency:** login now depends on Identity Platform being reachable (it is GCP-internal; verification is cert-cached so it is not a per-request hop).
- **A new `google_project_service` IaC pattern** (the repo enables APIs out-of-band today) is introduced for `identitytoolkit.googleapis.com` — a deliberate, flagged convention change.
- **The import fence gains a third rule** (`firebase-only-in-auth-adapter`) confining the **Admin** SDK (`firebase-admin`) to its adapter — the client `firebase/auth` SDK is browser code and intentionally *not* confined (it is used by the sign-in UI).
- **One un-Terraformable manual seam:** the Google OAuth 2.0 web client + consent screen are a one-time console/`gcloud` step; the client secret then feeds Terraform via a Secret Manager container.

## Alternatives rejected

- **A separate auth service** — the `*.run.app` PSL cookie trap breaks cross-host sessions without a custom domain; a second deploy + a hot inter-service dependency buys no decoupling a port doesn't.
- **A separate users store (Neon serverless Postgres / Firestore)** — $0 but a second consistency domain + IAM/api-key surface; ADR 0001 §3's precondition (app store already Postgres) holds, so the column wins.
- **Self-hosted better-auth** — a custom Firestore adapter is an auth-critical correctness surface; the managed IdP carries that for free.
- **Auth.js / NextAuth v5** — still published under the `beta` dist-tag (security patches ship as betas), and its default stateless-JWT session has no real revocation.
- **The beta `google_firebase_*` Terraform layer** — would drag a `google-beta` provider + `user_project_override` for nothing the GA Identity Platform resources don't already provide.
