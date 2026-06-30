# Deploy runbook — codified build, deploy-by-digest, verify gate

The canonical recipe for shipping new bytes to the Cloud Run **Service** (app) and **Job** (pipeline +
migrate) images. It replaces the un-versioned manual `gcloud builds submit` that let a stale Job image ship
under a fresh commit-SHA tag (run `cea1663a`, 2026-06-29 — see [issue #184](https://github.com/julianken/topic-synthesis/issues/184)).

**Who runs this:** the **orchestrator** (it holds `gcloud`/`terraform` auth). The implementer and reviewer
never run a deploy. Every step below is a real, scoped operation — no `terraform apply` without `-target`.

The flow is four phases: **build (clean) → deploy by digest → verify (`running_sha == deployed_sha`) →
promote traffic.** The verify gate is the step that would have caught the #184 incident; do not skip it.

```
git SHA ──► cloudbuild.yaml (NO remote cache) ──► app@sha256:… + job@sha256:…
                                                          │
              ┌───────────────────────────────────────────┘
              ▼
   deploy BY DIGEST (Service --no-traffic, Jobs update)
              ▼
   VERIFY: /version gitSha == SHA  AND  Job boot-log gitSha == SHA  (else abort)
              ▼
   promote traffic --to-latest   +   reconcile Terraform state by digest (-target, -var)
```

Set these once per deploy:

```sh
export GIT_SHA="$(git rev-parse HEAD)"
export AR="us-central1-docker.pkg.dev/topic-synthesis-prod/topic-synthesis"   # infra/outputs.tf registry_repo
export REGION="us-central1"
```

## 1. Build — clean, commit-stamped, no remote cache

`cloudbuild.yaml` builds both images with **no remote layer cache** (the only way a stale layer is
possible), tags each by the commit SHA **and** `latest`, and stamps the commit into the image via
`--build-arg GIT_SHA` (→ the OCI `org.opencontainers.image.revision` LABEL + a runtime `ENV GIT_SHA`). A
manual `gcloud builds submit` does **not** populate `$COMMIT_SHA`, so pass the SHA explicitly. The public
Identity Platform web config is supplied from the Terraform outputs (browser-shipped, not a secret):

```sh
gcloud builds submit \
  --config cloudbuild.yaml \
  --substitutions=_GIT_SHA="$GIT_SHA",_FIREBASE_API_KEY="$(terraform -chdir=infra output -raw auth_web_api_key)" \
  .
```

(`_FIREBASE_PROJECT_ID` / `_FIREBASE_AUTH_DOMAIN` default to the prod values in `cloudbuild.yaml`; override
them too if the project changes.) **`_FIREBASE_API_KEY` has no default** — these `NEXT_PUBLIC_FIREBASE_*`
values are inlined into the client bundle at `next build`, and a blank key would silently break Google
sign-in **while still passing the `/version` verify gate** (which checks only the gitSha). The build
**fails fast** if it's missing (Cloud Build's strict substitution match) or empty (the first build step,
`assert-firebase-config`), so the bundle is never built with a blank key — don't bypass that guard.

Then resolve the **immutable digests** that the SHA tag now points at — deploy by these, never by the
mutable tag:

```sh
export APP_DIGEST="$(gcloud artifacts docker images describe "$AR/app:$GIT_SHA" --format='value(image_summary.digest)')"
export JOB_DIGEST="$(gcloud artifacts docker images describe "$AR/job:$GIT_SHA" --format='value(image_summary.digest)')"
echo "app@$APP_DIGEST  job@$JOB_DIGEST"
```

**Sanity check (the #184 regression):** confirm the new `job` digest is **not** the stale
`sha256:da741df5…`. If it matches, the build served a cached layer — stop and investigate before deploying.

## 2. Deploy by digest

Deploy the **Service** to a new revision that takes **no traffic** yet (so it can be verified before
promotion), reachable at a tagged URL:

```sh
gcloud run deploy topic-synthesis-app --region "$REGION" \
  --image "$AR/app@$APP_DIGEST" \
  --no-traffic --tag "v${GIT_SHA:0:7}"
# capture the printed tagged URL:
export TAG_URL="$(gcloud run services describe topic-synthesis-app --region "$REGION" \
  --format='value(status.traffic.url)' | tr ';' '\n' | grep "v${GIT_SHA:0:7}" || true)"
```

Update both **Jobs** to the new job digest (a Job has no traffic split; the next execution uses the new
image — `topic-synthesis-migrate` shares the job image, command-overridden to `tsx src/store/migrate.ts`):

```sh
gcloud run jobs update topic-synthesis-pipeline --region "$REGION" --image "$AR/job@$JOB_DIGEST"
gcloud run jobs update topic-synthesis-migrate  --region "$REGION" --image "$AR/job@$JOB_DIGEST"
```

## 3. Verify gate — `running_sha == deployed_sha` (else abort)

This is the control that catches a stale image *before* it serves users. Both halves must equal `$GIT_SHA`.

**Service** — the no-traffic revision self-reports its commit at `/version`:

```sh
RUNNING="$(curl -fsS "$TAG_URL/version" | jq -r .gitSha)"
[ "$RUNNING" = "$GIT_SHA" ] || { echo "STALE SERVICE: /version=$RUNNING != $GIT_SHA — ABORT"; exit 1; }
```

**Job** — run a cheap smoke execution and assert its boot log + telemetry report the deployed commit and
the streaming (`schemaVersion: 3`) code path:

```sh
gcloud run jobs execute topic-synthesis-pipeline --region "$REGION" --wait \
  --update-env-vars=RUN_ID="smoke-${GIT_SHA:0:7}",TOPIC="checksum smoke",CHEAP=1,MAX_QUESTIONS=1

# the canonical per-run commit signal — the run-job.boot line — must equal $GIT_SHA:
gcloud logging read \
  'resource.type="cloud_run_job" AND jsonPayload.event="run-job.boot"' \
  --limit=1 --freshness=15m --format='value(jsonPayload.gitSha)'
# and run.complete must carry schemaVersion 3 + codeRev == $GIT_SHA (the post-fix streaming telemetry):
gcloud logging read \
  'resource.type="cloud_run_job" AND jsonPayload.eventType="run.complete"' \
  --limit=1 --freshness=15m --format='value(jsonPayload.schemaVersion, jsonPayload.codeRev)'
```

If either value is not `$GIT_SHA` (or `schemaVersion` is not `3`), the running bytes are stale — **abort,
do not promote traffic**, and rebuild (the build served a cached layer the clean config should have
prevented).

## 4. Promote traffic + reconcile Terraform

Only after the gate passes, send live traffic to the verified Service revision:

```sh
gcloud run services update-traffic topic-synthesis-app --region "$REGION" --to-latest
```

### Terraform reconciliation (load-bearing — do not skip)

`infra/variables.tf` defaults `app_image` / `job_image` to the **mutable `:latest`** tag (lines 19–28),
consumed at `infra/cloud-run.tf:38` / `:104` / `:151`. A digest deployed out-of-band by `gcloud` is
**silently reverted to `:latest` by the next `terraform apply`** — re-introducing exactly the tag-mutability
this runbook exists to eliminate. So, after promoting:

```sh
terraform -chdir=infra apply \
  -target=google_cloud_run_v2_service.app \
  -target=google_cloud_run_v2_job.pipeline \
  -target=google_cloud_run_v2_job.migrate \
  -var="app_image=$AR/app@$APP_DIGEST" \
  -var="job_image=$AR/job@$JOB_DIGEST"
```

**Standing rule — gcloud owns image deploys.** Terraform only *follows* by digest via scoped `-target`.
**Never run a full `terraform apply`** for an image change, and never an apply without the `-var` digest
pins — either one reverts the live revision to `:latest` and undoes the verify-gated immutable digest
(this is the known TF-drift gotcha: always pin `-var <image>` to the live digest). Infra changes that are
*not* image deploys (a new resource, an env tweak) still use `-target` to the specific resource and carry
the current digests in their `-var` pins so the same revert can't happen as a side effect.

## 5. Artifact Registry cleanup policy (bound SHA-tag growth)

SHA-tagging every build accumulates image versions. A keep-10 / delete-older-than-30d policy bounds the
repo. Keep rules take precedence over delete, so the 10 most-recent are always retained even if older than
30 days. **Always `--dry-run` first** and read the would-delete list before applying:

```sh
cat > /tmp/ar-cleanup.json <<'JSON'
[
  { "name": "keep-recent",  "action": { "type": "Keep" },   "mostRecentVersions": { "keepCount": 10 } },
  { "name": "delete-stale", "action": { "type": "Delete" }, "condition": { "olderThan": "30d" } }
]
JSON

# 1) DRY RUN — prints what WOULD be deleted; change nothing yet:
gcloud artifacts repositories set-cleanup-policies topic-synthesis \
  --location="$REGION" --policy=/tmp/ar-cleanup.json --dry-run

# 2) only after reviewing the dry-run output, apply for real (drop --dry-run):
gcloud artifacts repositories set-cleanup-policies topic-synthesis \
  --location="$REGION" --policy=/tmp/ar-cleanup.json
```

## 6. Post-merge clean redeploy (the #184 restoration)

After #184 merges, the orchestrator runs phases 1–4 from `origin/main`, confirms the new `job` digest ≠
`da741df5`, that the smoke run emits `schemaVersion: 3` + streams, then re-runs topic *"borderline
personality disorder"* and confirms it reaches **`built`** (not `'soon'`). Record the digests + outcome in
the PR/issue thread. This is the action that actually restores streaming (#176) to prod.
