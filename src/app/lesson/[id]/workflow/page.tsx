import { notFound, redirect } from 'next/navigation';
import { getSessionIdentity } from '../../../auth/require-session';
import { getLesson, getResearchEvents, getStepEvents } from '../../../../store/repo';
import { deriveDisposition } from '../build-summary';
import { GeneratingView } from '../generating-view';

// Read per request — the persisted lesson + its durable workflow timeline live in Postgres, not at build.
export const dynamic = 'force-dynamic';

/**
 * The PRESERVED completed-workflow page (run-lifecycle 3/4 — issue #232). It re-renders the generating
 * composition FROZEN after the run has persisted: the same six-column phase table + plan→rᵢ→brief→…→critic
 * edges + RESEARCH band + per-step timeline, all at rest, with a terminal disposition chip — the whole
 * "how this lesson came to be" surface, kept so the owner can come back and look at it. It REUSES
 * `GeneratingView` in `mode="frozen"` (no fork) and de-dups with the #175 "How this was built" disclosure
 * (they coexist; the degraded reader page links here).
 *
 * OWNER GATE — the load-bearing subtlety. It gates on `getSessionIdentity()` → `getLesson(id, sub)`
 * (DURABLE `curriculum`, owner-scoped) → `notFound()` when null. It MUST NOT gate on `ownsRun` — that
 * reads `run_owner`, which `persistRun` PRUNES at persist, so an `ownsRun` gate would 404 *every* completed
 * run. `getLesson`'s `WHERE owner_sub = $2 AND deleted_at IS NULL` makes a foreign / absent / soft-deleted
 * id a uniform 404 (no existence oracle) — the SAME gate #175's disclosure already relies on.
 *
 * The frozen view's data is the now-DURABLE `step_event` (issue #175) + `research_event` (issue #232, this
 * PR — its `persistRun` prune was removed); both are leak-safe (no token/cost/model — just learner-facing
 * timing + copy-safe claims/sources). A legacy run persisted before #232 has its research_event pruned →
 * `getResearchEvents` returns [] → the frozen RESEARCH band shows the "not retained" placeholder.
 */
export default async function WorkflowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const identity = await getSessionIdentity();
  if (!identity) redirect('/sign-in');

  // The owner gate: DURABLE getLesson (NOT ownsRun — run_owner is pruned at persist). Null ⇒ uniform 404.
  const view = await getLesson(id, identity.sub);
  if (!view) notFound();

  // The frozen composition's durable inputs — both KEPT past persist + owner-gated for free by the
  // getLesson 404 above (the SAME co-location contract #175's disclosure uses; neither is owner-scoped at
  // the read layer, so the gate must precede them — it does).
  const [steps, research] = await Promise.all([getStepEvents(id), getResearchEvents(id)]);

  // The lone page of the single-lesson curriculum → the SHARED disposition source (issue #232), so the
  // frozen chip and the reader page can't drift (page.tsx reads the same `deriveDisposition`).
  const page = view.hub.tiers
    .flatMap((tier) => tier.categories.flatMap((category) => category.pages))
    .find(() => true);
  const disposition = deriveDisposition(page);

  return (
    <main className="wrap wrap--gen">
      <GeneratingView
        mode="frozen"
        topic={view.topic}
        level={view.settings.level}
        depth={view.settings.depth}
        disposition={disposition}
        steps={steps}
        research={research}
        codeProgress={null}
        stalled={false}
      />
    </main>
  );
}
