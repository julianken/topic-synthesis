# Cloud Run v2 — the Next app SERVICE (scale-to-zero), the pipeline JOB, and a one-shot MIGRATE job.
# Reuses the ts-runtime SA (cloudsql.client + secretAccessor on both secrets); the only new IAM is
# run.invoker on the pipeline Job so the Service can dispatch it. Per ADR 0001 §1-2.

locals {
  conn = google_sql_database_instance.main.connection_name
  # Unix-socket DATABASE_URL: the Cloud Run Cloud SQL connector mounts the socket under /cloudsql;
  # node-postgres treats a directory `host` as a socket. The password rides separately as PGPASSWORD.
  database_url = "postgresql://${google_sql_user.app.name}@/${google_sql_database.app.name}?host=/cloudsql/${local.conn}"

  # Secret env shared by the app + pipeline containers (DB password + provider key).
  secret_env = {
    PGPASSWORD        = google_secret_manager_secret.db_password.secret_id
    ANTHROPIC_API_KEY = google_secret_manager_secret.anthropic_api_key.secret_id
  }
}

resource "google_cloud_run_v2_service" "app" {
  # Fail-LOUD guard (2026-06-30 incident): a deploy-time `terraform apply` that does not carry the live
  # allowlist would set AUTH_ALLOWLIST="" from the var's empty default and lock out EVERY user (the
  # fail-closed spend gate, ADR 0002 §5). Refuse the apply instead of silently wiping it. Every Service
  # apply must pass -var "auth_allowlist=<owner sub[,...]>" carrying the CURRENT live value (sourced in
  # docs/deploy-runbook.md §Terraform reconciliation). A deliberate no-users bootstrap sets it explicitly.
  lifecycle {
    precondition {
      condition     = trimspace(var.auth_allowlist) != ""
      error_message = "auth_allowlist is empty — applying would set AUTH_ALLOWLIST=\"\" and lock out ALL users (fail-closed spend gate, ADR 0002 §5). Pass -var \"auth_allowlist=<owner sub[,...]>\" carrying the live value; see docs/deploy-runbook.md."
    }
  }

  name                = "topic-synthesis-app"
  location            = var.region
  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_ALL"

  template {
    service_account                  = google_service_account.runtime.email
    max_instance_request_concurrency = 80
    scaling {
      min_instance_count = 0 # ADR 0001: scale-to-zero — Cloud SQL is the only always-on cost
      max_instance_count = 2
    }
    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [local.conn]
      }
    }
    containers {
      image = var.app_image
      ports {
        container_port = 8080
      }
      resources {
        limits = { cpu = "1", memory = "512Mi" }
      }
      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }
      env {
        name  = "DATABASE_URL"
        value = local.database_url
      }
      env {
        name  = "PIPELINE_JOB_NAME"
        value = "topic-synthesis-pipeline"
      }
      env {
        name  = "PIPELINE_REGION"
        value = var.region
      }
      env {
        name  = "GCP_PROJECT"
        value = var.project_id
      }
      env {
        # The spend gate + private reads check this allowlist of Google `sub`s (ADR 0002 §5). Not a
        # secret (opaque ids); empty = no one allowed (fail-closed) until set to the owner's sub.
        name  = "AUTH_ALLOWLIST"
        value = var.auth_allowlist
      }
      dynamic "env" {
        for_each = local.secret_env
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }
    }
  }
}

resource "google_cloud_run_v2_job" "pipeline" {
  name                = "topic-synthesis-pipeline"
  location            = var.region
  deletion_protection = false

  template {
    template {
      service_account = google_service_account.runtime.email
      timeout         = "3600s"
      max_retries     = 1 # a retry resumes on the same RUN_ID; GcpEngine skips completed step_result rows
      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [local.conn]
        }
      }
      containers {
        image = var.job_image
        resources {
          limits = { cpu = "2", memory = "2Gi" }
        }
        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
        env {
          name  = "DATABASE_URL"
          value = local.database_url
        }
        dynamic "env" {
          for_each = local.secret_env
          content {
            name = env.key
            value_source {
              secret_key_ref {
                secret  = env.value
                version = "latest"
              }
            }
          }
        }
      }
    }
  }
}

# One-shot migration: the SAME job image, command-overridden to apply the idempotent schema. Execute
# once after apply (`gcloud run jobs execute topic-synthesis-migrate --region us-central1`); re-runnable.
resource "google_cloud_run_v2_job" "migrate" {
  name                = "topic-synthesis-migrate"
  location            = var.region
  deletion_protection = false

  template {
    template {
      service_account = google_service_account.runtime.email
      timeout         = "600s"
      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [local.conn]
        }
      }
      containers {
        image   = var.job_image
        command = ["node_modules/.bin/tsx"]
        args    = ["src/store/migrate.ts"]
        resources {
          limits = { cpu = "1", memory = "512Mi" }
        }
        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
        env {
          name  = "DATABASE_URL"
          value = local.database_url
        }
        env {
          name = "PGPASSWORD"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.db_password.secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }
}

# The Service dispatches the pipeline Job WITH per-run env overrides. roles/run.invoker grants
# run.jobs.run but NOT run.jobs.runWithOverrides (the override call), so a least-privilege custom
# role carries exactly the two run-job permissions — narrower than the broad roles/run.developer.
resource "google_project_iam_custom_role" "job_runner" {
  role_id     = "tsJobRunner"
  title       = "topic-synthesis Job runner"
  description = "Run a Cloud Run Job, including with per-execution overrides (the /api/generate dispatch)."
  permissions = ["run.jobs.run", "run.jobs.runWithOverrides"]
}

# Bind it per-job (not project-wide) for the runtime SA — explicit even though Service + Job share it.
resource "google_cloud_run_v2_job_iam_member" "pipeline_invoker" {
  name     = google_cloud_run_v2_job.pipeline.name
  location = var.region
  role     = google_project_iam_custom_role.job_runner.id
  member   = "serviceAccount:${google_service_account.runtime.email}"
}
