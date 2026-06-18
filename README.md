# Topic Synthesis

Generate interactive, scaffolded learning curricula from a topic.

You enter a topic + settings; a multi-agent **ANALYSIS → SYNTHESIS** workflow researches the topic, builds a prerequisite knowledge graph, and generates a tiered curriculum of standalone, interactive HTML/Canvas/SVG/JS concept pages — modeled on hand-built explorable explanations.

## Status

**Building the walking skeleton (sub-project 1).** Bootstrapped from the [`agentic-seed`](https://github.com/julianken/agentic-seed) template; the project foundation (Next.js app, Postgres schema, Docker infra, domain layer) has landed. See [`docs/plans/`](./docs/plans/) for the implementation plan and [`docs/research/`](./docs/research/) for the discovery + platform research that grounds it.

## How it works (target architecture)

- **Pipeline:** Planner → Researchers (grounded) → Graph-builder (prerequisite DAG) → grounding/coverage gate → per-node spec → code → critic → hub assembler, behind a pluggable `Engine` seam (in-process locally; a durable Postgres-backed engine on a Cloud Run Job in the cloud).
- **Eval & observability:** offline evals + trace inspection via [`@eleatic/eval`](https://github.com/julianken/eleatic), a co-developed sibling toolkit; production telemetry + experiments are a later sub-project.
- **Foundation:** the reviewed-PR process, design source-of-truth, and CI come from the `agentic-seed` template — see [`AGENTS.md`](./AGENTS.md), [`INSTANCE.md`](./INSTANCE.md), and [`DESIGN.md`](./DESIGN.md).

## Repository

Built largely by AI coding agents through reviewed, squash-merged PRs. Process and conventions live in [`AGENTS.md`](./AGENTS.md).

## Develop

```sh
cp .env.example .env        # adjust if needed
docker compose up -d        # Postgres + Redis
npm install
npm run db:migrate          # apply src/store/schema.sql
npm run typecheck && npm test
npm run dev                 # http://localhost:3000
```

Node ≥ 20. Full command list + module layout in [`AGENTS.md`](./AGENTS.md) → "Working in the tree".

## License

MIT — see [`LICENSE`](./LICENSE).
