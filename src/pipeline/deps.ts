import { complete, completeObject, searchWeb, streamComplete } from '../llm/client';

/**
 * The LLM-client functions a pipeline stage depends on. Stages take this bag so a
 * test can inject fakes and run with no live model (and so `run-pipeline` can wrap
 * calls later). Defaults to the real client. `streamComplete` is the streaming path
 * the `code` stage uses (PR-1) — per-call timing + the live-progress hook.
 */
export interface StageDeps {
  complete: typeof complete;
  completeObject: typeof completeObject;
  searchWeb: typeof searchWeb;
  streamComplete: typeof streamComplete;
}

export const defaultDeps: StageDeps = { complete, completeObject, searchWeb, streamComplete };
