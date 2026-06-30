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

# Degrade reason (counter, issue #214) — WHY a run routed away from `built`, keyed by the low-cardinality
# `degradeCode` (critic_rejected | synthesis_error). The triad records the verdict BIT (criticPassed,
# outcome) but had no channel for the REASON; this gives the reject rate + reason distribution a queryable
# label so "is the critic over-rejecting, and why?" is answerable. STANDALONE — NOT a relabel of
# run_outcome / critic_pass (recreating an existing metric trips the scoped-apply / no-backfill rule).
# Only run.complete carries `degradeCode`, and ONLY on a degraded run (a built run omits it → it yields no
# point), so no stage/eventType conditional is needed. `degradeDetail` (the operator-only critique/error
# string) is DELIBERATELY NOT a label — it is unbounded-cardinality free text, read in the log entry, never
# a metric dimension. Log-based metrics don't backfill: this evaluates from the first post-apply run.
resource "google_logging_metric" "degrade_reason" {
  name   = "topic_synthesis/degrade_reason"
  filter = "${local.ts_job_log_filter} AND jsonPayload.eventType=\"run.complete\""
  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "INT64"
    display_name = "Degrade reason"
    labels {
      key        = "code"
      value_type = "STRING"
    }
  }
  label_extractors = {
    "code" = "EXTRACT(jsonPayload.degradeCode)"
  }
}

# ── Code-phase deep-dive metrics (PR-2, issue #178) ───────────────────────────────────────────
# PR-1 (#176, deployed) made the `code` phase STREAM and enriched its `llm.call` event with per-call
# timing/size — ttftMs/genMs/tokensPerSec/maxTokens/outputBytes (the pinned #166 envelope). These
# fields are present ONLY on the streamed call, so an EXTRACT over (e.g.) jsonPayload.ttftMs yields
# no point for the blocking analysis-stage calls — each metric self-scopes to the `code` call without
# a brittle stage filter, and keeps working if streaming later widens. Same idiom as above: one
# metric per field, scoped to llm.call, DELTA/DISTRIBUTION, stage+model low-cardinality labels.

# TTFT (prefill / "think") latency — the first half of the code-phase wall-clock split.
resource "google_logging_metric" "code_ttft_ms" {
  name   = "topic_synthesis/code_ttft_ms"
  filter = "${local.ts_job_log_filter} AND jsonPayload.eventType=\"llm.call\""
  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "DISTRIBUTION"
    unit         = "ms"
    display_name = "Code call time-to-first-token (ms)"
    labels {
      key        = "stage"
      value_type = "STRING"
    }
    labels {
      key        = "model"
      value_type = "STRING"
    }
  }
  value_extractor = "EXTRACT(jsonPayload.ttftMs)"
  label_extractors = {
    "stage" = "EXTRACT(jsonPayload.stage)"
    "model" = "EXTRACT(jsonPayload.model)"
  }
  bucket_options {
    exponential_buckets {
      num_finite_buckets = 20
      growth_factor      = 2
      scale              = 50
    }
  }
}

# Generation latency — the second half of the split (the token-stream duration).
resource "google_logging_metric" "code_gen_ms" {
  name   = "topic_synthesis/code_gen_ms"
  filter = "${local.ts_job_log_filter} AND jsonPayload.eventType=\"llm.call\""
  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "DISTRIBUTION"
    unit         = "ms"
    display_name = "Code call generation latency (ms)"
    labels {
      key        = "stage"
      value_type = "STRING"
    }
    labels {
      key        = "model"
      value_type = "STRING"
    }
  }
  value_extractor = "EXTRACT(jsonPayload.genMs)"
  label_extractors = {
    "stage" = "EXTRACT(jsonPayload.stage)"
    "model" = "EXTRACT(jsonPayload.model)"
  }
  bucket_options {
    exponential_buckets {
      num_finite_buckets = 20
      growth_factor      = 2
      scale              = 50
    }
  }
}

