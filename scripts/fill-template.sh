#!/usr/bin/env bash
# Fill the agentic-seed template: substitute every {{PLACEHOLDER}} across the
# repo's text files with concrete values, turning the unfilled scaffold into a
# real product's instance.
#
# Reads the placeholder glossary from .seed/placeholders.json (the authoritative
# declaration of every fillable token) and the values from .seed/answers.json
# (a flat {"KEY": "value", ...} map — copy .seed/answers.example.json to start).
# If .seed/answers.json is absent it prints exactly which placeholders it needs
# and exits non-zero — it never guesses a value.
#
# Substitution covers tracked TEXT files, EXCLUDING .git/, .seed/, tmp/, and
# .remember/ (the glossary, the answers, and scratch state must never be
# rewritten). Documentation meta-tokens (placeholders.meta.literal in the
# glossary — e.g. {{KEY}}, {{PLACEHOLDER}}, {{PLACEHOLDERS}}) describe the
# template mechanism itself and are deliberately left intact.
#
# After substituting it FAILS if any required (non-optional) placeholder was
# unset, or if any {{...}} token (other than the declared meta-tokens) survives.
# Optional placeholders (placeholders.*.optional == true) left blank are blanked
# in place WITH A WARNING, so the OPTIONAL sections they gate become deletable.
#
# Run from anywhere inside the repo. Exit 0 = filled and verified clean,
# exit 1 = a problem was found (printed before exiting). This is for the
# UNFILLED template only — re-running on a filled instance has nothing to
# substitute and risks clobbering domain content (run validate mode instead).
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"

glossary=".seed/placeholders.json"
answers=".seed/answers.json"

if [ ! -f "$glossary" ]; then
  echo "FAIL: $glossary not found — this does not look like an agentic-seed template." >&2
  exit 1
fi

# --- Do the parse + substitution + verification in one Python pass ---------
# python3 is guaranteed available; doing it all in one process keeps the JSON
# logic, file enumeration, binary detection, substitution, and the "no token
# left behind" check consistent. (NUL-delimited file lists can't round-trip
# through a bash $(...) capture — it strips NULs — so Python enumerates directly.)
GLOSSARY="$glossary" ANSWERS="$answers" python3 - <<'PY'
import json, os, re, subprocess, sys

glossary_path = os.environ["GLOSSARY"]
answers_path  = os.environ["ANSWERS"]

with open(glossary_path, encoding="utf-8") as fh:
    glossary = json.load(fh)

placeholders = glossary.get("placeholders", {})
meta_literals = set(glossary.get("meta", {}).get("literal", []))

required = [k for k, v in placeholders.items() if not v.get("optional", False)]
optional = [k for k, v in placeholders.items() if v.get("optional", False)]

# --- Load answers, or explain what's needed and bail -----------------------
if not os.path.isfile(answers_path):
    print(f"FAIL: {answers_path} not found — fill cannot proceed without values.", file=sys.stderr)
    print("Provide a flat JSON map of placeholder values. Required keys:", file=sys.stderr)
    for k in required:
        print(f"  - {k}: {placeholders[k].get('description','')}", file=sys.stderr)
    if optional:
        print("Optional keys (leave \"\" to disable the module they gate):", file=sys.stderr)
        for k in optional:
            print(f"  - {k}: {placeholders[k].get('description','')}", file=sys.stderr)
    print(f"\nStart from the example: cp .seed/answers.example.json {answers_path}", file=sys.stderr)
    sys.exit(1)

with open(answers_path, encoding="utf-8") as fh:
    answers = json.load(fh)
# Drop comment/underscore keys; coerce values to strings.
answers = {k: ("" if v is None else str(v)) for k, v in answers.items() if not k.startswith("_")}

# --- Validate the answer set against the glossary --------------------------
missing_required = [k for k in required if k not in answers or answers[k] == ""]
if missing_required:
    print("FAIL: required placeholder(s) unset or blank in answers:", file=sys.stderr)
    for k in missing_required:
        print(f"  - {k}: {placeholders[k].get('description','')}", file=sys.stderr)
    sys.exit(1)

