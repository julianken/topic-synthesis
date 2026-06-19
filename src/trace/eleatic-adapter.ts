import { openStore } from '@eleatic/eval';
import type { EvalRowRecord, EvalRunRecord } from './eval-records';

/**
 * THE ONLY `@eleatic/eval` value-import in the tree — the import fence
 * (config/dependency-cruiser.mjs → `eleatic-only-in-trace`) pins it to this one file, so the
 * package's heavy better-sqlite3/express transitive deps never enter the Next app bundle.
 *
 * Writes a reduced trace to a local SQLite eval store: record the run, bulk-insert its rows,
 * finalize the row count, close. Explore the result with `npx @eleatic/eval serve --db <path>`.
 * The local record types are structurally compatible with the store's, so they pass straight in.
 *
 * @param path SQLite file path; defaults to ':memory:' (ephemeral — pass a real path to persist).
 */
export function writeTrace(
  reduced: { run: EvalRunRecord; rows: EvalRowRecord[] },
  opts: { path?: string } = {},
): { path: string; rowCount: number } {
  const path = opts.path ?? ':memory:';
  const store = openStore(path);
  try {
    store.recordRun(reduced.run);
    store.recordRows(reduced.rows);
    store.finalizeRun(reduced.run.id, { rowCount: reduced.rows.length });
    return { path, rowCount: reduced.rows.length };
  } finally {
    store.close();
  }
}
