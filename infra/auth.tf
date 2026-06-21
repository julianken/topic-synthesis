# GCP Identity Platform (managed authentication) + the auth IAM, per ADR 0002.
# NO Firestore: user/curriculum ownership is an `owner_sub` column on the existing Cloud SQL Postgres
# (issue #36), preserving ADR 0001 §3 (one Postgres). This file adds ONLY the identity provider, its
# Google IdP, and the runtime SA's auth permission.

# Identity Platform needs the Identity Toolkit API. The repo enables APIs out-of-band today (the GCS
# state bucket, the anthropic-key value), so this introduces `google_project_service` as a NEW IaC
# pattern — flagged in the PR for a conscious accept.
resource "google_project_service" "identitytoolkit" {
  service            = "identitytoolkit.googleapis.com"
  disable_on_destroy = false
}

# The Google OAuth 2.0 web client is created out-of-band (the client + consent screen have no
# `google_*` resource — the one un-Terraformable seam). `client_id` is public; `client_secret` is
# APPLY-TIME ONLY — Identity Platform uses it to complete the Google OAuth handshake; the app never
# reads it at runtime — so it is a sensitive var, NOT a Secret Manager runtime secret. (It lands in
# TF state as the IdP-config attribute regardless; a Secret Manager copy would only duplicate it.)
variable "oauth_client_id" {
  type        = string
  description = "Google OAuth 2.0 web client ID (created out-of-band; set at apply)."
}

variable "oauth_client_secret" {
  type        = string
  sensitive   = true
  description = "Google OAuth 2.0 web client secret (out-of-band; set at apply via TF_VAR_oauth_client_secret, never committed)."
}

# The runtime SA verifies / mints / revokes Identity Platform sessions (the firebase-admin Admin SDK
# on Cloud Run). Extends the existing ts-runtime identity (main.tf:10) — no second SA.
resource "google_project_iam_member" "runtime_firebaseauth_admin" {
  project = var.project_id
  role    = "roles/firebaseauth.admin"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

# Identity Platform config — GOOGLE-ONLY BY CONSTRUCTION: every built-in sign-in method is disabled,
# so the sole way in is the Google OAuth IdP below; that is the basis for trusting `email_verified`
# (ADR 0002 §1/§5). `authorized_domains` is the OAuth-redirect allowlist (the tight per-request host
# pin is enforced app-side in #37's session route via an Origin/Sec-Fetch-Site check).
resource "google_identity_platform_config" "default" {
  project                    = var.project_id
  autodelete_anonymous_users = true

  authorized_domains = [
    "localhost",                                                                    # local dev (real-OAuth path; the bypass needs no domain)
    "${var.project_id}.firebaseapp.com",                                            # the default OAuth redirect/auth domain
    replace(replace(google_cloud_run_v2_service.app.uri, "https://", ""), "/", ""), # the prod host
  ]

  sign_in {
    allow_duplicate_emails = false
    anonymous {
      enabled = false # no anonymous accounts
    }
    email {
      enabled = false # no email/password — Google holds the credential
    }
    phone_number {
      enabled = false # no SMS
    }
  }

  depends_on = [google_project_service.identitytoolkit]
}

# THE supported IdP: Google. Exactly ONE of these must exist — a second IdP would be a visible plan
# diff and would erode the `email_verified` trust basis (ADR 0002 §1/§5).
resource "google_identity_platform_default_supported_idp_config" "google" {
  project       = var.project_id
  enabled       = true
  idp_id        = "google.com"
  client_id     = var.oauth_client_id
  client_secret = var.oauth_client_secret

  depends_on = [google_identity_platform_config.default]
}
