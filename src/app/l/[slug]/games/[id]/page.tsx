import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLeagueData } from "@/lib/league/load";
import { boxScore, indexes, weekKey, weekTitle } from "@/lib/league/derive";
import { avg } from "@/lib/league/format";
import { NoData, PlayerLink, TeamBadge } from "@/components/league/bits";
import type { LeagueData, StatLine, Team, TeamGame } from "@/lib/league/types";

export const metadata: Metadata = { title: "Box score" };
type Props = { params: Promise<{ slug: string; id: string }> };

export default async function BoxScore({ params }: Props) {
  const { slug, id } = await params;
  const d = await getLeagueData(slug);
  if (!d) return <NoData />;
  const { teams, players, games } = indexes(d);
  const g = games.get(Number(id));
  if (!g) notFound();
  const home = teams.get(g.home), away = teams.get(g.away);
  const { lines, teamStats } = boxScore(d, g.id);
  const ts = (t: number) => teamStats.find((s) => s.t === t);

  return (
    <main className="page league-page">
      <div className="wrap">
        <Link className="back" href={`/l/${slug}/scores?week=${weekKey(g.stage, g.week)}`}>{weekTitle(d, g.stage, g.week)} scores</Link>
        <div className="box-head">
          <Side team={away} score={g.as} won={g.final && g.as > g.hs} slug={slug} />
          <div className="box-mid">{g.final ? "Final" : "Not played"}{g.simmed === true ? <div className="tag">Simmed</div> : null}</div>
          <Side team={home} score={g.hs} won={g.final && g.hs > g.as} slug={slug} home />
        </div>

        {away && home && ts(away.id) && ts(home.id) && <TeamCompare away={away} home={home} a={ts(away.id)!} h={ts(home.id)!} />}

        {!lines.length && <p className="muted">EA has no player stats for this game{g.stage === 0 ? " (it doesn't keep them for preseason games)" : ""}.</p>}
        <div className="box-teams">
          {[away, home].map((t) => t && (
            <TeamLines key={t.id} slug={slug} team={t} lines={lines.filter((l) => l.t === t.id)} players={players} />
          ))}
        </div>
      </div>
    </main>
  );
}

function Side({ team, score, won, slug, home }: { team: Team | undefined; score: number; won: boolean; slug: string; home?: boolean }) {
  return (
    <div className={`box-side ${home ? "home" : ""} ${won ? "won" : ""}`}>
      <TeamBadge team={team} size={48} />
      <div>
        {team ? <Link href={`/l/${slug}/teams/${team.abbr.toLowerCase()}`} className="box-team">{team.city} {team.name}</Link> : "TBD"}
        {team?.user && <div className="muted small">{team.user}</div>}
      </div>
      <div className="box-score">{score}</div>
    </div>
  );
}

