# Topic Synthesis

Generate interactive, scaffolded learning curricula from a topic.

You enter a topic + settings; a multi-agent **ANALYSIS → SYNTHESIS** workflow researches the topic, builds a prerequisite knowledge graph, and generates a tiered curriculum of standalone, interactive HTML/Canvas/SVG/JS concept pages — modeled on hand-built explorable explanations.

## Status

**Pre-code — building the walking skeleton (sub-project 1).** This repo was just bootstrapped from the [`agentic-seed`](https://github.com/julianken/agentic-seed) template. See [`docs/plans/`](./docs/plans/) for the implementation plan and [`docs/research/`](./docs/research/) for the discovery + platform research that grounds it. No build/test commands exist yet — they'll be documented in [`AGENTS.md`](./AGENTS.md) as they land.

## How it works (target architecture)

- **Pipeline:** Planner → Researchers (grounded) → Graph-builder (prerequisite DAG) → grounding/coverage gate → per-node spec → code → critic → hub assembler, on a durable **Trigger.dev** workflow.
- **Eval & observability:** offline evals + trace inspection via [`@eleatic/eval`](https://github.com/julianken/eleatic), a co-developed sibling toolkit; production telemetry + experiments are a later sub-project.
- **Foundation:** the reviewed-PR process, design source-of-truth, and CI come from the `agentic-seed` template — see [`AGENTS.md`](./AGENTS.md), [`INSTANCE.md`](./INSTANCE.md), and [`DESIGN.md`](./DESIGN.md).

## Repository

Built largely by AI coding agents through reviewed, squash-merged PRs. Process and conventions live in [`AGENTS.md`](./AGENTS.md).

## License

MIT — see [`LICENSE`](./LICENSE).
