import type { NextConfig } from 'next';

// Cross-origin CSP for generated artifacts is set per-response in the artifact
// route handler (see the walking-skeleton plan) so the sandbox is enforced at
// the exact surface that serves untrusted generated HTML — not globally here.
const nextConfig: NextConfig = {};

export default nextConfig;
