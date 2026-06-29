# Workflow-runs observability (issue #167) — log-based metrics + a Cloud Monitoring dashboard over
# the pipeline Job's structured telemetry. The Job emits one JSON line per WorkflowEvent to Cloud
# Logging (issue #166); these metrics EXTRACT fields from those entries and the dashboard charts them.
#
# Field names are the pinned #166 envelope (do not drift): step.finish → ms,stage,status;
# llm.call → costUsd,stage,model; run.complete → costUsd,totalMs,outcome,criticPassed;
# run.failed → outcome. Labels are LOW-CARDINALITY ONLY (stage/status/model/outcome/criticPassed) —
# never topic/runId. Additive-only; log-based metrics do NOT backfill (they count entries created
# after apply), so this is deployed AFTER #166 ships and the dashboard fills from the next run.

locals {
  # Scope every metric to the pipeline Job's log stream (the only WorkflowEvent emitter).
  ts_job_log_filter = "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"${google_cloud_run_v2_job.pipeline.name}\""
  ts_metric_prefix  = "logging.googleapis.com/user"
}

# ── Per-phase metrics (step.finish + llm.call) ────────────────────────────────────────────────

# Phase wall-clock — the headline "why is the code phase slow" signal.
resource "google_logging_metric" "stage_latency_ms" {
  name   = "topic_synthesis/stage_latency_ms"
  filter = "${local.ts_job_log_filter} AND jsonPayload.eventType=\"step.finish\""
  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "DISTRIBUTION"
    unit         = "ms"
    display_name = "Pipeline phase latency (ms)"
    labels {
      key        = "stage"
      value_type = "STRING"
    }
    labels {
      key        = "status"
      value_type = "STRING"
    }
  }
  value_extractor = "EXTRACT(jsonPayload.ms)"
  label_extractors = {
    "stage"  = "EXTRACT(jsonPayload.stage)"
    "status" = "EXTRACT(jsonPayload.status)"
  }
  bucket_options {
    exponential_buckets {
      num_finite_buckets = 20
      growth_factor      = 2
      scale              = 50
    }
  }
}

# Phase cost (USD) by stage + model.
resource "google_logging_metric" "stage_cost_usd" {
  name   = "topic_synthesis/stage_cost_usd"
  filter = "${local.ts_job_log_filter} AND jsonPayload.eventType=\"llm.call\""
  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "DISTRIBUTION"
    unit         = "1" # USD; UCUM has no currency unit, so the conventional "1" + display name.
    display_name = "Pipeline phase LLM cost (USD)"
    labels {
      key        = "stage"
      value_type = "STRING"
    }
    labels {
      key        = "model"
      value_type = "STRING"
    }
  }
  value_extractor = "EXTRACT(jsonPayload.costUsd)"
  label_extractors = {
    "stage" = "EXTRACT(jsonPayload.stage)"
    "model" = "EXTRACT(jsonPayload.model)"
  }
  bucket_options {
    exponential_buckets {
      num_finite_buckets = 24
      growth_factor      = 2
      scale              = 0.0001
    }
  }
}

# LLM calls per phase (counter) — exposes spec self-repair retries / research fan-out.
resource "google_logging_metric" "llm_calls" {
  name   = "topic_synthesis/llm_calls"
  filter = "${local.ts_job_log_filter} AND jsonPayload.eventType=\"llm.call\""
  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "INT64"
    display_name = "LLM calls per phase"
    labels {
      key        = "stage"
      value_type = "STRING"
    }
    labels {
      key        = "model"
      value_type = "STRING"
    }
  }
  label_extractors = {
    "stage" = "EXTRACT(jsonPayload.stage)"
    "model" = "EXTRACT(jsonPayload.model)"
  }
}

# ── Run-level metrics (run.complete + run.failed) ─────────────────────────────────────────────

resource "google_logging_metric" "run_cost_usd" {
  name   = "topic_synthesis/run_cost_usd"
  filter = "${local.ts_job_log_filter} AND jsonPayload.eventType=\"run.complete\""
  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "DISTRIBUTION"
    unit         = "1"
    display_name = "Run cost (USD)"
  }
  value_extractor = "EXTRACT(jsonPayload.costUsd)"
  bucket_options {
    exponential_buckets {
      num_finite_buckets = 24
      growth_factor      = 2
      scale              = 0.001
    }
  }
}

