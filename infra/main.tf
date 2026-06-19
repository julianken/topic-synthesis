# ── Artifact Registry: the Docker repo for the app + pipeline-Job images ──────────────────
resource "google_artifact_registry_repository" "app" {
  location      = var.region
  repository_id = "topic-synthesis"
  description   = "topic-synthesis container images (Cloud Run Service + Job)"
  format        = "DOCKER"
}

# ── Runtime service account for the Cloud Run Service + Job (least-privilege) ──────────────
resource "google_service_account" "runtime" {
  account_id   = "ts-runtime"
  display_name = "topic-synthesis Cloud Run runtime"
}

resource "google_project_iam_member" "runtime_sql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

# ── Cloud SQL Postgres: the system-of-record (app rows + workflow step_results) ───────────
# The ONLY always-on cost (~$8/mo). Reached only via the Cloud SQL Auth Proxy — the Cloud Run
# connector authenticates with IAM; no authorized_networks, so the public IP is otherwise unusable.
resource "google_sql_database_instance" "main" {
  name                = "topic-synthesis"
  database_version    = "POSTGRES_16"
  region              = var.region
  deletion_protection = false # lean dev; set true before real prod data lands

  settings {
    tier              = var.db_tier
    edition           = "ENTERPRISE"
    availability_type = "ZONAL"
    disk_size         = 10
    disk_autoresize   = true

    ip_configuration {
      ipv4_enabled = true
    }
    backup_configuration {
      enabled = true
    }
  }
}

resource "google_sql_database" "app" {
  name     = "topic_synthesis"
  instance = google_sql_database_instance.main.name
}

resource "random_password" "db" {
  length  = 32
  special = false
}

resource "google_sql_user" "app" {
  name     = "topic"
  instance = google_sql_database_instance.main.name
  password = random_password.db.result
}

# ── Secret Manager: the DB password (Terraform-generated) + the provider API key ──────────
resource "google_secret_manager_secret" "db_password" {
  secret_id = "db-password"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "db_password" {
  secret      = google_secret_manager_secret.db_password.id
  secret_data = random_password.db.result
}

# Container only — the VALUE (a ROTATED key) is added out-of-band via gcloud, never in TF/git.
resource "google_secret_manager_secret" "anthropic_api_key" {
  secret_id = "anthropic-api-key"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_iam_member" "db_password_accessor" {
  secret_id = google_secret_manager_secret.db_password.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_secret_manager_secret_iam_member" "anthropic_accessor" {
  secret_id = google_secret_manager_secret.anthropic_api_key.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}
