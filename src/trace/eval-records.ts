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
  /**
   * camelCase metrics. By DEFAULT we emit only cost + tokens (the historical wall-clock-free shape).
   * The OPT-IN `--trace-timing` path (issue #179) ALSO emits per-call wall-clock for the streamed
   * `code` call: `durationMs` (= ttftMs + genMs) lights up eleatic's NATIVE duration column, while
   * `ttftMs`/`genMs`/`tokensPerSec`/`outputBytes`/`maxTokens` ride as ADDITIVE metric keys (carried
   * on the span — whether `serve` renders them as extra columns is up to eleatic's UI; their absence
   * from the table is NOT a bug). `startMs` stays unused (records carry no absolute clock). All
   * additive: with the flag off the metrics object is byte-identical to before.
   */
  metrics?: {
    startMs?: number;
    durationMs?: number;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    costUsd?: number;
    /** Per-call wall-clock + size, emitted ONLY under `--trace-timing` for the streamed `code` call. */
    ttftMs?: number;
    genMs?: number;
    tokensPerSec?: number;
    outputBytes?: number;
    maxTokens?: number;
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
  /** Another run's id this run is paired against — eleatic compares the two arms (set from
   *  `--baseline` via `TraceMeta.baseline`; issue #51). Omitted, never `undefined`, when unset. */
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
