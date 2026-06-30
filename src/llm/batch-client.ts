import Anthropic from '@anthropic-ai/sdk';
import type { LlmCallRecord } from './client';
import { type StageModel, registryId } from './models';
import { estimateBatchCostUsd } from './pricing';

/**
 * The Anthropic Message Batches adapter — an OFFLINE-ONLY seam for the eval/judge/CLI arm (issue #188).
 *
 * Batch processing is 50% cheaper on both input and output tokens but runs async (minutes, up to 24h),
 * so it is wired ONLY into work that doesn't block a user — the offline LLM-judge sweep — and NEVER into
 * the live `api/generate → runLesson` pipeline, whose `StageDeps` keep their synchronous client.
 *
 * This is the SOLE import site of the native `@anthropic-ai/sdk` (`@ai-sdk/anthropic`, the live pipeline's
 * provider, exposes no batch endpoint). A 4th `config/dependency-cruiser.mjs` fence
 * (`anthropic-batch-only-in-batch-client`) confines the SDK to this one module, mirroring
 * `eleatic-only-in-trace` / `firebase-admin-only-in-auth-adapter`, so the heavy native SDK can never leak
 * into the Next app bundle.
 */

/** The transport status of a submitted batch (the native SDK's `processing_status`). */
export type BatchProcessingStatus = 'in_progress' | 'canceling' | 'ended';

/** One request submitted to the transport, already lowered to the wire shape (bare model id + a single
 *  user turn). `cacheSystem` marks the system block for 1-hour prompt caching. */
export interface BatchTransportRequest {
  customId: string;
  /** The bare provider model id (e.g. `claude-opus-4-8`) — NOT the `provider:model` pricing key. */
  model: string;
  system?: string;
  prompt: string;
  maxTokens: number;
  cacheSystem: boolean;
}

/** One collected entry from the transport, normalized across providers. The transport reports the raw
 *  token splits + the `provider:model` pricing key; cost is computed by `BatchClient`, NOT here, so the
 *  batch-rate pricing lives in exactly one place. */
export interface BatchTransportEntry {
  customId: string;
  status: 'succeeded' | 'errored' | 'expired' | 'canceled';
  /** present only when `status === 'succeeded'` */
  text?: string;
  finishReason?: string;
  /** the `provider:model` pricing key the served request resolved to (present on success) */
  providerModel?: string;
  usage?: { inputTokens: number; outputTokens: number; cacheWriteTokens: number; cacheReadTokens: number };
  /** present on a non-succeeded entry */
  error?: string;
}

/**
 * The swap seam the tests inject a fake for — three operations over a provider's batch endpoint:
 * submit-many (`create`), poll status (`retrieve`), collect results (`results`). Keeping it provider-
 * agnostic means a unit test exercises submit/poll/collect with zero live spend.
 */
export interface BatchTransport {
  create(requests: BatchTransportRequest[]): Promise<string>;
  retrieve(id: string): Promise<BatchProcessingStatus>;
  results(id: string): Promise<BatchTransportEntry[]>;
}

/** A high-level batch request — the same `{model, system, prompt}` shape a synchronous `complete` call
 *  takes, plus a `customId` for fan-back and an opt-in `cacheSystem` for the 1-hour cached prefix. */
export interface BatchRequest {
  customId: string;
  model: StageModel;
  prompt: string;
  system?: string;
  maxTokens?: number;
  cacheSystem?: boolean;
}

/** One collected result, keyed back to its `customId`. A succeeded entry carries the text + a
 *  batch-rate `LlmCallRecord`; a failed/expired/cancelled entry surfaces its error WITHOUT crashing the
 *  sweep, so one bad request never poisons the whole batch. */
export type BatchEntryResult =
  | { customId: string; ok: true; text: string; finishReason: string; record: LlmCallRecord }
  | { customId: string; ok: false; error: string };

const DEFAULT_MAX_TOKENS = 8000;
const DEFAULT_POLL_INTERVAL_MS = 10_000;

