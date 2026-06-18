/**
 * Import fence — the decoupling guard from docs/decisions/0001 §4, run in CI.
 *
 * dependency-cruiser matches `to.path` against a dependency's RESOLVED path, so external
 * packages are matched under `node_modules/<pkg>/`. `tsPreCompilationDeps: true` makes
 * `import type` edges visible so `dependencyTypesNot: ['type-only']` can allow a type-only
 * import while forbidding a value import of the same module.
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
      from: { path: '^src/(domain|llm|pipeline|engine|store|eval)/' },
      to: { path: 'node_modules/(next|react-dom|react|server-only|client-only)(/|$)' },
    },
    {
      name: 'app-no-value-import-of-trigger',
      comment:
        'src/app may only TYPE-import a workflow task (the type-only trigger seam); a value ' +
        'import would drag the task graph into the Next bundle. Inert until src/trigger lands.',
      severity: 'error',
      from: { path: '^src/app/' },
      to: { path: '^src/trigger/', dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'app-no-value-import-of-store-or-pg',
      comment:
        'src/app must not value-import the store or pg directly (server-only Node modules) — go ' +
        'through a route handler / type-only import. Inert until src/app/api lands.',
      severity: 'error',
      from: { path: '^src/app/' },
      to: { path: '(^src/store/|node_modules/pg(/|$))', dependencyTypesNot: ['type-only'] },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
  },
};
