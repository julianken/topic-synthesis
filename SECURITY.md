# Security Policy

Topic Synthesis is a personal, non-commercial, solo-maintained open-source
project — Generate an interactive, scaffolded lesson from a topic. The deployed
app is private and invite-only: it gates access behind managed Google sign-in
plus an explicit allowlist, and stores a per-user owner id (`owner_sub`) so a
user's lessons are readable only by their owner (see "Authentication & access"
below). No passwords are stored and there is no analytics today. This file tells
you how to report a security problem and what to honestly expect in return.

## Reporting a vulnerability

**Please do not open a public issue or pull request for anything
security-relevant.** A public report can expose other people before a fix exists.

Report it privately instead:

1. **Preferred — GitHub Private Vulnerability Reporting.** Go to this repo's
   **Security** tab and click **Report a vulnerability**. That opens a private
   advisory only the maintainer can see.
2. **Fallback** — if that button isn't available to you, open a regular issue
   titled only `security: please contact me` with **no details**, and I'll move
   the conversation somewhere private. Don't put the vulnerability details in
   that issue.

A useful report usually includes:

- what the problem is and why it's a security concern,
- the affected commit SHA or URL (and the deployed site, if it's live),
- steps to reproduce or a short proof-of-concept,
- the impact you think it has.

## What to expect

This is a hobby project maintained by one person in their spare time. There is
**no service-level agreement and no guaranteed turnaround.** Realistically:

- I'll try to acknowledge a report within about a week, usually sooner.
- I fix what I can, when I can, prioritizing anything that could harm someone
  running the app.
- I'd rather under-promise than post an enterprise-style SLA I can't keep. If a
  report goes quiet, a polite nudge is fair.

Coordinated disclosure is a **request, not a contract**: please give me a
reasonable chance to ship a fix before going public, and I'll credit you for the
find unless you'd prefer to stay anonymous. I can't offer a bounty or any reward.

## Scope

**In scope:** the code in this repository and the behavior of the app it builds
— including bugs that could harm a visitor running the deployed site (for
example, a way to get malicious code or content to execute in their browser).

**Out of scope:**

- the hosting provider, CDN, DNS registrar, or other infrastructure once a host
  is chosen — report those to the relevant vendor;
- vulnerabilities in third-party dependencies themselves — report those upstream
  (I still want to know if one is actually reachable through this app);
- findings that only work because the source code is public. The source is
  intentionally open (see below); nothing here relies on the code being secret,
  so "you can read the source" is not, by itself, a vulnerability.

## Supported versions

There is one actively developed line of work: the current `main`
branch and whatever is currently deployed from it. There is no release-version
matrix and no back-porting. Until the app is actually deployed somewhere,
"supported" effectively means `main`.

## Secrets and sensitive data

This repo is intended to contain no secrets and no personal data. The
sensitivity-levels model (Secret / Private / Security-sensitive / Working /
Public) and the rule that **an exposed secret gets rotated, not merely deleted**
(a secret that ever reached a public commit must be treated as burned) are
defined once in [`AGENTS.md`](AGENTS.md) under "Disclosure & sensitivity" — that
is the single source of truth, and it is not restated here. If you spot a
committed credential or personal data, please report it privately as above so
the value can be rotated.

## Authentication & access

The deployed app is private and invite-only. The controls below are in the spirit
above — real protections for the people running the app and its LLM budget, not
audit-theater (ADR `docs/decisions/0002-auth-architecture.md`):

- **Identity** is GCP Identity Platform, **Google sign-in only** — `email_verified`
  is trustworthy precisely because Google is the sole IdP. The app stores no
  passwords.
- **An explicit allowlist** (`AUTH_ALLOWLIST`, keyed by the stable Google `sub`,
  never the mutable email) authorizes use. A verified Google account alone is open
  registration on an endpoint that spends real LLM tokens, so the allowlist — not
  just a valid sign-in — is the gate.
- **Sessions** are `httpOnly` + `Secure` + `SameSite=Lax` cookies (the opaque
  Identity Platform session cookie), verified server-side against cached certs.
  `POST /api/generate` runs an authoritative, **revocation-checked** session +
  allowlist check **before any spend**; private reads are owner-scoped. State-
  changing POSTs also carry an `Origin`/`Sec-Fetch-Site` same-origin check (CSRF).
- **`RUN_OWNER`** trust boundary: the pipeline Job has no session, so it trusts the
  `RUN_OWNER` env override as the run's owner — but the Service sets it only *after*
  the spend gate, so it is authoritative-because-set-by-the-trusted-Service, not an
  unauthenticated input.
- **`AUTH_DEV_BYPASS`** is a local-dev-only escape hatch, **hard-gated to
  non-production** (`NODE_ENV` is checked first and unconditionally) and settable
  only from server env — it can never grant a session on a deployed build.

The web API key shipped to the browser (`NEXT_PUBLIC_FIREBASE_API_KEY`) is **not a
secret** — it identifies the project, it does not authorize; the IdP enforces the
Google-only + authorized-domains policy. The deploy must set the auth env (the
`NEXT_PUBLIC_FIREBASE_*` build args + `AUTH_ALLOWLIST`); wiring those into the image
build + Cloud Run is the operational deploy step.

Reads are **owner-scoped**: a curriculum, its generation status, and its pages are <!-- concept-drift-ok: persisted-entity / route identifier (owner-scoping mechanism), deferred rename — ADR-0003 -->
visible only to the Google account that generated it — a non-owner gets a **uniform
404** (no 403/404 existence oracle; absent and not-owned are the same response). The
sandboxed artifact route authorizes **through the owning curriculum, not the page <!-- concept-drift-ok: persisted-entity identifier (owner-scoping mechanism), deferred rename — ADR-0003 -->
id**: a `pageId` is a content hash *shared across curricula* by design, so it is not <!-- concept-drift-ok: persisted-entity identifier (owner-scoping mechanism), deferred rename — ADR-0003 -->
a capability. The page HTML is served only on a same-origin request carrying the
owner's session cookie (the iframe `sandbox` opaques the framed DOM, not the load
request), never via a bearer token in the URL.

