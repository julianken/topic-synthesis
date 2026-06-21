# Plan — Authentication & user-ownership subsystem

Program/tracking doc for the auth epic. The **architecture decision** is [`docs/decisions/0002-auth-architecture.md`](../decisions/0002-auth-architecture.md); the **per-PR specs** are GitHub issues #35–#38 (this doc is the program view + dependency graph, not a second copy of those specs).

## Goal

The deployed app stops being world-open: a user signs in through our own branded UI; `POST /api/generate` rejects any non-allowlisted session **before** spending LLM tokens; and curricula/artifacts are readable only by their owner. Managed identity (GCP Identity Platform) + an `owner_sub` column on the existing Postgres + an `AuthProvider` port — in-process, one deployable, $0 net new always-on. See ADR-0002 for *why* this shape.

## Issue dependency graph

```
#35 infra (Identity Platform TF, no Firestore)
   └─▶ #36 AuthProvider port + firebase-admin adapter + fence rule + owner_sub migration
          └─▶ #37 branded sign-in UI + session-cookie route + spend gate (the must-land control)
                 └─▶ #38 owner-scoped private reads (uniform 404) + artifact-via-owning-curriculum
```

| PR | Issue | Scope | Lands |
| --- | --- | --- | --- |
| 1 | [#35](https://github.com/julianken/topic-synthesis/issues/35) | `infra/auth.tf`: Identity Platform config (Google-only, host-pinned) + `identitytoolkit` API + OAuth-secret container + `ts-runtime` `firebaseauth.admin` + outputs | the IdP, as IaC |
| 2 | [#36](https://github.com/julianken/topic-synthesis/issues/36) | `AuthProvider` port (pure) + `firebase-admin` adapter + `firebase-only-in-auth-adapter` fence rule + additive `owner_sub` migration + `persistRun(ownerSub)` | the decoupling seam |
| 3 | [#37](https://github.com/julianken/topic-synthesis/issues/37) | headless branded sign-in + `/api/auth/session` cookie route + the spend gate on `/api/generate` + ownership write | login + the no-spend gate |
| 4 | [#38](https://github.com/julianken/topic-synthesis/issues/38) | owner-scoped hub/detail/status (uniform 404) + the artifact-via-owning-curriculum rewrite | confidentiality |

PR3 is the highest-value control (it stops unauthenticated LLM spend) and is shippable on its own; PR4 is the confidentiality half. For a single owner, PR3 alone is defensible if multi-user never arrives.

## Plan-review refinements (julianken-bot, applied during implementation)

The plan review (all four APPROVE) surfaced precision fixes — pin them in the PR they belong to:

- **#35:** `google_identity_platform_config` has **no per-IdP `sign_in` field** — enforce Google-only as a positive, greppable invariant (exactly one `google_identity_platform_default_supported_idp_config`, `idp_id="google.com"`), so a second IdP is a visible plan diff; disable anonymous/phone sign-in explicitly.
- **#36:** the fence rule's `to:` confines **`firebase-admin` only** (drop the `firebase` client SDK + `@google-cloud/firestore` — there is no Firestore, and the client SDK is browser code #37 legitimately imports). Add an AC that `lint:boundaries` stays **green** with `firebase/auth` present in the UI. `defaultProvider()` must be **lazy** (no Admin SDK `initializeApp()` at module load — mirror `repo.ts` deferring `getPool()`), so unit tests/builds need no live GCP creds.
- **#37:** the gate sits **above** the dispatch-vs-in-process branch (both paths spend). `AUTH_DEV_BYPASS` must be fail-closed and not satisfiable from request input (gate on `NODE_ENV`, not a header). Record in `SECURITY.md` that `run-job` treats the `RUN_OWNER` env override as authoritative-because-set-by-the-trusted-Service (the Job has no session to re-verify).
- **#38:** the artifact rewrite changes a URL contract that `repo.ts` `rebuildHub` hardcodes (`page.href`) — pin that producer seam as an AC so the rewrite isn't half-done. Uniform-404 must be **timing- and error-indistinguishable** (no extra round-trip / no thrown-vs-null branch between absent and not-owned). The status poller authorizes a runId pre-persist by it being **session-minted** (returned to *this* session by `/api/generate`), not a DB owner lookup (the run isn't persisted yet).

## Manual prerequisite (one-time, not IaC-able)

Before PR1's `terraform apply`: create a Google OAuth 2.0 **web client** + configure the consent screen (console / `gcloud`), then add the client secret to the Secret Manager container `google-oauth-client-secret`. This is the one seam Identity Platform's Terraform resources can't express. The orchestrator runs the `gcloud` step at delivery.

## Sequencing & delivery

Build 35→36→37→38, each in a worktree, each bot-reviewed per HEAD, squash-merged via Mergify. #36 is buildable/testable against the in-memory fake without #35's live IdP. The live `terraform apply` + the OAuth-client creation are **operational steps at delivery** (like the original deploy), gated on owner go-ahead. Each PR reconciles its own drift-prone docs per the AGENTS.md Update-Triggers table (DESIGN.md for the auth UI, SECURITY.md for the session/CSRF posture, INSTANCE.md for new secrets/env, GAPS.md for the woken deferrals).
