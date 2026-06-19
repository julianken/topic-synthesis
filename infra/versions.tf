# Terraform + provider pins and the GCS remote-state backend (bucket bootstrapped out-of-band:
# `gcloud storage buckets create gs://topic-synthesis-prod-tfstate` + versioning). Per ADR 0001 §1.
terraform {
  required_version = ">= 1.6"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
  backend "gcs" {
    bucket = "topic-synthesis-prod-tfstate"
    prefix = "infra"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