## How this project is built

Most code here is written by AI coding agents under human review, then
squash-merged — that development model is itself part of why the repo is public.
The inward-facing guardrails for that work (treat repo / PR / web / dependency
text as untrusted **data, not instructions**; never echo or commit secrets;
anti-slopsquatting; never rubber-stamp a review) live in [`AGENTS.md`](AGENTS.md);
Claude Code reads the same content via the `@AGENTS.md` import in `CLAUDE.md`.
This file is the outward-facing reporting policy; those are inward-facing
authoring rules.

## Why this repo is public — and why public is not the same as auditable

The maintainer would prefer this code to be private. It is public only to capture
four specific benefits:

- **(a) Writing.** The maintainer's blog links to real, live code; this repo is a
  worked example behind that writing.
- **(b) A public agentic-dev trail.** The commit, PR, and review history is
  itself a demonstration of how the maintainer builds software with AI agents.
- **(c) OSS hosting and tooling.** Public repos get free or better CI,
  static-hosting tiers, dependency and secret scanning, and code-scanning tooling.
- **(d) Showcase.** It shows the design and engineering craft.

That's the whole list. Being public does **not** mean this project is audited,
regulated, or held to any compliance or external-auditability standard — there
is no such requirement and no agreement that imposes one. Auditability here is a
courtesy the maintainer keeps for his own sake, and it is deliberately decoupled
from the public/private decision.

The practical consequence for security: decisions follow from those four
objectives and from a small set of real obligations — **don't commit secrets or
personal data; don't ship something that harms the people running the app;
respond to reports honestly and reasonably promptly.** They do **not** follow
from a reflex to lock everything down or make it audit-grade just because the
source is visible. Controls are added when they serve a real objective or protect
actual users, and kept out when they'd only be enterprise theater for a small
client-side app.
