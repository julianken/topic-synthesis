# Optional module — Figma design system (agent-synced source of truth)

**Optional.** This module is enabled by setting `FIGMA_FILE_ID` (a blank value disables it). When enabled, the product's design system lives in a Figma file that agents both **read AND write** over the Figma MCP, keeping it in **lockstep** with the shipped UI. A template consumer whose design source of truth isn't Figma can skip this entirely — the design source of truth is then [`DESIGN.md`](../../DESIGN.md), which **wins on any design conflict** regardless of whether Figma is in the picture.

This doc is the *adopt-or-skip* narrative. It is **not** the source of truth for *this product's* Figma file ID or node map: those are instance facts in [`INSTANCE.md`](../../INSTANCE.md) → "Design / Figma (source of truth, agent-synced)". Don't restate the file key or node-ids here — point at `INSTANCE.md`, which is where they're maintained (and which the Update Triggers table keeps current when frames are renamed or reordered).

## How Figma is used here

- **Agent-synced (read AND write).** Agents read the Figma file via the MCP read tools (`get_metadata`, `get_design_context`, `get_screenshot`, `get_variable_defs`, `get_code_connect_map`, `get_libraries`, `search_design_system`, `whoami`) **and write it** via the write tools (`use_figma`, `create_new_file`, `generate_figma_design`, `upload_assets`, `add_code_connect_map`) to keep it in lockstep with the shipped build. **Any frontend change keeps the matching frame(s) in lockstep, agent-authored** — for an issue-driven change the frame is authored/updated at the **issue stage** (design-first, pre-code-gated, referenced in the issue body) and the build PR implements to it, reconciling Figma only if the build diverges; an issue-less PR authors the frame in that same PR. The prior read-only / human-only-edits rule is RETIRED (it caused the file to silently drift out of sync with the build). See AGENTS.md → "Design source of truth" + the Update-Triggers Figma row.
- **Authority on conflict: shipped build > `DESIGN.md` > Figma.** Figma is the *visual* source of truth and is kept in lockstep, but only `DESIGN.md` §0 is CI-guarded against the code, so on a genuine *value* disagreement the build then `DESIGN.md` still win: a Figma value that disagrees with `DESIGN.md` is drift to reconcile into `DESIGN.md` §0 (and back into Figma) in a PR. Never build straight from a live Figma node, and never paste its raw hexes/Tailwind — translate to `DESIGN.md` tokens. The ranking only breaks a momentary tie; the lockstep duty (above) is what keeps the two from drifting apart — an agent authors them at the issue stage and the PR reconciles on divergence, so they no longer "do not auto-sync."
- **Flow:** for a known node call `get_design_context` directly; for a large/unknown subtree call `get_metadata(<node>)` first to scope, then `get_design_context`; use `get_screenshot` for visual reference. A URL's `?node-id=<n-n>` is the tool's `nodeId: <n:n>` (hyphen → colon).

The file ID, the page/screen node map, and the MCP quirks specific to *this* file are catalogued in [`INSTANCE.md`](../../INSTANCE.md).

## Plan limits (this file, today)

Live **Variable reads do resolve** on this file (`get_variable_defs` returns the §0 tokens on nodes that bind them — the captured-screenshot frames bind none and return `{}`). Code Connect is unused. Per the authority ranking, still treat Figma as **visual reference, not a token feed**: the tokens are canonical in `DESIGN.md`, and a disagreeing Figma value is reconciled into §0, never built from. The `get_metadata`-with-no-node-id quirk (it lists only the **first page**, not all pages) means you always pass an explicit node-id from the `INSTANCE.md` node map.

## Adopt

1. Record your Figma file ID and node map in `INSTANCE.md` → "Design / Figma (source of truth, agent-synced)" (the instance source of truth — not in this doc).
2. Connect the Figma MCP and confirm the **read tools** resolve (`whoami`, then `get_metadata` against a known node-id).
3. Keep the **agent-sync rule** (the issue authors the frame design-first for an issue-driven frontend change and the PR reconciles it on divergence; an issue-less frontend PR authors the frame in that same PR — via the MCP write tools) and the `build > DESIGN.md > Figma` *conflict* ranking — together they keep Figma in **lockstep** with the build while preventing a live Figma value from silently overriding the shipped design.
4. Add the node-map-drift row to the Update Triggers table so node-ids stay current (this repo already has it).

## Skip

If your design source of truth isn't Figma, remove the "Design / Figma" section from `INSTANCE.md` and don't connect the Figma MCP. `DESIGN.md` remains the design source of truth on its own — nothing in the core process depends on Figma being present.
