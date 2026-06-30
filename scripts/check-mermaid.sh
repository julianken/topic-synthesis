#!/usr/bin/env bash
# Proactive, author-side mermaid validation: render every column-0 ```mermaid
# fenced block in the given markdown file(s) and report any that fail to render.
#
# WHY: a broken ```mermaid block renders as raw source on github.com (a silent
# docs-rot bug). The only pre-existing check was the bot's REACTIVE R15, which
# fires during PR review of an ALREADY-POSTED body — too late. This script is
# the PROACTIVE gate: run it on a PR/issue body file (or a committed .md)
# BEFORE posting, and fix any non-zero exit. It is also the reviewer-parity and
# committed-.md-CI renderer, so author and reviewer run the SAME renderer.
#
# Usage: check-mermaid.sh <markdown-file>...
#
# Exit codes (three-valued so a TOOLCHAIN failure is never mistaken for a
# diagram failure):
#   0  every block rendered, OR the file(s) carry zero mermaid blocks
#   1  >=1 block failed to render (the broken-diagram case)
#   2  usage error / a file is missing / npx is unavailable
#
# Render core REUSED from the bot helper
# ~/.claude/skills/reviewing-as-julianken-bot/scripts/check-mermaid-render.sh
# (the no-drift pair — AGENTS.md). The load-bearing gotcha: `mmdc -q` exits 0
# even on a PARSE error, so the success signal is NOT the exit code but a
# non-empty output SVG ([ -s "$svg" ]) rendered to a REAL temp .svg (mmdc keys
# off the output extension — never /dev/null). The two scripts deliberately
# diverge in I/O (this one: three-valued exit + human stderr; the bot helper:
# two-valued JSON for the review) but the render core stays in lockstep.
#
# Portable: macOS bash 3.2 AND ubuntu CI (no `mapfile`, no associative arrays).
set -euo pipefail

usage() {
  echo "Usage: $0 <markdown-file>..." >&2
  echo "  Renders every column-0 \`\`\`mermaid block in each file via mermaid-cli (mmdc)." >&2
  echo "  Exit 0 = all blocks rendered (or zero blocks); 1 = a block failed; 2 = usage/file-missing/npx-unavailable." >&2
}

# --- 0. Arg check -------------------------------------------------------------
if [ "$#" -eq 0 ]; then
  usage
  exit 2
fi

# --- 1. npx guard (up front) --------------------------------------------------
# A missing toolchain is exit 2, NOT a content failure (exit 1). mmdc is fetched
# on demand via npx (no repo devDep), matching the bot helper + the e2e harness.
if ! command -v npx >/dev/null 2>&1; then
  echo "check-mermaid: npx not found on PATH — cannot render mermaid (install Node.js >= 18)." >&2
  exit 2
fi

# --- 2. File-existence check (up front) ---------------------------------------
for f in "$@"; do
  if [ ! -f "$f" ]; then
    echo "check-mermaid: file not found: $f" >&2
    exit 2
  fi
done

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

# --- 3. Extract every column-0 ```mermaid block (NO render yet) ---------------
# One numbered .mmd per block; a TSV manifest records its source file + the line
# of its opening fence (for a human-readable failure message). The column-0
# fence regex matches the bot helper exactly (info-string / indented fences are a
# shared, documented blind spot — bodies conventionally use column-0 fences).
manifest="$WORKDIR/manifest.tsv"
: > "$manifest"
fileidx=0
for src in "$@"; do
  fileidx=$((fileidx + 1))
  awk -v workdir="$WORKDIR" -v src="$src" -v manifest="$manifest" -v fileidx="$fileidx" '
    /^```mermaid[[:space:]]*$/ {
      f = 1; n++;
      outfile = sprintf("%s/block-%02d-%02d.mmd", workdir, fileidx, n);
      printf "%s\t%s\t%d\n", outfile, src, NR >> manifest;
      next
    }
    /^```[[:space:]]*$/ && f { f = 0; next }
    f { print >> outfile }
  ' "$src"
done

# --- 4. Extract-before-render: a zero-mermaid body exits 0 with no mmdc spawn --
total="$(wc -l < "$manifest" | tr -d '[:space:]')"
if [ "$total" -eq 0 ]; then
  echo "check-mermaid: no mermaid blocks found in $# file(s) — nothing to render." >&2
  exit 0
fi

# --- 5. Render each block. Success = a non-empty SVG was produced (see header) -
failures=0
while IFS="$(printf '\t')" read -r mmdfile srcfile fenceline; do
  [ -n "$mmdfile" ] || continue
  svg="${mmdfile%.mmd}.svg"
  # mermaid-cli is PINNED (CI-load-bearing — an unpinned release could flip CI without a repo change).
  # Keep this version in lockstep with the bot helper check-mermaid-render.sh (render-core lockstep, AGENTS.md).
  err="$(npx --yes -p @mermaid-js/mermaid-cli@11.16.0 mmdc -i "$mmdfile" -o "$svg" -q 2>&1 || true)"
  if [ -s "$svg" ]; then
    continue
  fi
  failures=$((failures + 1))
  first_err="$(printf '%s\n' "$err" | grep -m1 '^Error:' || true)"
  [ -n "$first_err" ] || first_err="$(printf '%s\n' "$err" | sed -n '1p')"
  echo "check-mermaid: FAIL ${srcfile}:${fenceline} (\`\`\`mermaid block) — ${first_err}" >&2
done < "$manifest"

# --- 6. Result ----------------------------------------------------------------
if [ "$failures" -gt 0 ]; then
  echo "check-mermaid: ${failures} of ${total} mermaid block(s) failed to render." >&2
  exit 1
fi
echo "check-mermaid: all ${total} mermaid block(s) rendered."
exit 0
