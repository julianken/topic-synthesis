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
