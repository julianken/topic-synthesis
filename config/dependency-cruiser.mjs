/**
 * Import fence — the decoupling guard from docs/decisions/0001 §4, run in CI.
 *
 * The business-logic layers must never import the frontend, so the core stays a Next-free
 * deployable (a Cloud Run Job image). dependency-cruiser matches `to.path` against a
 * dependency's RESOLVED path, so external packages are matched under `node_modules/<pkg>/`;
 * `tsPreCompilationDeps: true` makes type-only edges visible too, so even a stray
 * `import type { … } from 'react'` in the core is caught.
 *
 * Scope note: this is the ONE rule ADR §4 specifies. App-side boundary rules (e.g. forbidding
 * `src/app` from value-importing the pipeline once the deployed Cloud Run Job model replaces
 * in-process generation) are deferred — see GAPS.md. They are NOT added now because the lean
 * e2e legitimately imports the store + pipeline from `src/app` server components / route
 * handlers, so a blanket `src/app` boundary would be wrong today.
 *
 * @type {import('dependency-cruiser').IConfiguration}
 */
export default {
  forbidden: [
    {
      name: 'core-no-frontend',
      comment:
        'Business-logic layers (domain/llm/pipeline/engine/store/eval) must NOT import the ' +
        'frontend. Keeps the core a Next-free deployable (a Cloud Run Job image), per ADR 0001 §4. ' +
        'Starts green — the decoupling audit found zero such imports.',
      severity: 'error',
      from: { path: '^src/(domain|llm|pipeline|engine|store|eval|trace)/' },
      to: { path: 'node_modules/(next|react-dom|react|server-only|client-only)(/|$)' },
    },
    {
      name: 'eleatic-only-in-trace',
      comment:
        'Only src/trace/eleatic-adapter.ts may import @eleatic/eval — its better-sqlite3 + express ' +
        'transitive deps must stay OUT of the Next app bundle (ADR 0001 §4). span.ts/reduce.ts ' +
        're-declare the record shapes locally (src/trace/eval-records.ts) and import nothing from the ' +
        'package; tsPreCompilationDeps:true means even an `import type` here would be caught.',
      severity: 'error',
      from: { path: '^src/', pathNot: '^src/trace/eleatic-adapter\\.ts$' },
      to: { path: 'node_modules/@eleatic/eval(/|$)' },
    },
    {
      name: 'firebase-admin-only-in-auth-adapter',
      comment:
        'Only src/app/auth/gcp-auth-provider.ts may import firebase-admin (the server Admin SDK) — its ' +
        'gRPC/credential transitive deps stay confined to the one adapter, mirroring eleatic-only-in-trace ' +
        '(ADR 0002 §3). The firebase CLIENT SDK (firebase/auth) is browser code the sign-in UI imports and ' +
        'is intentionally NOT confined here.',
      severity: 'error',
      from: { path: '^src/', pathNot: '^src/app/auth/gcp-auth-provider\\.ts$' },
      // Match BOTH forms: a bare `firebase-admin` resolves to node_modules/firebase-admin/…, but a
      // modular subpath `firebase-admin/auth` (the form the adapter actually uses) is left by
      // dependency-cruiser as the bare string `firebase-admin/auth` — the `^` branch catches it.
      to: { path: '(^|node_modules/)firebase-admin(/|$)' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
  },
};
