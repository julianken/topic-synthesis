import type { ZodType } from 'zod';

/**
 * A durable-step seam. `step(name, key, fn)` runs `fn` at most once per (name, key)
 * and returns its result — so a re-entrant pipeline (retry, resume) never repeats a
 * completed step. The in-process `InlineEngine` is the test/dev implementation; the
 * durable Postgres-backed `GcpEngine` (run as a Cloud Run Job) is the production one. Keeping
 * stages behind this seam is what lets the pipeline orchestration stay unit-testable.
 *
 * `validate` is an OPTIONAL per-step Zod schema (4th param, so every existing
 * `step(name, key, fn)` caller compiles unchanged). When present, a DURABLE engine
 * (`GcpEngine`) parses a cached `step_result` against it before resuming: a row whose
 * shape no longer matches (e.g. an old-shape `LessonBrief` after a deploy changed the
 * contract) is treated as a cache MISS and re-run, so a stale shape can never feed a
 * later stage. An absent validator preserves the legacy "return the cached value as-is"
 * behavior. The in-process `InlineEngine` holds only this-process results, which are
 * fresh by construction, so the validator is a no-op there (kept for interface parity).
 */
export interface Engine {
  step<O>(name: string, key: string, fn: () => Promise<O>, validate?: ZodType<O>): Promise<O>;
}