# Generation throughput (tokens/sec) — derived in the span bridge (outputTokens / genMs).
resource "google_logging_metric" "code_tokens_per_sec" {
  name   = "topic_synthesis/code_tokens_per_sec"
  filter = "${local.ts_job_log_filter} AND jsonPayload.eventType=\"llm.call\""
  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "DISTRIBUTION"
    unit         = "1"
    display_name = "Code call generation throughput (tokens/sec)"
    labels {
      key        = "stage"
      value_type = "STRING"
    }
    labels {
      key        = "model"
      value_type = "STRING"
    }
  }
  value_extractor = "EXTRACT(jsonPayload.tokensPerSec)"
  label_extractors = {
    "stage" = "EXTRACT(jsonPayload.stage)"
    "model" = "EXTRACT(jsonPayload.model)"
  }
  bucket_options {
    exponential_buckets {
      num_finite_buckets = 25
      growth_factor      = 1.5
      scale              = 1
    }
  }
}

# Artifact size (output bytes) — the rendered standalone-HTML payload size.
resource "google_logging_metric" "code_output_bytes" {
  name   = "topic_synthesis/code_output_bytes"
  filter = "${local.ts_job_log_filter} AND jsonPayload.eventType=\"llm.call\""
  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "DISTRIBUTION"
    unit         = "By"
    display_name = "Code artifact size (output bytes)"
    labels {
      key        = "stage"
      value_type = "STRING"
    }
    labels {
      key        = "model"
      value_type = "STRING"
    }
  }
  value_extractor = "EXTRACT(jsonPayload.outputBytes)"
  label_extractors = {
    "stage" = "EXTRACT(jsonPayload.stage)"
    "model" = "EXTRACT(jsonPayload.model)"
  }
  bucket_options {
    exponential_buckets {
      num_finite_buckets = 20
      growth_factor      = 2
      scale              = 128
    }
  }
}

# The maxTokens cap (currently 32000) — EXTRACTed, not hard-coded, so the cap-proximity tile tracks
# any future change. maxTokens is streamed-only, so this self-scopes to the code call.
resource "google_logging_metric" "code_max_tokens" {
  name   = "topic_synthesis/code_max_tokens"
  filter = "${local.ts_job_log_filter} AND jsonPayload.eventType=\"llm.call\""
  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "DISTRIBUTION"
    unit         = "1"
    display_name = "Code call output-token cap (maxTokens)"
    labels {
      key        = "stage"
      value_type = "STRING"
    }
    labels {
      key        = "model"
      value_type = "STRING"
    }
  }
  value_extractor = "EXTRACT(jsonPayload.maxTokens)"
  label_extractors = {
    "stage" = "EXTRACT(jsonPayload.stage)"
    "model" = "EXTRACT(jsonPayload.model)"
  }
  bucket_options {
    exponential_buckets {
      num_finite_buckets = 16
      growth_factor      = 2
      scale              = 1000
    }
  }
}

# The cap-proximity numerator — actual output tokens. Unlike the timing fields, `outputTokens` is on
# EVERY llm.call (it lives in the span bridge's `base`, not the streamed-only branch), so this metric
# does NOT self-scope. Filter it to jsonPayload.stage="code" (plan-review refinement #1) so the
# "output vs cap" overlay is apples-to-apples — a code-only p95 against the code-only maxTokens cap,
# not an all-stages p95 inflated by research fan-out / spec calls.
resource "google_logging_metric" "code_output_tokens" {
  name   = "topic_synthesis/code_output_tokens"
  filter = "${local.ts_job_log_filter} AND jsonPayload.eventType=\"llm.call\" AND jsonPayload.stage=\"code\""
  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "DISTRIBUTION"
    unit         = "1"
    display_name = "Code call output tokens (cap-proximity numerator)"
    labels {
      key        = "stage"
      value_type = "STRING"
    }
    labels {
      key        = "model"
      value_type = "STRING"
    }
  }
  value_extractor = "EXTRACT(jsonPayload.outputTokens)"
  label_extractors = {
    "stage" = "EXTRACT(jsonPayload.stage)"
    "model" = "EXTRACT(jsonPayload.model)"
  }
  bucket_options {
    exponential_buckets {
      num_finite_buckets = 16
      growth_factor      = 2
      scale              = 100
    }
  }
}

# ── Dashboard ─────────────────────────────────────────────────────────────────────────────────
# 12-col mosaic. Distribution percentiles via ALIGN_DELTA → REDUCE_PERCENTILE_*; counters via
# ALIGN_DELTA → REDUCE_SUM grouped by their low-cardinality label.

