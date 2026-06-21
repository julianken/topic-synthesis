import { randomUUID } from 'node:crypto';
import type { Level } from '../../../domain/settings';
import type { TopicRequest } from '../../../domain/stages';
import { InlineEngine } from '../../../engine/inline-engine';
import { STAGE_MODELS, type Stage, type StageModel } from '../../../llm/models';
import { defaultDeps } from '../../../pipeline/deps';
import { runLesson } from '../../../pipeline/run-pipeline';
import { persistRun, recordRunOwner } from '../../../store/repo';
import { getSessionIdentity } from '../../auth/require-session';
import { isSameOrigin } from '../../auth/session';
import { dispatchJob, isJobDispatchEnabled } from './dispatch';

// The pipeline + pg need the Node runtime, not Edge. Never statically cached.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// App-triggered runs are cheap + capped by default: every stage on Haiku, synthesis + research
// fan-out bounded — a click stays ~pennies. (Production would run default models behind the
// Cloud Run Job; the lean local path runs the pipeline in-process here — see ADR 0001.)
const HAIKU: StageModel = { provider: 'anthropic', model: 'claude-haiku-4-5' };
const CHEAP_MODELS: Record<Stage, StageModel> = {
  planner: HAIKU,
  researcher: HAIKU,
  graph: HAIKU,
  brief: HAIKU,
  spec: HAIKU,
  code: HAIKU,
  critic: HAIKU,
};
const APP_RUN = { models: CHEAP_MODELS, maxNodes: 4, maxQuestions: 4 } as const;

const LEVELS: readonly string[] = ['intro', 'intermediate', 'advanced'];

function parseRequest(body: unknown): TopicRequest | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  const topic = typeof b.topic === 'string' ? b.topic.trim() : '';
  if (!topic) return null;
  const level: Level = typeof b.level === 'string' && LEVELS.includes(b.level) ? (b.level as Level) : 'intermediate';
  const rawDepth = typeof b.depth === 'number' ? b.depth : Number(b.depth);
  const depth = Number.isFinite(rawDepth) ? Math.min(5, Math.max(1, Math.round(rawDepth))) : 3;
  const audience =
    typeof b.audience === 'string' && b.audience.trim() ? b.audience.trim() : 'self-taught learner';
  return { topic, settings: { level, depth, audience } };
}

// Track the fire-and-forget run so its promise isn't GC'd; log failures. On failure the curriculum
// simply never appears — the hub's poller eventually surfaces its "still working" hint.
const inflight = new Set<Promise<unknown>>();

function startRun(runId: string, request: TopicRequest, ownerSub: string): void {
  const work = (async () => {
    // SINGLE-LESSON path (runLesson) — matches the deployed Cloud Run Job (run-job.ts) + the
    // single-lesson UI (#49), so `npm run dev` generates one lesson locally instead of a full
    // curriculum. `maxNodes` in APP_RUN is inert on this path (it builds exactly one page), kept only
    // so the cheap+capped knobs read identically to the curriculum-era config.
    const run = await runLesson(request, new InlineEngine(), defaultDeps, APP_RUN);
    const modelSnapshots: Record<Stage, StageModel> = { ...STAGE_MODELS, ...CHEAP_MODELS };
    await persistRun({ runId, request, result: run.result, costUsd: run.costUsd, modelSnapshots, ownerSub });
  })();
  inflight.add(work);
  work
    .catch((err) => console.error('[generate] run failed', runId, err))
    .finally(() => inflight.delete(work));
}

export async function POST(req: Request): Promise<Response> {
  // Spend gate (ADR 0002 §5): an authoritative, revocation-checked, allowlisted session BEFORE any
  // runId / dispatch / in-process spend — above the dispatch-vs-in-process branch, since BOTH spend.
  const identity = await getSessionIdentity({ checkRevoked: true });
  if (!identity) return Response.json({ error: 'Sign in to generate.' }, { status: 401 });
  if (!isSameOrigin(req)) return Response.json({ error: 'cross-origin request rejected' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const request = parseRequest(body);
  if (!request) {
    return Response.json({ error: 'A non-empty "topic" is required.' }, { status: 400 });
  }
  // The runId IS the curriculum id (persistRun keys on it); the client redirects to
  // /curriculum/<id> and the hub polls it. 202: accepted, generation in flight.
  const runId = randomUUID();
  // Stamp ownership at dispatch (before the curriculum persists) so the hub can owner-scope the
  // pre-persist poll window with no existence oracle; the Job writes owner_sub onto the curriculum.
  await recordRunOwner(runId, identity.sub);
  if (isJobDispatchEnabled()) {
    // Deployed: dispatch the durable Cloud Run Job — the Service stays scale-to-zero (it never holds
    // the run in-process). A failed dispatch is honest (502), not a phantom 202 the poller waits on.
    try {
      await dispatchJob(runId, request, identity.sub);
    } catch (err) {
      console.error('[generate] job dispatch failed', runId, err);
      return Response.json({ error: 'Could not start generation.' }, { status: 502 });
    }
  } else {
    startRun(runId, request, identity.sub); // local dev (no PIPELINE_JOB_NAME): run the pipeline in-process.
  }
  return Response.json({ id: runId }, { status: 202 });
}
