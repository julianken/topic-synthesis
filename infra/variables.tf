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