locals {
  ts_user_metric = { for k in [
    "stage_latency_ms", "stage_cost_usd", "llm_calls", "run_cost_usd", "run_latency_ms", "run_outcome", "critic_pass",
    "degrade_reason",
    "code_ttft_ms", "code_gen_ms", "code_tokens_per_sec", "code_output_bytes", "code_max_tokens", "code_output_tokens",
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
        # ── Code-phase deep-dive band (PR-2, issue #178) — appended below the mosaic at yPos >= 20.
        {
          xPos = 0, yPos = 20, width = 6, height = 4
          widget = {
            title = "Code phase: TTFT vs generation (p50 / p95, ms)"
            xyChart = {
              dataSets = [
                {
                  plotType = "LINE"
                  timeSeriesQuery = { timeSeriesFilter = {
                    filter      = "metric.type=\"${local.ts_user_metric["code_ttft_ms"]}\" resource.type=\"cloud_run_job\""
                    aggregation = { alignmentPeriod = "300s", perSeriesAligner = "ALIGN_DELTA", crossSeriesReducer = "REDUCE_PERCENTILE_50" }
                  } }
                },
                {
                  plotType = "LINE"
                  timeSeriesQuery = { timeSeriesFilter = {
                    filter      = "metric.type=\"${local.ts_user_metric["code_ttft_ms"]}\" resource.type=\"cloud_run_job\""
                    aggregation = { alignmentPeriod = "300s", perSeriesAligner = "ALIGN_DELTA", crossSeriesReducer = "REDUCE_PERCENTILE_95" }
                  } }
                },
                {
                  plotType = "LINE"
                  timeSeriesQuery = { timeSeriesFilter = {
                    filter      = "metric.type=\"${local.ts_user_metric["code_gen_ms"]}\" resource.type=\"cloud_run_job\""
                    aggregation = { alignmentPeriod = "300s", perSeriesAligner = "ALIGN_DELTA", crossSeriesReducer = "REDUCE_PERCENTILE_50" }
                  } }
                },
                {
                  plotType = "LINE"
                  timeSeriesQuery = { timeSeriesFilter = {
                    filter      = "metric.type=\"${local.ts_user_metric["code_gen_ms"]}\" resource.type=\"cloud_run_job\""
                    aggregation = { alignmentPeriod = "300s", perSeriesAligner = "ALIGN_DELTA", crossSeriesReducer = "REDUCE_PERCENTILE_95" }
                  } }
                },
              ]
            }
          }
        },
        {
          xPos = 6, yPos = 20, width = 6, height = 4
          widget = {
            title = "Code phase throughput (tokens/sec, p50 / p95)"
            xyChart = {
              dataSets = [
                {
                  plotType = "LINE"
                  timeSeriesQuery = { timeSeriesFilter = {
                    filter      = "metric.type=\"${local.ts_user_metric["code_tokens_per_sec"]}\" resource.type=\"cloud_run_job\""
                    aggregation = { alignmentPeriod = "300s", perSeriesAligner = "ALIGN_DELTA", crossSeriesReducer = "REDUCE_PERCENTILE_50" }
                  } }
                },
                {
                  plotType = "LINE"
                  timeSeriesQuery = { timeSeriesFilter = {
                    filter      = "metric.type=\"${local.ts_user_metric["code_tokens_per_sec"]}\" resource.type=\"cloud_run_job\""
                    aggregation = { alignmentPeriod = "300s", perSeriesAligner = "ALIGN_DELTA", crossSeriesReducer = "REDUCE_PERCENTILE_95" }
                  } }
                },
              ]
            }
          }
        },
        {
          xPos = 0, yPos = 24, width = 6, height = 4
          widget = {
            # Apples-to-apples: code_output_tokens is stage-scoped to "code" (refinement #1), overlaid
            # with the code_max_tokens cap line — the visual gap is the headroom under the 32k cap.
            title = "Code output vs 32k cap (output-tokens p95 vs maxTokens)"
            xyChart = {
              dataSets = [
                {
                  plotType = "LINE"
                  timeSeriesQuery = { timeSeriesFilter = {
                    filter      = "metric.type=\"${local.ts_user_metric["code_output_tokens"]}\" resource.type=\"cloud_run_job\""
                    aggregation = { alignmentPeriod = "300s", perSeriesAligner = "ALIGN_DELTA", crossSeriesReducer = "REDUCE_PERCENTILE_95" }
                  } }
                },
                {
                  plotType = "LINE"
                  timeSeriesQuery = { timeSeriesFilter = {
                    filter      = "metric.type=\"${local.ts_user_metric["code_max_tokens"]}\" resource.type=\"cloud_run_job\""
                    aggregation = { alignmentPeriod = "300s", perSeriesAligner = "ALIGN_DELTA", crossSeriesReducer = "REDUCE_PERCENTILE_50" }
                  } }
                },
              ]
            }
          }
        },
        {
          xPos = 6, yPos = 24, width = 6, height = 4
          widget = {
            title = "Code artifact size (output bytes, p95)"
            xyChart = {
              dataSets = [{
                plotType = "LINE"
                timeSeriesQuery = { timeSeriesFilter = {
                  filter      = "metric.type=\"${local.ts_user_metric["code_output_bytes"]}\" resource.type=\"cloud_run_job\""
                  aggregation = { alignmentPeriod = "300s", perSeriesAligner = "ALIGN_DELTA", crossSeriesReducer = "REDUCE_PERCENTILE_95" }
                } }
              }]
            }
          }
        },
        # ── Degrade reason (issue #214) — WHY a run degraded, by low-cardinality code. Sits below the
        # code-phase band; pairs with the run-outcome / critic panels above (yPos 12) conceptually.
        {
          xPos = 0, yPos = 28, width = 6, height = 4
          widget = {
            title = "Degrade reason (critic_rejected / synthesis_error)"
            xyChart = {
              dataSets = [{
                plotType = "STACKED_BAR"
                timeSeriesQuery = { timeSeriesFilter = {
                  filter      = "metric.type=\"${local.ts_user_metric["degrade_reason"]}\" resource.type=\"cloud_run_job\""
                  aggregation = { alignmentPeriod = "3600s", perSeriesAligner = "ALIGN_DELTA", crossSeriesReducer = "REDUCE_SUM", groupByFields = ["metric.label.\"code\""] }
                } }
              }]
            }
          }
        },
      ]
    }
  })
}

