import { getCurriculum } from '../../../store/repo';
import { tileView } from '../view';

// Read per request — the curriculum lives in Postgres, not at build time.
export const dynamic = 'force-dynamic';

export default async function CurriculumHub({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = await getCurriculum(id);

  if (!view) {
    return (
      <main className="wrap">
        <p className="eyebrow">Curriculum</p>
        <h1>Not found</h1>
        <p className="lead">
          No curriculum <code>{id}</code> — it may still be generating, or the id is wrong.
        </p>
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
                    const badge = <span className={`badge badge--${tile.status}`}>{tile.statusLabel}</span>;
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
