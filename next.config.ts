import type { NextConfig } from 'next';

// Cross-origin CSP for generated artifacts is set per-response in the artifact
// route handler (see the walking-skeleton plan) so the sandbox is enforced at
// the exact surface that serves untrusted generated HTML — not globally here.
const nextConfig: NextConfig = {
  // `pg` is a Node-only driver (optional native bindings); keep it external so the App Router
  // bundler doesn't trace it into a route/serverless bundle. Route handlers + server components
  // require it at runtime (the store reads Postgres). See docs/decisions/0001 §1.
  serverExternalPackages: ['pg'],
};

export default nextConfig;