# ── Run-health alert: sustained NON-COMPLETE (degraded|failed) rate (issue #185) ──────────────
# A run that does not produce a built lesson is a problem whether it `degraded` to a `'soon'` page OR
# `failed` outright (a persist/pipeline crash) — both ship nothing useful, and both are silent: the
# BPD lesson degraded in prod and nobody knew until the owner asked, and the 2026-06-30 post-deploy
# storm was a run.FAILED burst (persist failures), NOT degrades. So this alerts on the COMPLEMENT of
# success: fire when COMPLETE (built) runs become a MINORITY — i.e. `(degraded + failed) / total`
# exceeds 0.5 ("the product stopped producing built lessons"). This catches BOTH failure modes.
#
# It reads the structured signal we already emit: `run.complete{outcome}` (run-job.ts, complete|
# degraded) AND `run.failed{outcome:'failed'}` (run-job.ts:94), both projected to the `run_outcome`
# counter above — NOT a brittle regex over the `console.warn` free text (no labels, breaks on a
# wording change).
#
# Channel = EMAIL = ticket-class, never a page. On a single-user app the real risk is a FALSE NEGATIVE
# (a stale-deploy/all-degrade or a failure storm going unseen), so the condition biases toward
# sensitivity: a RATIO, not an absolute count (SRE doctrine: low-traffic services alert on a rate, not
# a single event). It fires when the non-complete fraction over a 1h tumbling window exceeds 0.5,
# guarded by a ≥2-run minimum so a single isolated bad run does not trip it — a stale deploy or a
# failure storm pushes the fraction to ~1.0 and trips with as few as 2 runs, while a lone bad run amid
# healthy completes keeps the fraction low and stays quiet. No metric-absence arm (a DELTA counter
# emits points only on terminating runs, so absence cannot tell a broken deploy from an idle day on a
# single-user app).
#
# DEPLOY: orchestrator-run SCOPED apply only —
#   terraform apply -target=google_monitoring_notification_channel.alert_email \
#                   -target=google_monitoring_alert_policy.degrade_rate
# NEVER a full apply (the known TF-drift gotcha). Log-based metrics/alerts do NOT backfill — the
# policy evaluates from the first post-apply run.
#
# VERIFY (orchestrator, post-apply): `terraform validate`/`fmt` check HCL/schema shape only — they do
# NOT exercise the MQL query string below. A valid-but-wrong ratio passes every static check yet
# silently never fires (the exact false-negative this alert targets). After the scoped apply, confirm
# the condition actually evaluates — inspect the policy's condition state in Cloud Monitoring, or
# trigger a controlled degrade and confirm the email fires — before trusting it (issue #185 AC).

