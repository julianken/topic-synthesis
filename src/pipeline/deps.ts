import { complete, completeObject, searchWeb } from '../llm/client';

/**
 * The LLM-client functions a pipeline stage depends on. Stages take this bag so a
 * test can inject fakes and run with no live model (and so `run-pipeline` can wrap
 * calls later). Defaults to the real client.
 */
export interface StageDeps {
  complete: typeof complete;
  completeObject: typeof completeObject;
  searchWeb: typeof searchWeb;
}

export const defaultDeps: StageDeps = { complete, completeObject, searchWeb };
