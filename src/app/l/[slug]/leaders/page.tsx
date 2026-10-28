import type { Metadata } from "next";
import { getLeagueData } from "@/lib/league/load";
import { indexes, leaders } from "@/lib/league/derive";
import { NoData, PlayerLink, TeamBadge } from "@/components/league/bits";

export const metadata: Metadata = { title: "Leaders" };
type Props = { params: Promise<{ slug: string }> };

export default async function Leaders({ params }: Props) {
  const { slug } = await params;
  const d = await getLeagueData(slug);
  if (!d) return <NoData />;
  const { teams } = indexes(d);
  const cats = leaders(d, 10);
  return (
    <main className="page league-page">
      <div className="wrap">
        <h2>League leaders</h2>
        <p className="muted">Regular season.</p>
        <div className="leader-grid">
          {cats.map((c) => (
            <section className="panel" key={c.key}>
              <h3>{c.label}</h3>
              {c.rows.length ? (
                <ol className="leader-list">
                  {c.rows.map((r, i) => (
                    <li key={r.player?.id ?? i}>
                      <span className="rank">{i + 1}</span>
                      <TeamBadge team={teams.get(r.team)} size={20} />
                      <span className="who"><PlayerLink slug={slug} player={r.player} /> <span className="muted small">{r.player?.pos}</span></span>
                      <span className="num strong">{Number.isInteger(r.value) ? r.value : r.value.toFixed(1)}</span>
                    </li>
                  ))}
                </ol>
              ) : <p className="muted">No stats yet.</p>}
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
