output "sql_instance_connection_name" {
  description = "INSTANCE_CONNECTION_NAME for the Cloud Run --add-cloudsql-instances connector."
  value       = google_sql_database_instance.main.connection_name
}

output "registry_repo" {
  description = "The Artifact Registry Docker repo to push images to."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.app.repository_id}"
}

output "runtime_sa_email" {
  description = "The Cloud Run runtime service account."
  value       = google_service_account.runtime.email
}

output "db_name" {
  value = google_sql_database.app.name
}

output "db_user" {
  value = google_sql_user.app.name
}

output "app_service_url" {
  description = "The Cloud Run Service URL (the deployed app)."
  value       = google_cloud_run_v2_service.app.uri
}

output "pipeline_job_name" {
  value = google_cloud_run_v2_job.pipeline.name
}

output "migrate_job_name" {
  value = google_cloud_run_v2_job.migrate.name
}

output "auth_web_api_key" {
  description = "Identity Platform web API key for the firebase/auth client SDK (public — browser-shipped by design)."
  value       = google_identity_platform_config.default.client[0].api_key
  sensitive   = true
}

output "auth_domain" {
  description = "The Firebase auth domain for the client SDK config (authDomain)."
  value       = "${var.project_id}.firebaseapp.com"
}