resource "google_logging_metric" "run_latency_ms" {
  name   = "topic_synthesis/run_latency_ms"
  filter = "${local.ts_job_log_filter} AND jsonPayload.eventType=\"run.complete\""
  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "DISTRIBUTION"
    unit         = "ms"
    display_name = "Run total wall-clock (ms)"
  }
  value_extractor = "EXTRACT(jsonPayload.totalMs)"
  bucket_options {
    exponential_buckets {
      num_finite_buckets = 20
      growth_factor      = 2
      scale              = 1000
    }
  }
}

# Run outcome (counter) — complete | degraded | failed. Producible as ONE EXTRACT because #166
# emits a single pre-bucketed `outcome` field (no conditional in label_extractors). Spans both
# run.complete (complete/degraded) and run.failed (failed).
resource "google_logging_metric" "run_outcome" {
  name   = "topic_synthesis/run_outcome"
  filter = "${local.ts_job_log_filter} AND (jsonPayload.eventType=\"run.complete\" OR jsonPayload.eventType=\"run.failed\")"
  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "INT64"
    display_name = "Run outcome"
    labels {
      key        = "outcome"
      value_type = "STRING"
    }
  }
  label_extractors = {
    "outcome" = "EXTRACT(jsonPayload.outcome)"
  }
}

# Critic pass-rate (counter) — the graded/critic verdict per completed run.
resource "google_logging_metric" "critic_pass" {
  name   = "topic_synthesis/critic_pass"
  filter = "${local.ts_job_log_filter} AND jsonPayload.eventType=\"run.complete\""
  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "INT64"
    display_name = "Critic pass / fail"
    labels {
      key        = "criticPassed"
      value_type = "STRING"
    }
  }
  label_extractors = {
    "criticPassed" = "EXTRACT(jsonPayload.criticPassed)"
  }
}

# ── Dashboard ─────────────────────────────────────────────────────────────────────────────────
# 12-col mosaic. Distribution percentiles via ALIGN_DELTA → REDUCE_PERCENTILE_*; counters via
# ALIGN_DELTA → REDUCE_SUM grouped by their low-cardinality label.

locals {
  ts_user_metric = { for k in [
    "stage_latency_ms", "stage_cost_usd", "llm_calls", "run_cost_usd", "run_latency_ms", "run_outcome", "critic_pass",
  ] : k => "${local.ts_metric_prefix}/topic_synthesis/${k}" }
}

