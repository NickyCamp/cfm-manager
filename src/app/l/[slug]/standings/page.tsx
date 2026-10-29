import type { Metadata } from "next";
import Link from "next/link";
import { getLeagueData } from "@/lib/league/load";
import { standings, streakText } from "@/lib/league/derive";
import { NoData, TeamBadge } from "@/components/league/bits";

export const metadata: Metadata = { title: "Standings" };
type Props = { params: Promise<{ slug: string }> };

export default async function Standings({ params }: Props) {
  const { slug } = await params;
  const d = await getLeagueData(slug);
  if (!d) return <NoData />;
  const confs = standings(d);
  const rec = (w: number, l: number, t: number) => `${w}-${l}${t ? `-${t}` : ""}`;

  return (
    <main className="page league-page">
      <div className="wrap">
        <h2 className="sr-only">Standings</h2>
        {confs.map((c) => (
          <section key={c.conf} className="conf">
            <h2>{c.conf}</h2>
            <div className="div-grid">
              {c.divisions.map((dv) => (
                <div className="panel tbl-wrap" key={dv.div}>
                  <table className="tbl">
                    <caption>{dv.div}</caption>
                    <thead>
                      <tr><th scope="col">Team</th><th className="num">W-L</th><th className="num">PF</th><th className="num">PA</th><th className="num">Div</th><th className="num">Strk</th></tr>
                    </thead>
                    <tbody>
                      {dv.teams.map((t) => (
                        <tr key={t.id}>
                          <td>
                            <Link className="team-link" href={`/l/${slug}/teams/${t.abbr.toLowerCase()}`}>
                              <TeamBadge team={t} size={22} />
                              <span>{t.name}</span>
                              {t.rec.seed > 0 && t.rec.seed <= 7 && <span className="seed" title={`Playoff seed ${t.rec.seed}`}>{t.rec.seed}</span>}
                            </Link>
                            {t.user && <div className="muted small">{t.user}</div>}
                          </td>
                          <td className="num strong">{rec(t.rec.w, t.rec.l, t.rec.t)}</td>
                          <td className="num">{t.rec.pf}</td>
                          <td className="num">{t.rec.pa}</td>
                          <td className="num muted">{rec(t.rec.divW, t.rec.divL, t.rec.divT)}</td>
                          <td className="num muted">{streakText(t.rec.streak)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
            {c.seeds.length > 0 && (
              <div className="panel seeds">
                <h3>{c.conf} playoff picture</h3>
                <ol>
                  {c.seeds.map((t) => (
                    <li key={t.id}>
                      <Link className="team-link" href={`/l/${slug}/teams/${t.abbr.toLowerCase()}`}><TeamBadge team={t} size={22} />{t.city} {t.name}</Link>
                      <span className="muted">{rec(t.rec.w, t.rec.l, t.rec.t)}</span>
                    </li>
                  ))}
                </ol>
                <p className="hint">Seeds as Madden has them right now. <Link href={`/l/${slug}/playoffs`}>Full playoff picture with NFL tiebreakers →</Link></p>
              </div>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}
