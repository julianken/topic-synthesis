import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// The project directory. Pin it as BOTH the file-tracing root and the Turbopack root (below) so the
// standalone output layout is DETERMINISTIC: `server.js` + `.next/static` land at the standalone tree
// ROOT (`.next/standalone/server.js`), not nested under a workspace-relative path. Without this, Next
// INFERS the workspace root from the nearest lockfile — and when this repo is checked out as a linked
// git WORKTREE under another checkout (a second `package-lock.json` higher up), it picks that outer
// root and nests `server.js` under the worktree-relative path, so the e2e `webServer` (which serves
// `node .next/standalone/server.js`, the Cloud Run entrypoint) can't find it. Docker (`COPY . .` into
// `/app`, one lockfile) and CI (single checkout) already infer the flat layout; pinning makes the
// nested-worktree dev case match them. See playwright.config.ts `webServer`.
const projectRoot = fileURLToPath(new URL('.', import.meta.url));

// Cross-origin CSP for generated artifacts is set per-response in the artifact
// route handler (see the walking-skeleton plan) so the sandbox is enforced at
// the exact surface that serves untrusted generated HTML — not globally here.
const nextConfig: NextConfig = {
  // Standalone output → a lean Cloud Run Service image: `.next/standalone/server.js` + only the
  // traced node_modules (no full install at runtime). See docs/decisions/0001 §1.
  output: 'standalone',
  // Pin the standalone trace root to the project dir (see `projectRoot` above) — deterministic layout.
  outputFileTracingRoot: projectRoot,
  // Pin the Turbopack root too (same dir) — silences the "inferred workspace root may be incorrect /
  // detected multiple lockfiles" build warning that the worktree layout triggers.
  turbopack: { root: projectRoot },
  // `pg` is a Node-only driver (optional native bindings); keep it external so the App Router
  // bundler doesn't trace it into a route/serverless bundle. Route handlers + server components
  // require it at runtime (the store reads Postgres). See docs/decisions/0001 §1.
  serverExternalPackages: ['pg'],
};

export default nextConfig;
