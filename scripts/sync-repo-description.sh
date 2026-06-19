#!/usr/bin/env bash
# Sync the GitHub repository description from the canonical value in INSTANCE.md.
#
# The one-line GitHub "description" (what `gh repo edit --description` sets, shown
# under the repo name on GitHub) is LIVE metadata, not a file in any diff — so the
# PR-time doc-currency check can't see it. This script is the seam that ties that
# live value back to a tracked source of truth: the line between the
# REPO_DESCRIPTION markers in INSTANCE.md.
#
# Two modes:
#   --check    read-only. Compare the live GitHub description to the canonical
#              value; exit 0 if they match, exit 1 (printing both) if they drift.
#              Safe for a reviewer / CI to run — it never writes. This is the
#              detection half a reviewer runs to raise a
#              "repo-description drift (orchestrator action)" finding.
#   (no flag)  sync. Push the canonical value to GitHub via `gh repo edit`. This
#              MUTATES repo settings, so per AGENTS.md → "Keeping docs and
#              drift-prone files current" it is an ORCHESTRATOR action: the
#              reviewer flags drift; the orchestrator runs this after merge so the
#              live value reflects merged `main`.
#
# Slug + auth come from `gh` and the repo's `origin` remote, so it works from any
# worktree. Run from anywhere inside the repo. Requires an authenticated `gh`.
set -euo pipefail

usage() {
  echo "Usage: $(basename "$0") [--check]"
  echo "  --check    compare the live GitHub description to INSTANCE.md (read-only; exit 1 on drift)"
  echo "  (no flag)  sync the canonical INSTANCE.md value to GitHub (orchestrator action)"
}

mode="sync"
case "${1:-}" in
  --check)   mode="check" ;;
  -h|--help) usage; exit 0 ;;
  "")        ;;
  *)         echo "FAIL: unknown argument: $1" >&2; usage >&2; exit 2 ;;
esac

command -v gh >/dev/null 2>&1 || {
  echo "FAIL: the GitHub CLI (gh) is not installed or not on PATH." >&2
  exit 2
}

root="$(git rev-parse --show-toplevel)"
cd "$root"
instance="$root/INSTANCE.md"
[ -f "$instance" ] || { echo "FAIL: $instance not found." >&2; exit 2; }

# Canonical value = first non-empty line between the REPO_DESCRIPTION markers.
canonical="$(awk '
  /REPO_DESCRIPTION:START/ { grab=1; next }
  /REPO_DESCRIPTION:END/   { grab=0 }
  grab && NF              { print; exit }
' "$instance")"
# Trim leading/trailing whitespace.
canonical="${canonical#"${canonical%%[![:space:]]*}"}"
canonical="${canonical%"${canonical##*[![:space:]]}"}"

if [ -z "$canonical" ]; then
  echo "FAIL: no canonical description found between the REPO_DESCRIPTION markers in $instance." >&2
  exit 2
fi

# Live value from GitHub (gh infers the repo from the origin remote).
live="$(gh repo view --json description -q .description)"

if [ "$mode" = "check" ]; then
  if [ "$live" = "$canonical" ]; then
    echo "OK: GitHub description matches INSTANCE.md."
    echo "    \"$canonical\""
    exit 0
  fi
  echo "DRIFT: the live GitHub description does not match INSTANCE.md." >&2
  echo "  canonical (INSTANCE.md): \"$canonical\"" >&2
  echo "  live (GitHub):           \"$live\"" >&2
  echo "  Fix (orchestrator): run scripts/sync-repo-description.sh (no flag)." >&2
  exit 1
fi

# sync mode (orchestrator only)
if [ "$live" = "$canonical" ]; then
  echo "OK: GitHub description already matches INSTANCE.md — nothing to do."
  echo "    \"$canonical\""
  exit 0
fi
echo "Setting the GitHub description to the canonical INSTANCE.md value:"
echo "    \"$canonical\""
gh repo edit --description "$canonical"
echo "Done (was: \"$live\")."
