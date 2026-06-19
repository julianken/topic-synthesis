variable "project_id" {
  type        = string
  description = "The dedicated GCP project for topic-synthesis."
  default     = "topic-synthesis-prod"
}

variable "region" {
  type        = string
  description = "Region for Cloud Run + Cloud SQL (co-located)."
  default     = "us-central1"
}

variable "db_tier" {
  type        = string
  description = "Cloud SQL machine tier. db-f1-micro is the cheapest shared-core (~$8/mo), the only always-on cost."
  default     = "db-f1-micro"
}

variable "app_image" {
  type        = string
  description = "Fully-qualified app image ref (build + push to Artifact Registry before apply)."
  default     = "us-central1-docker.pkg.dev/topic-synthesis-prod/topic-synthesis/app:latest"
}

variable "job_image" {
  type        = string
  description = "Fully-qualified job image ref (used by the pipeline + migrate Jobs; push before apply)."
  default     = "us-central1-docker.pkg.dev/topic-synthesis-prod/topic-synthesis/job:latest"
}
