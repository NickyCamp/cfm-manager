import type { Metadata } from "next";
import Link from "next/link";
import { getLeagueData, getLeagueSeasons } from "@/lib/league/load";
import { gamesForWeek, indexes, parseWeekKey, weekKey, weekTitle } from "@/lib/league/derive";
import { GameCard, NoData, TeamBadge } from "@/components/league/bits";
import { onColor } from "@/lib/league/format";
import type { Game, Week } from "@/lib/league/types";
import type { ArchivedTeam } from "@/lib/league/seasons";

export const metadata: Metadata = { title: "Scores" };
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ season?: string; week?: string; team?: string }> };

const short = (title: string) => title.replace("Preseason Week ", "P").replace("Week ", "").replace(" Playoff", "").replace("Wildcard", "WC").replace("Wild Card", "WC")
  .replace("Divisional", "Div").replace("Conference", "Conf").replace("Super Bowl", "SB");

/**
 * Scores (reworked 2026-11-16, Nick): the current week's games up top, then a table of
 * every final with filters by season, week and team. Past seasons come from the
 * worker's season archive, so a season chip is added each year.
 */
export default async function Scores({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const [d, archive] = await Promise.all([getLeagueData(slug), getLeagueSeasons(slug)]);
  if (!d) return <NoData />;
  const { teams } = indexes(d);

  // ---------- this week ----------
  const scheduled = (g: Game) => Boolean(g.home && g.away);
  let cur = { stage: d.season.stage, week: d.season.week };
  let curGames = gamesForWeek(d, cur.stage, cur.week).filter(scheduled);
  const latest = !curGames.length; // offseason or a week with no games: show the latest week that had games
  if (latest) {
    const last = [...d.games].filter(scheduled).sort((a, b) => a.stage - b.stage || a.week - b.week).filter((g) => g.final).pop();
    if (last) { cur = { stage: last.stage, week: last.week }; curGames = gamesForWeek(d, cur.stage, cur.week).filter(scheduled); }
  }
  const finals = curGames.filter((g) => g.final).length;

  // ---------- past scores ----------
  const years = [...new Set([d.season.year, ...Object.keys(archive?.seasons ?? {}).map(Number)])].sort((a, b) => b - a);
  const year = years.includes(Number(sp.season)) ? Number(sp.season) : d.season.year;
  const isCurrent = year === d.season.year;
  const past = isCurrent ? null : archive!.seasons[String(year)];
  const games: Game[] = isCurrent ? d.games : past?.games ?? [];
  const weeks: Week[] = isCurrent ? d.weeks : past?.weeks ?? [];
  const teamList: ArchivedTeam[] = isCurrent ? d.teams : past?.teams ?? [];
  const teamOf = new Map(teamList.map((t) => [t.id, t]));
  const allFinals = games.filter((g) => scheduled(g) && g.final);
  const finalWeeks = weeks.filter((w) => allFinals.some((g) => g.stage === w.stage && g.week === w.week));
  const pickWeek = parseWeekKey(sp.week);
  const wk = pickWeek && finalWeeks.some((w) => w.stage === pickWeek.stage && w.week === pickWeek.week) ? pickWeek : null;
  const team = sp.team ? teamList.find((t) => t.abbr.toLowerCase() === sp.team!.toLowerCase()) : undefined;
  const rows = allFinals
    .filter((g) => !wk || (g.stage === wk.stage && g.week === wk.week))
    .filter((g) => !team || g.home === team.id || g.away === team.id)
    .sort((a, b) => b.stage - a.stage || b.week - a.week || a.id - b.id);
  const titleOf = (g: Game) => (isCurrent ? weekTitle(d, g.stage, g.week) : weeks.find((w) => w.stage === g.stage && w.week === g.week)?.title ?? `Week ${g.week + 1}`);

  const href = (o: { season?: number; week?: string | null; team?: string | null }) => {
    const q = new URLSearchParams();
    const y = o.season ?? year;
    if (y !== d.season.year) q.set("season", String(y));
    const w = o.week === undefined ? (wk ? weekKey(wk.stage, wk.week) : null) : o.week;
    if (w) q.set("week", w);
    const t = o.team === undefined ? team?.abbr.toLowerCase() : o.team;
    if (t) q.set("team", t);
    const s = q.toString();
    return `/l/${slug}/scores${s ? `?${s}` : ""}#past`;
  };

  return (
    <main className="page league-page">
      <div className="wrap">
        <div className="week-title" style={{ marginBottom: 12 }}>
          <h2>{latest ? "Latest scores: " : ""}{d.season.year} {weekTitle(d, cur.stage, cur.week)}</h2>
          <div className="muted">
            {latest && d.season.stage >= 2 ? `${d.season.title}: no games this week. ` : ""}
            {curGames.length ? `${finals} of ${curGames.length} games final` : ""}
          </div>
        </div>
        {curGames.length ? (
          <div className="game-grid">{curGames.map((g) => <GameCard key={g.id} slug={slug} game={g} teams={teams} />)}</div>
        ) : (
          <p className="muted">The matchups for this week aren&apos;t set yet.</p>
        )}

        <section id="past" className="past-scores">
          <h3>Past scores</h3>
          <nav className="week-chips" aria-label="Season">
            {years.map((y) => <Link key={y} href={href({ season: y, week: null, team: null })} aria-current={y === year ? "page" : undefined}>{y}</Link>)}
          </nav>
          <nav className="week-chips" aria-label="Week">
            <Link href={href({ week: null })} aria-current={!wk ? "page" : undefined}>All</Link>
            {finalWeeks.map((w) => {
              const k = weekKey(w.stage, w.week);
              return <Link key={k} href={href({ week: k })} aria-current={wk && wk.stage === w.stage && wk.week === w.week ? "page" : undefined} title={w.title}>{short(w.title)}</Link>;
            })}
          </nav>
          <div className="filter-row">
            <form method="get" action={`/l/${slug}/scores#past`} className="search-form tx-team-form">
              {!isCurrent && <input type="hidden" name="season" value={year} />}
              {wk && <input type="hidden" name="week" value={weekKey(wk.stage, wk.week)} />}
              <select name="team" defaultValue={team?.abbr.toLowerCase() ?? ""} aria-label="Team">
                <option value="">All teams</option>
                {[...teamList].sort((a, b) => a.city.localeCompare(b.city)).map((t) => <option key={t.id} value={t.abbr.toLowerCase()}>{t.city} {t.name}</option>)}
              </select>
              <button type="submit" className="btn btn-quiet">Show</button>
            </form>
            <span className="muted small">{rows.length} game{rows.length === 1 ? "" : "s"}</span>
          </div>

          {rows.length ? (
            <div className="panel tbl-wrap">
              <table className="tbl scores-tbl">
                <thead><tr><th>Week</th><th>Away</th><th className="num">Score</th><th>Home</th><th className="hide-sm"></th><th></th></tr></thead>
                <tbody>
                  {rows.map((g) => {
                    const a = teamOf.get(g.away), h = teamOf.get(g.home);
                    const aw = g.as > g.hs, hw = g.hs > g.as;
                    return (
                      <tr key={g.id}>
                        <td className="nw muted">{titleOf(g).replace(" Playoff", "")}</td>
                        <td className={aw ? "strong" : ""}>{isCurrent ? <TeamBadge team={teams.get(g.away)} size={20} /> : <Mini t={a} />} {a?.name ?? "TBD"}</td>
                        <td className="num nw"><span className={aw ? "strong" : "muted"}>{g.as}</span> – <span className={hw ? "strong" : "muted"}>{g.hs}</span></td>
                        <td className={hw ? "strong" : ""}>{isCurrent ? <TeamBadge team={teams.get(g.home)} size={20} /> : <Mini t={h} />} {h?.name ?? "TBD"}</td>
                        <td className="hide-sm">{g.forced ? <span className="tag">Sim (forced)</span> : g.simmed === true ? <span className="tag">Sim</span> : g.simmed === false ? <span className="tag">Played</span> : null}</td>
                        <td><Link className="small" href={`/l/${slug}/games/${g.id}${isCurrent ? "" : `?season=${year}`}`}>Box score</Link></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <div className="panel"><p className="muted">No finals{team ? ` for the ${team.name}` : ""} here yet.</p></div>}
        </section>
      </div>
    </main>
  );
}

function Mini({ t }: { t: ArchivedTeam | undefined }) {
  if (!t) return null;
  return <span className="team-badge" style={{ background: t.primary, color: onColor(t.primary), width: 20, height: 20, fontSize: 7.2 }} aria-hidden>{t.abbr}</span>;
}
