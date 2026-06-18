# Optional module — Figma design system (read-only MCP)

**Optional.** This module is enabled by setting `{{FIGMA_FILE_ID}}` (a blank value disables it). When enabled, the product's design system lives in a Figma file, read by agents over the Figma MCP. A template consumer whose design source of truth isn't Figma can skip this entirely — the design source of truth is [`DESIGN.md`](../../DESIGN.md), which **wins on any design conflict** regardless of whether Figma is in the picture.

This doc is the *adopt-or-skip* narrative. It is **not** the source of truth for *this product's* Figma file ID or node map: those are instance facts in [`INSTANCE.md`](../../INSTANCE.md) → "Design / Figma (read-only)". Don't restate the file key or node-ids here — point at `INSTANCE.md`, which is where they're maintained (and which the Update Triggers table keeps current when frames are renamed or reordered).

## How Figma is used here

- **Read-only.** Agents read the Figma file via the MCP **read tools only** (`get_metadata`, `get_design_context`, `get_screenshot`, `get_variable_defs`, `get_code_connect_map`, `get_libraries`, `search_design_system`, `whoami`). Agents **never** call a write tool (`use_figma`, `create_new_file`, `generate_figma_design`, `generate_diagram`, `upload_assets`, `add_code_connect_map`) — a human edits the design; agents only read it.
- **Authority ranking: shipped build > `DESIGN.md` > Figma.** A live Figma value that disagrees with `DESIGN.md` does **not** bind the build — it's *drift to reconcile into `DESIGN.md` §0 in a PR*. Never build straight from a live Figma node, and never paste its raw hexes/Tailwind: translate to `DESIGN.md` tokens. The two do not auto-sync.
- **Flow:** for a known node call `get_design_context` directly; for a large/unknown subtree call `get_metadata(<node>)` first to scope, then `get_design_context`; use `get_screenshot` for visual reference. A URL's `?node-id=<n-n>` is the tool's `nodeId: <n:n>` (hyphen → colon).

The file ID, the page/screen node map, and the MCP quirks specific to *this* file are catalogued in [`INSTANCE.md`](../../INSTANCE.md).

## Plan limits (this file, today)

On the current Figma plan, **live Variable reads and Code Connect are unavailable** (`get_variable_defs` returns `{}`). Treat Figma as **visual reference, not a token feed** — the tokens come from `DESIGN.md`, not an MCP variable read. The `get_metadata`-with-no-node-id quirk (it lists only the Cover) means you always pass an explicit node-id from the `INSTANCE.md` node map.

## Adopt

1. Record your Figma file ID and node map in `INSTANCE.md` → "Design / Figma (read-only)" (the instance source of truth — not in this doc).
2. Connect the Figma MCP and confirm the **read tools** resolve (`whoami`, then `get_metadata` against a known node-id).
3. Keep the read-only / write-tool-forbidden rule and the `build > DESIGN.md > Figma` authority ranking — they're what keep Figma from silently overriding the shipped design.
4. Add the node-map-drift row to the Update Triggers table so node-ids stay current (this repo already has it).

## Skip

If your design source of truth isn't Figma, remove the "Design / Figma" section from `INSTANCE.md` and don't connect the Figma MCP. `DESIGN.md` remains the design source of truth on its own — nothing in the core process depends on Figma being present.