export interface BatchClientOptions {
  pollIntervalMs?: number;
  /** Injected so a test drives the poll loop without real timers (the default awaits a real delay). */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Submit → poll → collect-by-`custom_id` over an injected `BatchTransport`. Every collected
 * `LlmCallRecord.costUsd` is computed at the BATCH rate (`estimateBatchCostUsd`, 50% of `MODEL_PRICING`
 * plus the correct 1-hour cache economics) — NOT the synchronous full rate — so the discount lands in the
 * trace ledger this feature exists to populate (issue #188).
 */
export class BatchClient {
  private readonly transport: BatchTransport;
  private readonly pollIntervalMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(transport: BatchTransport, options: BatchClientOptions = {}) {
    this.transport = transport;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** Submit a set of requests as one batch; returns the batch id. */
  async submit(requests: BatchRequest[]): Promise<string> {
    return this.transport.create(
      requests.map((r) => ({
        customId: r.customId,
        model: r.model.model,
        ...(r.system !== undefined ? { system: r.system } : {}),
        prompt: r.prompt,
        maxTokens: r.maxTokens ?? DEFAULT_MAX_TOKENS,
        cacheSystem: r.cacheSystem ?? false,
      })),
    );
  }

  /** True once the batch has ended (succeeded/errored/expired entries are ready to collect). */
  async poll(id: string): Promise<boolean> {
    return (await this.transport.retrieve(id)) === 'ended';
  }

  /** Collect the batch's results, keyed by `custom_id`. Order-independent (the API returns entries in any
   *  order, so we map by id, never position). Each succeeded entry gets a BATCH-RATE `LlmCallRecord`. */
  async collect(id: string): Promise<Map<string, BatchEntryResult>> {
    const out = new Map<string, BatchEntryResult>();
    for (const entry of await this.transport.results(id)) {
      out.set(entry.customId, toEntryResult(entry));
    }
    return out;
  }

  /** The convenience path: submit → poll until ended → collect. The poll interval + `sleep` are injected,
   *  so a test resolves the loop instantly. */
  async run(requests: BatchRequest[]): Promise<Map<string, BatchEntryResult>> {
    const id = await this.submit(requests);
    while (!(await this.poll(id))) {
      await this.sleep(this.pollIntervalMs);
    }
    return this.collect(id);
  }
}

function toEntryResult(entry: BatchTransportEntry): BatchEntryResult {
  if (entry.status !== 'succeeded' || entry.text === undefined || entry.usage === undefined || entry.providerModel === undefined) {
    return { customId: entry.customId, ok: false, error: entry.error ?? `batch entry ${entry.status}` };
  }
  const record: LlmCallRecord = {
    providerModel: entry.providerModel,
    inputTokens: entry.usage.inputTokens,
    outputTokens: entry.usage.outputTokens,
    // BATCH rate (50% of MODEL_PRICING) + 1-hour cache economics — never the synchronous full rate.
    costUsd: estimateBatchCostUsd(entry.providerModel, {
      inputTokens: entry.usage.inputTokens,
      outputTokens: entry.usage.outputTokens,
      cacheWriteTokens: entry.usage.cacheWriteTokens,
      cacheReadTokens: entry.usage.cacheReadTokens,
    }),
    rawUsage: entry.usage,
    finishReason: entry.finishReason ?? 'stop',
  };
  return { customId: entry.customId, ok: true, text: entry.text, finishReason: record.finishReason, record };
}

/**
 * The real Anthropic transport — the ONLY code that touches `@anthropic-ai/sdk`. Lowers each
 * `BatchTransportRequest` to a `messages.batches` request (a single user turn; the system block carries a
 * 1-hour `cache_control` when `cacheSystem`), and normalizes results back to `BatchTransportEntry`,
 * reconstructing the `provider:model` pricing key as `anthropic:<served model>` (the batch SDK is
 * Anthropic-only). Needs `ANTHROPIC_API_KEY` in the env; never exercised by the unit tests.
 */
export function anthropicBatchTransport(client: Anthropic = new Anthropic()): BatchTransport {
  return {
    async create(requests) {
      const batch = await client.messages.batches.create({
        requests: requests.map((r) => ({
          custom_id: r.customId,
          params: {
            model: r.model,
            max_tokens: r.maxTokens,
            ...(r.system !== undefined
              ? {
                  system: [
                    {
                      type: 'text' as const,
                      text: r.system,
                      ...(r.cacheSystem ? { cache_control: { type: 'ephemeral' as const, ttl: '1h' as const } } : {}),
                    },
                  ],
                }
              : {}),
            messages: [{ role: 'user' as const, content: r.prompt }],
          },
        })),
      });
      return batch.id;
    },
    async retrieve(id) {
      const batch = await client.messages.batches.retrieve(id);
      return batch.processing_status;
    },
    async results(id) {
      const entries: BatchTransportEntry[] = [];
      for await (const r of await client.messages.batches.results(id)) {
        if (r.result.type === 'succeeded') {
          const msg = r.result.message;
          const text = msg.content
            .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
            .map((b) => b.text)
            .join('');
          entries.push({
            customId: r.custom_id,
            status: 'succeeded',
            text,
            finishReason: msg.stop_reason ?? 'stop',
            providerModel: `anthropic:${msg.model}`,
            usage: {
              inputTokens: msg.usage.input_tokens,
              outputTokens: msg.usage.output_tokens,
              cacheWriteTokens: msg.usage.cache_creation_input_tokens ?? 0,
              cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0,
            },
          });
        } else {
          entries.push({
            customId: r.custom_id,
            status: r.result.type,
            error:
              r.result.type === 'errored'
                ? `errored: ${JSON.stringify(r.result.error)}`
                : `batch entry ${r.result.type}`,
          });
        }
      }
      return entries;
    },
  };
}

/** The `provider:model` pricing key for a stage model — re-exported so a sweep driver can label its
 *  output without reaching back into `models.ts`. */
export function batchProviderModel(model: StageModel): string {
  return registryId(model);
}
