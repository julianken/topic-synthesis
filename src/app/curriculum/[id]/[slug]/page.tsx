import { notFound } from 'next/navigation';
import { getCurriculum } from '../../../../store/repo';

export const dynamic = 'force-dynamic';

export default async function ArtifactDetail({
  params,
}: {
  params: Promise<{ id: string; slug: string }>;
}) {
  // Next URL-decodes the param → the raw slug. Keyed by slug (URL-safe, curriculum-unique)
  // rather than the content-identity pageId, whose `#` breaks nested page-route matching.
  const { id, slug } = await params;
  const view = await getCurriculum(id);
  const page = view?.hub.tiers
    .flatMap((tier) => tier.categories.flatMap((category) => category.pages))
    .find((p) => p.slug === slug && p.built);
  if (!page) notFound();

  return (
    <main className="wrap wrap--wide">
      <p className="eyebrow">
        <a className="back" href={`/curriculum/${id}`}>
          ← Back to curriculum
        </a>
      </p>
      <h1>{page.title}</h1>
      {/* sandbox="allow-scripts" WITHOUT allow-same-origin → opaque origin: the page runs its own
          canvas/SVG scripts but can't reach this app's origin/cookies/storage. The strict CSP is
          set by the /artifact route (page.href → src/app/artifact/serve.ts). */}
      <iframe className="artifact-frame" title={page.title} src={page.href} sandbox="allow-scripts" />
    </main>
  );
}