function TeamCompare({ away, home, a, h }: { away: Team; home: Team; a: TeamGame; h: TeamGame }) {
  const rows: [string, string, string][] = [
    ["Total yards", `${a.yds}`, `${h.yds}`],
    ["Passing", `${a.passYds}`, `${h.passYds}`],
    ["Rushing", `${a.rushYds}`, `${h.rushYds}`],
    ["First downs", `${a.firstDowns}`, `${h.firstDowns}`],
    ["3rd down", `${a.third[0]}/${a.third[1]}`, `${h.third[0]}/${h.third[1]}`],
    ["4th down", `${a.fourth[0]}/${a.fourth[1]}`, `${h.fourth[0]}/${h.fourth[1]}`],
    ["Red zone TDs", `${a.redZone[0]}/${a.redZone[1]}`, `${h.redZone[0]}/${h.redZone[1]}`],
    ["Turnovers", `${a.turnovers}`, `${h.turnovers}`],
    ["Sacks", `${a.sacks}`, `${h.sacks}`],
    ["Penalties", `${a.penalties}-${a.penaltyYds}`, `${h.penalties}-${h.penaltyYds}`],
  ];
  return (
    <div className="panel tbl-wrap">
      <table className="tbl compare">
        <caption>Team stats</caption>
        <thead><tr><th className="num">{away.abbr}</th><th></th><th className="num">{home.abbr}</th></tr></thead>
        <tbody>{rows.map(([l, x, y]) => <tr key={l}><td className="num">{x}</td><td className="center muted">{l}</td><td className="num">{y}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

type Col = { h: string; v: (l: StatLine) => string | number };
function Section({ title, rows, cols, slug, players }: { title: string; rows: StatLine[]; cols: Col[]; slug: string; players: Map<number, LeagueData["players"][number]> }) {
  if (!rows.length) return null;
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <caption>{title}</caption>
        <thead><tr><th scope="col">Player</th>{cols.map((c) => <th key={c.h} className="num">{c.h}</th>)}</tr></thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.p}><td><PlayerLink slug={slug} player={players.get(l.p)} /></td>{cols.map((c) => <td key={c.h} className="num">{c.v(l)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TeamLines({ slug, team, lines, players }: { slug: string; team: Team; lines: StatLine[]; players: Map<number, LeagueData["players"][number]> }) {
  const n = (x?: number) => x || 0;
  const by = (k: keyof StatLine) => [...lines].filter((l) => n(l[k] as number) > 0).sort((a, b) => n(b[k] as number) - n(a[k] as number));
  return (
    <section className="panel">
      <h3 className="team-h"><TeamBadge team={team} size={24} />{team.name}</h3>
      <Section title="Passing" slug={slug} players={players} rows={by("pa")} cols={[
        { h: "C/ATT", v: (l) => `${n(l.pc)}/${n(l.pa)}` }, { h: "YDS", v: (l) => n(l.py) }, { h: "TD", v: (l) => n(l.ptd) },
        { h: "INT", v: (l) => n(l.pint) }, { h: "SCK", v: (l) => n(l.psk) },
      ]} />
      <Section title="Rushing" slug={slug} players={players} rows={by("ra")} cols={[
        { h: "CAR", v: (l) => n(l.ra) }, { h: "YDS", v: (l) => n(l.ry) }, { h: "AVG", v: (l) => avg(n(l.ry), n(l.ra)) },
        { h: "TD", v: (l) => n(l.rtd) }, { h: "LNG", v: (l) => n(l.rlng) },
      ]} />
      <Section title="Receiving" slug={slug} players={players} rows={by("rc")} cols={[
        { h: "REC", v: (l) => n(l.rc) }, { h: "YDS", v: (l) => n(l.rcy) }, { h: "TD", v: (l) => n(l.rctd) }, { h: "LNG", v: (l) => n(l.rclng) },
      ]} />
      <Section title="Defense" slug={slug} players={players} rows={[...lines].filter((l) => n(l.tk) + n(l.sk) + n(l.int) + n(l.ff) + n(l.pd) > 0).sort((a, b) => n(b.tk) - n(a.tk))} cols={[
        { h: "TKL", v: (l) => n(l.tk) }, { h: "SCK", v: (l) => n(l.sk) }, { h: "INT", v: (l) => n(l.int) }, { h: "PD", v: (l) => n(l.pd) }, { h: "FF", v: (l) => n(l.ff) },
      ]} />
      <Section title="Kicking" slug={slug} players={players} rows={lines.filter((l) => n(l.fga) + n(l.xpa) > 0)} cols={[
        { h: "FG", v: (l) => `${n(l.fgm)}/${n(l.fga)}` }, { h: "LNG", v: (l) => n(l.fglng) }, { h: "XP", v: (l) => `${n(l.xpm)}/${n(l.xpa)}` },
      ]} />
      <Section title="Punting" slug={slug} players={players} rows={lines.filter((l) => n(l.pnt) > 0)} cols={[
        { h: "NO", v: (l) => n(l.pnt) }, { h: "AVG", v: (l) => avg(n(l.pnty), n(l.pnt)) }, { h: "IN 20", v: (l) => n(l.pnt20) }, { h: "LNG", v: (l) => n(l.pntlng) },
      ]} />
    </section>
  );
}
