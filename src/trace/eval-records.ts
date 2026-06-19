/**
 * Local mirror of the `@eleatic/eval` record contracts (which are documentation-only types in
 * the package). Re-declared here ON PURPOSE so `span.ts` and `reduce.ts` import NOTHING from
 * `@eleatic/eval` — the import fence (config/dependency-cruiser.mjs → `eleatic-only-in-trace`)
 * confines the package's heavy better-sqlite3/express deps to the single adapter file, and
 * because `tsPreCompilationDeps: true` even an `import type` would trip the rule.
 *
 * These are structurally compatible with the package's own interfaces, so `eleatic-adapter.ts`
 * passes objects of these types straight to the store methods.
 */

/** One node in the trace tree (keyed by `id`; `parentId: null` = a root). Mirrors EvalSpan. */
export interface EvalSpan {
  id: string;
  parentId: string | null;
  name: string;
  /** Free-form, producer-owned styling hint (eleatic styles by it, never branches on it). */
  kind?: string;
  input?: unknown;
  output?: unknown;
  /** camelCase metrics; we emit cost + tokens — never startMs/durationMs (records have no clock). */
  metrics?: {
    startMs?: number;
    durationMs?: number;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    costUsd?: number;
  };
  scores?: Record<string, number>;
  status?: string;
}

/** The `{ spans }` envelope a row's `trace` blob conventionally holds. Mirrors EvalTrace. */
export interface EvalTrace {
  spans: EvalSpan[];
}

/** One eval run (= one generation invocation). Mirrors EvalRunRecord. */
export interface EvalRunRecord {
  id: string;
  label: string;
  baseline?: string;
  config?: Record<string, unknown>;
  startedAt: string;
  rowCount?: number;
  metrics?: Record<string, number>;
}

/** One evaluated item (= one curriculum page, or the run-level analysis phase). Mirrors EvalRowRecord. */
export interface EvalRowRecord {
  runId: string;
  rowKey: string;
  label?: string;
  contentHash?: string;
  output: unknown;
  expected: unknown;
  scores?: Record<string, number>;
  metadata?: Record<string, string | number | boolean>;
  trace?: unknown;
}
