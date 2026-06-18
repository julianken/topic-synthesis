#!/usr/bin/env bash
# Validate the agentic-seed template's committed *scaffolding* invariants — the
# process/config skeleton an agent relies on, not the (still absent) app.
#
# This is deliberately NOT app lint/test/build: the seed is pre-code (no
# package.json, no source). It checks only what exists today — that the
# single-source-of-truth shim is intact, the required process/skill/adapter
# files are present and non-empty, and that the template is internally
# consistent: every {{PLACEHOLDER}} token used anywhere in the tree is DECLARED
# in .seed/placeholders.json.
#
# It must PASS on the UNFILLED template (which legitimately contains
# {{PLACEHOLDERS}}) AND on a filled instance (which has none left). It must keep
# passing with zero app source in the tree.
#
# Run from anywhere inside the repo. Exit 0 = scaffolding intact,
# exit 1 = a problem was found (every failure is printed before exiting).
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"
fail=0

fail() { echo "FAIL: $*"; fail=1; }
ok()   { echo "ok:   $*"; }

# --- 1. The CLAUDE.md shim is intact -----------------------------------------
# Reuse the dedicated guard rather than re-encoding its five invariants here
# (single source of truth: scripts/check-claude-shim.sh).
if bash "$root/scripts/check-claude-shim.sh" >/dev/null 2>&1; then
  ok "check-claude-shim.sh passes (CLAUDE.md is an intact @AGENTS.md shim)"
else
  fail "check-claude-shim.sh failed — run it directly to see why"
fi

# --- 2. Required scaffolding paths exist -------------------------------------
# These are the load-bearing process files a cold-start agent reads, plus the
# template machinery itself. Every entry here exists in the seed today; a
# missing one means scaffolding regressed.
required_paths=(
  "AGENTS.md"
  "CLAUDE.md"
  "INSTANCE.md"
  "DESIGN.md"
  "README.md"
  "SECURITY.md"
  "GAPS.md"
  "START_HERE.md"
  "LICENSE"
  ".github/PULL_REQUEST_TEMPLATE.md"
  ".github/CODEOWNERS"
  ".github/workflows/scaffolding.yml"
  ".mergify.yml"
  ".seed/placeholders.json"
  "scripts/check-claude-shim.sh"
  "scripts/validate-scaffolding.sh"
  "scripts/fill-template.sh"
  "docs/optional/README.md"
  "docs/optional/figma.md"
  "docs/optional/mergify.md"
  "docs/optional/review-bot.md"
  "docs/optional/user-skills.md"
  ".claude/agents/README.md"
  ".claude/skills/pr-workflow/SKILL.md"
  ".claude/skills/creating-prs/SKILL.md"
  ".claude/skills/reviewing/SKILL.md"
  ".claude/skills/issue-authoring/SKILL.md"
  ".claude/skills/issue-plan-review/SKILL.md"
  ".claude/skills/project-bootstrap/SKILL.md"
)
for p in "${required_paths[@]}"; do
  if [ -e "$p" ]; then
    ok "present: $p"
  else
    fail "missing required scaffolding path: $p"
  fi
done

# --- 3. Multi-tool adapter pointer files are present AND non-empty -----------
# The adapters are pointer-only files; an empty pointer is worse than none (it
# looks wired but says nothing). Treat empty as a failure.
adapter_paths=(
  "GEMINI.md"
  ".github/copilot-instructions.md"
  ".cursor/rules/review-dispatch.mdc"
)
for p in "${adapter_paths[@]}"; do
  if [ ! -e "$p" ]; then
    fail "missing adapter pointer file: $p"
  elif [ ! -s "$p" ]; then
    fail "adapter pointer file is empty: $p"
  else
    ok "non-empty adapter: $p"
  fi
done

# --- 4. Template integrity: every {{PLACEHOLDER}} token is DECLARED ----------
# Every {{KEY}} that appears anywhere in the tree must be declared in
# .seed/placeholders.json — either as a fillable placeholder (placeholders.*),
# a derived alias (derived.*), or a documentation meta-token (meta.literal —
# e.g. {{KEY}}, {{PLACEHOLDER}}, {{PLACEHOLDERS}}, which describe the mechanism
# itself and survive a fill). An UNDECLARED token is a template-integrity
# failure: fill-template.sh would leave it stranded, and it signals a typo or a
# placeholder someone forgot to declare. The glossary file is excluded from the
# token scan (it declares the names; .seed/ is excluded wholesale). This is the
# check that lets the validator PASS on the unfilled template — placeholders are
# legitimate here, as long as each is declared. The whole thing runs in one
# python3 pass (available on CI's ubuntu-latest) to stay flavor-agnostic across
# the many incompatible `grep`/`mapfile` behaviours on developer machines.
glossary=".seed/placeholders.json"
if [ ! -f "$glossary" ]; then
  fail "missing $glossary — cannot check template integrity"
else
  if integrity_out="$(GLOSSARY="$glossary" python3 - <<'PY'
import json, os, re, subprocess, sys

glossary_path = os.environ["GLOSSARY"]
g = json.load(open(glossary_path, encoding="utf-8"))
declared = set(g.get("placeholders", {}))
declared |= set(g.get("derived", {}))
declared |= set(g.get("meta", {}).get("literal", []))

EXCLUDE_DIRS = (".git", ".seed", "tmp", ".remember")
def excluded(path):
    return any(part in EXCLUDE_DIRS for part in os.path.normpath(path).split(os.sep))

# Prefer tracked files; fall back to a tree walk for a pre-commit checkout.
try:
    out = subprocess.run(["git", "ls-files", "-z"], capture_output=True, check=True).stdout
    files = [p.decode("utf-8", "surrogateescape") for p in out.split(b"\x00") if p]
except (subprocess.CalledProcessError, FileNotFoundError):
    files = []
if not files:
    files = []
    for dp, dns, fns in os.walk("."):
        dns[:] = [d for d in dns if d not in EXCLUDE_DIRS]
        files += [os.path.join(dp, f) for f in fns]

token_re = re.compile(r"\{\{([A-Za-z_]+)\}\}")
undeclared = {}  # token -> sorted list of files it appears in
for path in files:
    if excluded(path) or not os.path.isfile(path):
        continue
    try:
        data = open(path, "rb").read()
    except OSError:
        continue
    if b"\x00" in data:           # binary
        continue
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        continue
    for tok in {m.group(1) for m in token_re.finditer(text)}:
        if tok not in declared:
            undeclared.setdefault(tok, []).append(path)

if undeclared:
    for tok in sorted(undeclared):
        where = ", ".join(sorted(undeclared[tok])[:3])
        print(f"UNDECLARED\t{tok}\t{where}")
    sys.exit(1)
sys.exit(0)
PY
  )"; then
    ok "template integrity: every {{PLACEHOLDER}} used in the tree is declared in $glossary"
  else
    while IFS=$'\t' read -r marker tok where; do
      [ "$marker" = "UNDECLARED" ] || continue
      fail "undeclared placeholder {{$tok}} used in the tree but not declared in $glossary (e.g. $where)"
    done <<<"$integrity_out"
  fi
fi

# --- Result ------------------------------------------------------------------
if [ "$fail" -eq 0 ]; then
  echo "PASS: scaffolding invariants hold."
else
  echo "FAILED: fix the items marked FAIL above."
  exit 1
fi
