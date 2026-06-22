#!/usr/bin/env bash
# Concept-drift gate — keep the product's CANONICAL NOUN off the live surfaces.
#
# The product refocused from a tiered *curriculum* to ONE interactive *lesson*
# (epic #52; ADR-0003). The retired PRODUCT DESCRIPTORS — `curriculum`,
# `curricula`, `tiered`, `prerequisite knowledge graph` — must not survive on
# the surfaces a USER or the LLM reads as a present-tense product claim. The
# canonical noun + the retired-terms list live in INSTANCE.md → "Product concept
# (canonical noun)"; this script is the enforcer.
#
# It is an ALLOWLIST gate, not a denylist: it scans only LIVE surfaces and FENCES
# OUT the legitimately-historical/retained trees. A retired term appears
# *correctly* in old ADRs/research (history — don't retro-edit it), in retained
# DORMANT machinery (tagged, not deleted), as code identifiers / route topology
# (`/curriculum/{id}`, getCurriculum — a deferred rename, ADR-0003), and as the
# roadmap north-star (the curriculum WRAPPER is the future, per README). Those
# pass via the per-line escape hatch below, never via whole-file suppression.
#
# A matched line FAILS unless it is one of:
#   (a) ABSENT  — the cleanup removed the stale product claim; or
#   (b) TAGGED  — it carries an inline `DORMANT:` or `RETAINED:` tag on the same
#                 line (the convention for deliberately-retained machinery); or
#   (c) ALLOWED — it carries an explicit per-line `concept-drift-ok: <reason>`
#                 comment (for legit retired-term prose: README roadmap
#                 north-star, SECURITY owner-scoping mechanism copy, route
#                 identifiers, the retired-terms list itself).
#
# Prints every offending `file:line` before exiting non-zero.
# Run from anywhere inside the repo. Exit 0 = clean, exit 1 = drift detected.
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"

# The RETIRED PRODUCT DESCRIPTORS (case-insensitive). `curricula` is covered by
# the `curricul` stem; `prerequisite knowledge graph` is the multi-word descriptor
# (the bare `prerequisite` is fine — it's a real graph-theory word the retained
# machinery legitimately uses). Mirrors INSTANCE.md → "Product concept".
retired_regex='curricul|tiered|prerequisite knowledge graph'

# The per-line ESCAPE HATCHES (any one passes a matched line). `DORMANT:` /
# `RETAINED:` are the retained-machinery tag convention; `concept-drift-ok:` is
# the explicit allow-comment for legit retired-term prose / identifiers.
escape_regex='DORMANT:|RETAINED:|concept-drift-ok:'

# LIVE-surface ALLOWLIST — the prose a user or the LLM reads. Globs are expanded
# against tracked files only (git ls-files), so a stray untracked scratch file
# can't trip or dodge the gate.
#
# DELIBERATELY NOT a `**` git pathspec: git's default pathspec semantics make `*`
# cross `/` (so `src/app/*.tsx` is recursive) while a `**` pattern needs `:(glob)`
# magic to behave — both are surprising. Instead, each allowlist entry is a
# DIRECTORY PREFIX + an EXTENSION filter, resolved by listing the tree under the
# prefix (`git ls-files -- <dir>`) and grepping the extension. Unambiguous, and it
# can't silently miss a top-level file (the bug an earlier `**` glob hid).
#
# allow_dirs: "<dir-prefix>:<ext-regex>" — every tracked file under <dir-prefix>
# whose path matches <ext-regex>.
allow_dirs=(
  'src/app:\.tsx$'      # user-facing copy (incl. top-level page.tsx + layout.tsx)
  'src/pipeline:\.ts$'  # LLM-facing stage prompts
)
# allow_files: exact tracked paths (public product descriptors).
allow_files=(
  'INSTANCE.md'         # the instance source of truth (incl. the concept block)
  'README.md'           # public product descriptor
  'SECURITY.md'         # public security posture
)

# SKIPLIST — fenced out even when an allow rule would otherwise match. These are
# historical (docs trees), retained DORMANT machinery (tagged at the source, and
# their `curriculum` use is structural, not a product claim), or tests (assert on
# the dormant shape, not user copy).
skip_regex='^docs/decisions/|^docs/research/|^docs/plans/|^src/pipeline/run-pipeline\.ts$|^src/pipeline/graph\.ts$|^src/pipeline/coverage-gate\.ts$|^src/pipeline/hub\.ts$|\.test\.ts$'

# Resolve the allowlist to a deduped, skiplist-filtered set of tracked files.
# No `mapfile` — it's bash 4+ only, and this must run on the macOS bash 3.2 a
# developer has by default as well as on CI's ubuntu-latest.
files="$(
  {
    for rule in "${allow_dirs[@]}"; do
      dir="${rule%%:*}"
      ext="${rule#*:}"
      git ls-files -- "$dir" | grep -E "$ext" || true
    done
    for f in "${allow_files[@]}"; do
      git ls-files -- "$f"
    done
  } | sort -u | grep -Ev "$skip_regex" || true
)"

fail=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  [ -f "$f" ] || continue
  # Lines that match a retired term but carry NO escape hatch are drift.
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    lineno="${line%%:*}"
    content="${line#*:}"
    if printf '%s' "$content" | grep -qiE "$escape_regex"; then
      continue
    fi
    echo "DRIFT: $f:$lineno"
    fail=1
  done < <(grep -niE "$retired_regex" "$f" || true)
done <<< "$files"

if [ "$fail" -eq 0 ]; then
  echo "OK: no concept drift — retired product nouns are absent or escaped on every live surface."
else
  echo ""
  echo "FAILED: a retired product noun appears on a live surface without an escape." >&2
  echo "Fix the copy to the canonical noun ('one interactive lesson'), OR — if the term is" >&2
  echo "legitimate (retained machinery / code identifier / roadmap north-star) — add an inline" >&2
  echo "'DORMANT:' / 'RETAINED:' tag or a 'concept-drift-ok: <reason>' comment on that line." >&2
  echo "See INSTANCE.md → 'Product concept (canonical noun)' and docs/decisions/0003-*." >&2
  exit 1
fi