resource "google_monitoring_dashboard" "workflow_runs" {
  dashboard_json = jsonencode({
    displayName = "Topic Synthesis — workflow runs"
    mosaicLayout = {
      columns = 12
      tiles = [
        {
          xPos = 0, yPos = 0, width = 6, height = 4
          widget = {
            title = "Phase latency p95 by stage (ms)"
            xyChart = {
              dataSets = [{
                plotType = "LINE"
                timeSeriesQuery = { timeSeriesFilter = {
                  filter      = "metric.type=\"${local.ts_user_metric["stage_latency_ms"]}\" resource.type=\"cloud_run_job\""
                  aggregation = { alignmentPeriod = "300s", perSeriesAligner = "ALIGN_DELTA", crossSeriesReducer = "REDUCE_PERCENTILE_95", groupByFields = ["metric.label.\"stage\""] }
                } }
              }]
            }
          }
        },
        {
          xPos = 6, yPos = 0, width = 6, height = 4
          widget = {
            title = "Phase latency p50 by stage (ms)"
            xyChart = {
              dataSets = [{
                plotType = "LINE"
                timeSeriesQuery = { timeSeriesFilter = {
                  filter      = "metric.type=\"${local.ts_user_metric["stage_latency_ms"]}\" resource.type=\"cloud_run_job\""
                  aggregation = { alignmentPeriod = "300s", perSeriesAligner = "ALIGN_DELTA", crossSeriesReducer = "REDUCE_PERCENTILE_50", groupByFields = ["metric.label.\"stage\""] }
                } }
              }]
            }
          }
        },
        {
          xPos = 0, yPos = 4, width = 6, height = 4
          widget = {
            title = "Phase cost p95 by stage + model (USD)"
            xyChart = {
              dataSets = [{
                plotType = "LINE"
                timeSeriesQuery = { timeSeriesFilter = {
                  filter      = "metric.type=\"${local.ts_user_metric["stage_cost_usd"]}\" resource.type=\"cloud_run_job\""
                  aggregation = { alignmentPeriod = "300s", perSeriesAligner = "ALIGN_DELTA", crossSeriesReducer = "REDUCE_PERCENTILE_95", groupByFields = ["metric.label.\"stage\"", "metric.label.\"model\""] }
                } }
              }]
            }
          }
        },
        {
          xPos = 6, yPos = 4, width = 6, height = 4
          widget = {
            title = "LLM calls per phase (exposes spec-repair retries)"
            xyChart = {
              dataSets = [{
                plotType = "STACKED_BAR"
                timeSeriesQuery = { timeSeriesFilter = {
                  filter      = "metric.type=\"${local.ts_user_metric["llm_calls"]}\" resource.type=\"cloud_run_job\""
                  aggregation = { alignmentPeriod = "300s", perSeriesAligner = "ALIGN_DELTA", crossSeriesReducer = "REDUCE_SUM", groupByFields = ["metric.label.\"stage\""] }
                } }
              }]
            }
          }
        },
        {
          xPos = 0, yPos = 8, width = 6, height = 4
          widget = {
            title = "Run cost p50 / p95 (USD)"
            xyChart = {
              dataSets = [
                {
                  plotType = "LINE"
                  timeSeriesQuery = { timeSeriesFilter = {
                    filter      = "metric.type=\"${local.ts_user_metric["run_cost_usd"]}\" resource.type=\"cloud_run_job\""
                    aggregation = { alignmentPeriod = "300s", perSeriesAligner = "ALIGN_DELTA", crossSeriesReducer = "REDUCE_PERCENTILE_50" }
                  } }
                },
                {
                  plotType = "LINE"
                  timeSeriesQuery = { timeSeriesFilter = {
                    filter      = "metric.type=\"${local.ts_user_metric["run_cost_usd"]}\" resource.type=\"cloud_run_job\""
                    aggregation = { alignmentPeriod = "300s", perSeriesAligner = "ALIGN_DELTA", crossSeriesReducer = "REDUCE_PERCENTILE_95" }
                  } }
                },
              ]
            }
          }
        },
        {
          xPos = 6, yPos = 8, width = 6, height = 4
          widget = {
            title = "Run total wall-clock p95 (ms)"
            xyChart = {
              dataSets = [{
                plotType = "LINE"
                timeSeriesQuery = { timeSeriesFilter = {
                  filter      = "metric.type=\"${local.ts_user_metric["run_latency_ms"]}\" resource.type=\"cloud_run_job\""
                  aggregation = { alignmentPeriod = "300s", perSeriesAligner = "ALIGN_DELTA", crossSeriesReducer = "REDUCE_PERCENTILE_95" }
                } }
              }]
            }
          }
        },
        {
          xPos = 0, yPos = 12, width = 6, height = 4
          widget = {
            title = "Run outcome (complete / degraded / failed)"
            xyChart = {
              dataSets = [{
                plotType = "STACKED_BAR"
                timeSeriesQuery = { timeSeriesFilter = {
                  filter      = "metric.type=\"${local.ts_user_metric["run_outcome"]}\" resource.type=\"cloud_run_job\""
                  aggregation = { alignmentPeriod = "3600s", perSeriesAligner = "ALIGN_DELTA", crossSeriesReducer = "REDUCE_SUM", groupByFields = ["metric.label.\"outcome\""] }
                } }
              }]
            }
          }
        },
        {
          xPos = 6, yPos = 12, width = 6, height = 4
          widget = {
            title = "Critic pass / fail"
            xyChart = {
              dataSets = [{
                plotType = "STACKED_BAR"
                timeSeriesQuery = { timeSeriesFilter = {
                  filter      = "metric.type=\"${local.ts_user_metric["critic_pass"]}\" resource.type=\"cloud_run_job\""
                  aggregation = { alignmentPeriod = "3600s", perSeriesAligner = "ALIGN_DELTA", crossSeriesReducer = "REDUCE_SUM", groupByFields = ["metric.label.\"criticPassed\""] }
                } }
              }]
            }
          }
        },
        {
          xPos = 0, yPos = 16, width = 12, height = 4
          widget = {
            title = "Pipeline Job executions (built-in)"
            xyChart = {
              dataSets = [{
                plotType = "STACKED_BAR"
                timeSeriesQuery = { timeSeriesFilter = {
                  filter      = "metric.type=\"run.googleapis.com/job/completed_execution_count\" resource.type=\"cloud_run_job\" resource.label.\"job_name\"=\"${google_cloud_run_v2_job.pipeline.name}\""
                  aggregation = { alignmentPeriod = "3600s", perSeriesAligner = "ALIGN_DELTA", crossSeriesReducer = "REDUCE_SUM", groupByFields = ["metric.label.\"result\""] }
                } }
              }]
            }
          }
        },
      ]
    }
  })
}
