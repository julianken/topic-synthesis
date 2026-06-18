# DESIGN.md — {{PROJECT_NAME}}

> **This file is the whole truth for design.** An agent that has never opened this app must be able to rebuild any surface to pixel fidelity from this document alone — no design file, no component browser, no follow-up questions. Every value here is concrete and current. Where this file and the working build disagree, the build wins; reconcile this file to match it.
>
> **Authority:** shipped build > `DESIGN.md` > Figma (see AGENTS.md → "Design source of truth"). `DESIGN.md` wins on any design conflict with Figma. If the product has a Figma file ({{FIGMA_FILE_ID}}), it is *visual reference only* — a live Figma value that disagrees with this file is drift to reconcile here in a PR, not a source the build follows directly.

This is a **blank stub**. Fill each section per product. Keep raw literals (hexes, sizes, durations) in the token manifest (§0) only; reference them by name everywhere else so there is one place to change a value.

---

## 0. Token Manifest

*Fill per product.* The authoritative source of truth for every value — colors, spacing, type sizes, radii, motion durations. Prefer a tiered scheme (primitive → semantic → component) so recoloring touches one primitive and flows down. Reference tokens by name in the prose below; never repeat a raw literal outside this section.

## Color & contrast

*Fill per product.* The palette (by token), the background/foreground roles, and the measured contrast ratios that meet the product's accessibility target.

## Typography

*Fill per product.* Type families, the size/weight/line-height scale (by token), and where each role is used.

## Motion

*Fill per product.* Durations, easing curves, and which transitions are allowed — plus the reduced-motion behavior.

## Components

*Fill per product.* Each component's anatomy, states, and the tokens it consumes.

## Accessibility

*Fill per product.* Contrast target, focus-visible treatment, keyboard model, reduced-motion handling, and any product-specific correctness rules the design depends on.
