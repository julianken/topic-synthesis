/**
 * A durable-step seam. `step(name, key, fn)` runs `fn` at most once per (name, key)
 * and returns its result — so a re-entrant pipeline (retry, resume) never repeats a
 * completed step. The in-process `InlineEngine` is the test/dev implementation; the
 * Trigger.dev v4 self-hosted engine is the durable production one (a later PR). Keeping
 * stages behind this seam is what lets the pipeline orchestration stay unit-testable.
 */
export interface Engine {
  step<O>(name: string, key: string, fn: () => Promise<O>): Promise<O>;
}
