import type { Metadata } from "next";
import Link from "next/link";
import { getLeagueData, getLeagueRow } from "@/lib/league/load";
import { gamesForWeek, indexes, leaders, record, streakText } from "@/lib/league/derive";
import { money } from "@/lib/league/format";
import { GameCard, NoData, PlayerLink, TeamBadge } from "@/components/league/bits";
import { supabaseUser } from "@/lib/supabase/server";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ new?: string; joined?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return { title: (await getLeagueRow(slug))?.name || "League" };
}

export default async function LeagueHome({ params, searchParams }: Props) {
  const { slug } = await params;
  const { new: isNew, joined } = await searchParams;
  const [row, d] = await Promise.all([getLeagueRow(slug), getLeagueData(slug)]);

  const notices = (
    <>
      {isNew && <div className="notice ok">League added. The first sync pulls every roster and week from EA; pages fill in when it finishes.</div>}
      {joined && <div className="notice ok">You joined this league.</div>}
      {row?.last_sync_status === "failed" && <FailedNotice leagueId={row.id} />}
    </>
  );
  if (!d) return (<>{notices && <div className="wrap" style={{ paddingTop: 20 }}>{notices}</div>}<NoData /></>);

  const { teams, players } = indexes(d);
  const thisWeek = gamesForWeek(d, d.season.stage, d.season.week).filter((g) => g.home || g.away);
  const best = [...d.teams].sort((a, b) => b.rec.pct - a.rec.pct || (b.rec.pf - b.rec.pa) - (a.rec.pf - a.rec.pa)).slice(0, 6);
  const capRoom = [...d.teams].sort((a, b) => b.cap.available - a.cap.available);
  const lead = leaders(d, 1).filter((c) => ["py", "ry", "rcy", "sk", "int"].includes(c.key));

  return (
    <main className="page league-page">
      <div className="wrap">
        {notices}
        <section>
          <div className="section-head">
            <h2>{d.season.title}</h2>
            <Link href={`/l/${slug}/scores`}>All scores</Link>
          </div>
          {thisWeek.length ? (
            <div className="game-grid">{thisWeek.map((g) => <GameCard key={g.id} slug={slug} game={g} teams={teams} />)}</div>
          ) : (
            <p className="muted">No games this week.</p>
          )}
        </section>

        <div className="split">
          <section className="panel">
            <div className="section-head"><h3>Best records</h3><Link href={`/l/${slug}/standings`}>Standings</Link></div>
            <table className="tbl compact">
              <tbody>
                {best.map((t) => (
                  <tr key={t.id}>
                    <td><Link className="team-link" href={`/l/${slug}/teams/${t.abbr.toLowerCase()}`}><TeamBadge team={t} size={22} />{t.city} {t.name}</Link></td>
                    <td className="num">{record(t)}</td>
                    <td className="num muted">{streakText(t.rec.streak)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="panel">
            <div className="section-head"><h3>Cap space</h3><Link href={`/l/${slug}/cap`}>All teams</Link></div>
            <table className="tbl compact">
              <tbody>
                {[...capRoom.slice(0, 3), ...capRoom.slice(-3)].map((t, i) => (
                  <tr key={t.id} className={i === 3 ? "gap-above" : ""}>
                    <td><Link className="team-link" href={`/l/${slug}/teams/${t.abbr.toLowerCase()}?tab=cap`}><TeamBadge team={t} size={22} />{t.city} {t.name}</Link></td>
                    <td className={`num ${t.cap.available < 0 ? "neg" : ""}`}>{money(t.cap.available)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="hint">The three teams with the most room, then the three with the least.</p>
          </section>

          <section className="panel">
            <div className="section-head"><h3>Leaders</h3><Link href={`/l/${slug}/leaders`}>All leaders</Link></div>
            <table className="tbl compact">
              <tbody>
                {lead.map((c) => c.rows[0] && (
                  <tr key={c.key}>
                    <td className="muted">{c.label}</td>
                    <td><PlayerLink slug={slug} player={c.rows[0].player} /> <span className="muted">{teams.get(c.rows[0].team)?.abbr}</span></td>
                    <td className="num">{c.rows[0].value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
        <p className="hint">Updated from EA {new Date(d.pulledAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" })} ET. {players.size.toLocaleString()} players.</p>
      </div>
    </main>
  );
}

async function FailedNotice({ leagueId }: { leagueId: string }) {
  const sb = await supabaseUser();
  const { data } = await sb.from("sync_runs").select("report").eq("league_id", leagueId).order("started_at", { ascending: false }).limit(1);
  const line = data?.[0]?.report?.split("\n").find((l: string) => l.includes("**"));
  return <div className="notice error">The last sync didn&apos;t finish. {line ? line.replace(/^[-\s]*/, "").replaceAll("**", "") : ""}</div>;
}
