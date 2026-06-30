import { getSessionIdentity } from '../../../../auth/require-session';
import {
  getCodeProgress,
  getLesson,
  getResearchEvents,
  getRunMeta,
  getStepEvents,
  ownsRun,
  type CodeProgress,
  type ResearchEvent,
  type RunMeta,
  type StepEvent,
} from '../../../../../store/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Has the run's curriculum landed yet, what's its per-step timeline, and what's the live research feed?
 * THREE fields behind TWO owner gates (issue #61 + live-research generating Stage 1):
 *  - `ready` ⇐ getLesson(id, sub): true only once the caller owns a PERSISTED lesson row (a
 *    foreign/absent id is uniformly not-ready — no existence oracle). Unchanged.
 *  - `steps` ⇐ ownsRun(id, sub) + getStepEvents(id): owner-scoped via the pre-persist `run_owner`
 *    stamp, so the timeline is visible DURING the run — precisely the window where getLesson
 *    still returns null (the lesson row persists atomically only at the end). A non-owner/absent id
 *    returns `[]`, indistinguishable from a just-started owned run → still no existence oracle.
 *  - `research` ⇐ the SAME `ownsRun` gate + getResearchEvents(id): the live-research feed (the planned
 *    questions + each question's grounded findings/sources). `ownsRun` is computed ONCE and reused for
 *    all owner-gated reads. A non-owner/unauthenticated/absent id yields `[]` — identical to a just-started
 *    owned run, so the research feed carries no existence oracle either. Pruned at persist (transient per-run).
 *  - `code` ⇐ the SAME `ownsRun` gate + getCodeProgress(id): the live code-phase progress (PR-4 / #180) —
 *    a learner-safe `{ fraction, elapsedMs }` (or null while code hasn't streamed). Rides the one `owns`
 *    gate too; null for a non-owner/absent id is identical to a just-started owned run (no existence
 *    oracle), and carries NO raw token/cost/model (the fraction is computed in the sink). Pruned at persist.
 *  - `meta` ⇐ the SAME `ownsRun` gate + getRunMeta(id, sub): the run's typed topic + settings (run-
 *    lifecycle #225 — `run_owner.topic`/`level`/`depth`), so the SINGLE generating screen at /lesson/[id]
 *    (the create-form now NAVIGATES there) shows "Generating <topic>…" + the "<level> · depth <n>" sub-
 *    line. Rides the one `owns` gate; null for a non-owner/absent/legacy-no-topic id (no existence oracle).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const identity = await getSessionIdentity();
  const view = identity ? await getLesson(id, identity.sub) : null;
  const owns = identity ? await ownsRun(id, identity.sub) : false;
  const steps: StepEvent[] = owns ? await getStepEvents(id) : [];
  const research: ResearchEvent[] = owns ? await getResearchEvents(id) : [];
  const code: CodeProgress | null = owns ? await getCodeProgress(id) : null;
  const meta: RunMeta | null = owns && identity ? await getRunMeta(id, identity.sub) : null;
  return Response.json({ id, ready: view !== null, steps, research, code, meta });
}
