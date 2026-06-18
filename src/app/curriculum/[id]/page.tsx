import { getCurriculum } from '../../../store/repo';
import { tileView } from '../view';
import { GeneratingPoller } from './generating';

// Read per request — the curriculum lives in Postgres, not at build time.
export const dynamic = 'force-dynamic';

export default async function CurriculumHub({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = await getCurriculum(id);

  // No row yet = the run is still in flight (persistRun writes the whole curriculum atomically
  // on completion). Show a generating state that polls until the row lands, then refreshes.
  if (!view) {
    return (
      <main className="wrap">
        <p className="eyebrow">Curriculum</p>
        <h1>Generating…</h1>
        <p className="lead">
          Researching, mapping prerequisites, and synthesizing interactive pages. This usually
          takes a minute or two.
        </p>
        <GeneratingPoller id={id} />
      </main>
    );
  }

  return (
    <main className="wrap wrap--wide">
      <p className="eyebrow">Curriculum</p>
      <h1>{view.topic}</h1>
      <p className="lead">
        {view.settings.level} · depth {view.settings.depth}
      </p>

      <div className="hub">
        {view.hub.tiers.map((tier) => (
          <section key={tier.tier} className="tier">
            <h2 className="tier__name">{tier.tier}</h2>
            {tier.categories.map((category) => (
              <div key={category.name} className="category">
                {category.name ? <h3 className="category__name">{category.name}</h3> : null}
                <ul className="tiles">
                  {category.pages.map((page) => {
                    const tile = tileView(page, id);
                    const badge = (
                      <span className={`badge badge--${tile.status}`}>
                        <span className="badge__icon" aria-hidden="true">
                          {tile.icon}
                        </span>{' '}
                        {tile.statusLabel}
                      </span>
                    );
                    return (
                      <li key={page.slug} className={`tile tile--${tile.status}`}>
                        {tile.href ? (
                          <a className="tile__link" href={tile.href}>
                            <span className="tile__title">{tile.title}</span>
                            {badge}
                          </a>
                        ) : (
                          <span className="tile__static">
                            <span className="tile__title">{tile.title}</span>
                            {badge}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </section>
        ))}
      </div>
    </main>
  );
}