resource "google_monitoring_notification_channel" "alert_email" {
  display_name = "Topic Synthesis — run-health alerts (email)"
  type         = "email"
  labels = {
    email_address = var.alert_email
  }
}

resource "google_monitoring_alert_policy" "degrade_rate" {
  display_name = "Topic Synthesis — sustained non-complete run rate"
  combiner     = "OR" # single condition; OR is the GCP default for a one-condition policy.

  # ONE condition = one metric reference ($0.35/mo once alerting billing starts ≥ Sep 1 2026; $0 today).
  # MQL expresses the non-complete RATIO + the ≥2-run guard in a single condition (a native threshold
  # ratio cannot enforce the run-count floor in one condition). The query collapses the `run_outcome`
  # counter to a global bad (= NON-complete: degraded OR failed) vs. total count over a trailing 1h
  # window and fires only when the bad fraction exceeds 0.5 AND there are at least 2 runs.
  #
  # NUMERATOR = bad (`outcome != 'complete'`), not `complete`, ON PURPOSE: the inner join drops to no
  # rows when its filtered branch is empty, so we must filter the side that is NON-empty exactly when
  # we want to fire. With `bad` as the numerator: all runs healthy → `bad` branch empty → join empty →
  # quiet (correct); a degrade/failure storm → `bad` non-empty → join matches → evaluated (correct,
  # including a TOTAL outage where zero runs completed — the `complete < total*0.5` form would have an
  # empty numerator there and silently never fire). `!= 'complete'` also future-proofs: any new
  # non-complete outcome counts as bad automatically.
  #
  # The ratio is the cross-multiplication `bad > total * 0.5` rather than `bad / total > 0.5` ON
  # PURPOSE: both sums are INT64, so a literal `/` risks INTEGER division (e.g. 3 bad / 5 total = 0,
  # silently never firing on a 60%-bad window). The `* 0.5` form promotes to float comparison and also
  # sidesteps divide-by-zero. Equivalent for total ≥ 2 > 0.
  conditions {
    display_name = "Non-complete (degraded|failed) fraction > 50% (≥2 runs, 1h tumbling)"
    condition_monitoring_query_language {
      # 1h TUMBLING window evaluated hourly: `align delta(1h)` sets BOTH the window width and the output
      # period to 1h. Do NOT add `| every 5m` — the `delta` aligner REQUIRES window == period, and GCP
      # REJECTS the policy at apply time ("alignment window of 1h differs from the alignment period of
      # 5m"). `terraform validate` does NOT catch this — only the live apply does. A true sliding window
      # would need a `group_by` over `sliding(1h)`, not `delta + every`; an hourly bucket is sufficient.
      query    = <<-MQL
        fetch cloud_run_job
        | metric 'logging.googleapis.com/user/topic_synthesis/run_outcome'
        | align delta(1h)
        | {
            filter metric.outcome != 'complete'
            | group_by [], [bad: sum(val())]
          ;
            group_by [], [total: sum(val())]
          }
        | join
        | condition bad > total * 0.5 && total >= 2
      MQL
      duration = "0s" # fire on the first violating evaluation — email is ticket-class, bias to sensitivity.
      trigger {
        count = 1
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.alert_email.id]

  alert_strategy {
    auto_close = "1800s" # 30m — clear the incident once runs recover.
  }

  documentation {
    mime_type = "text/markdown"
    content   = <<-DOC
      **Sustained non-complete run rate** — over half of recent runs did NOT produce a built lesson
      (degraded to `'soon'` OR failed outright) over a 1h tumbling window (≥2 runs).

      The product has effectively stopped shipping built lessons. Common causes: a stale/rolled-back
      deploy that degrades every run, a quality regression, or a persist/pipeline failure storm
      (`run.failed`) like the 2026-06-30 post-deploy incident.

      Runbook:
      1. Check for a recent deploy — a stale/rolled-back image degrades or fails every run (`codeRev`, issue #184, stamps the running commit on each run event).
      2. Inspect the pipeline Job's Cloud Logging for `run.failed` / stage errors to tell degrade from failure.
      3. Open the workflow-runs dashboard (run outcome + critic panels) for the degrade/failure pattern.
    DOC
  }
}