unknown = [k for k in answers if k not in placeholders]
if unknown:
    # Not fatal, but worth flagging — a typo'd key would silently do nothing.
    print(f"WARN: answers contain key(s) not declared in {glossary_path}: {', '.join(sorted(unknown))}", file=sys.stderr)

# Warn on blanked optional placeholders (their gated OPTIONAL sections are now deletable).
for k in optional:
    if k not in answers or answers[k] == "":
        answers.setdefault(k, "")
        # Build the brace-wrapped name by concatenation (not f-string brace
        # escaping) so this source carries no literal double-brace token the
        # integrity scanner would read as an undeclared placeholder.
        brace = "{{" + k + "}}"
        print(f"WARN: optional placeholder {brace} left blank — its OPTIONAL module/section "
              f"is disabled and can be deleted (see INSTANCE.md).", file=sys.stderr)

# Substitution map covers exactly the declared placeholders. Meta-tokens are
# intentionally NOT in this map, so they pass through untouched.
subs = {k: answers.get(k, "") for k in placeholders}

token_re = re.compile(r"\{\{([A-Z_]+)\}\}")
def substitute(text):
    return token_re.sub(lambda m: subs[m.group(1)] if m.group(1) in subs else m.group(0), text)

# --- Enumerate files to substitute over ------------------------------------
# Prefer git-tracked files; fall back to a working-tree walk when the repo has
# no commits yet (a fresh 'Use this template' checkout can be pre-commit).
EXCLUDE_DIRS = (".git", ".seed", "tmp", ".remember")

def excluded(path):
    parts = os.path.normpath(path).split(os.sep)
    return any(part in EXCLUDE_DIRS for part in parts)

def enumerate_files():
    try:
        out = subprocess.run(["git", "ls-files", "-z"], capture_output=True, check=True).stdout
        tracked = [p.decode("utf-8", "surrogateescape") for p in out.split(b"\x00") if p]
    except (subprocess.CalledProcessError, FileNotFoundError):
        tracked = []
    if tracked:
        return tracked
    walked = []
    for dirpath, dirnames, filenames in os.walk("."):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
        for name in filenames:
            walked.append(os.path.join(dirpath, name))
    return walked

paths = enumerate_files()

changed = 0
scanned = 0
leftover = {}  # path -> sorted set of surviving {{...}} tokens

for path in paths:
    if excluded(path) or not os.path.isfile(path):
        continue
    with open(path, "rb") as fh:
        data = fh.read()
    if b"\x00" in data:        # binary — skip
        continue
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:  # not UTF-8 text — skip
        continue
    scanned += 1

    new_text = substitute(text)
    if new_text != text:
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(new_text)
        changed += 1

    # Verify: any placeholder token that survives and is NOT a declared meta-literal is a failure.
    survivors = sorted({m.group(1) for m in token_re.finditer(new_text)} - meta_literals)
    if survivors:
        leftover[path] = survivors

print(f"Filled {changed} file(s) (scanned {scanned} text file(s)).")

if leftover:
    print("FAIL: unsubstituted placeholder token(s) remain after fill:", file=sys.stderr)
    for path in sorted(leftover):
        for tok in leftover[path]:
            declared = "declared but unset?" if tok in placeholders else "UNDECLARED — add it to placeholders.json"
            brace = "{{" + tok + "}}"
            print(f"  - {path}: {brace}  ({declared})", file=sys.stderr)
    sys.exit(1)

print("OK: every declared placeholder substituted; no stray tokens remain.")
print("Next: replace README.md, fill DESIGN.md, delete the OPTIONAL INSTANCE.md "
      "sections whose placeholder you left blank, then run "
      "scripts/check-claude-shim.sh and scripts/validate-scaffolding.sh.")
PY
