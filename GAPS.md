# GAPS.md

A ledger of repo / agent-setup capabilities **deliberately not built yet**, each with the trigger that should wake it. A fresh template instance is typically pre-code, solo, and client-side, so most tooling a mature repo carries would have nothing to act on yet — no dependency graph to scan, no UI to guard, no deadline to age against. This file records *why* each deferred thing is absent and *what* should bring it back, so a deferred item resurfaces when its trigger fires instead of being silently forgotten or re-litigated.

Scope: the repo's tooling, CI, agents, skills, and process scaffolding. Not a product backlog — features/tools live in issues and [`DESIGN.md`](DESIGN.md), not here.

This file is itself drift-prone, so it sits in the [`AGENTS.md`](AGENTS.md) "Keeping docs and drift-prone files current" Update Triggers logic: when a process or roadmap change fires or retires one of the triggers below, reconcile this file in the same PR. A row whose trigger has already fired but is still parked under "Deferred" is a finding — raise it the way that section says (a non-blocking IMPORTANT note, never a merge blocker). Don't restate `AGENTS.md`, `DESIGN.md`, or `SECURITY.md` here; cross-reference them.

How to use a row: each is `Item | Trigger that should wake it | Why deferred`. Add a row when you consciously skip a capability that a future state will need; strike it through and annotate **WOKEN** (with a date) when its trigger fires and you build the thing in the same PR; delete it only once the woken note has outlived its usefulness.

---

## Deferred (build when the trigger fires)

The ledger starts **empty for a fresh instance** — there is no inherited backlog to carry. Populate it as you make deliberate deferral decisions for *this* product (e.g. dependency-hygiene tooling once a `package.json` and lockfile land, a commit-gated lint hook once there is shipping code, additional repo agents/skills once they exist). Until then there is nothing parked here.

| Item | Trigger that should wake it | Why deferred |
| --- | --- | --- |
| _(none yet)_ | — | Fresh instance: no capability has been consciously deferred yet. Add the first row when you skip something a future state will need. |
