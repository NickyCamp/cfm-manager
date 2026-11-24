// Player page "Stats" tab (Nick, 2026-11-24): a career table with every season the player has
// stats in (this league's seasons, then real NFL seasons from 2025 on), and a game log for the
// picked season. League seasons before this one come from the worker's season files (seasonStats.ts).
import Link from "next/link";
import { REG_SEASON_LAST_WEEK, addLine, indexes, passerRating, weekTitle, zeroTotals, type Totals } from "@/lib/league/derive";
import { avg } from "@/lib/league/format";
import type { LeagueData, Player } from "@/lib/league/types";
import type { RealEntry, RealLine } from "@/lib/league/realStats";

type Line = Partial<Record<string, number>>;
/** One season of one kind: the league's (`d` is that season's data) or real NFL games. */
export type StatSeason =
  | { kind: "league"; year: number; d: LeagueData; past: boolean }
  | { kind: "nfl"; year: number; log: RealEntry[] };

const key = (s: StatSeason) => (s.kind === "nfl" ? `nfl-${s.year}` : String(s.year));

export function lineText(l: Line) {
  const parts: string[] = [];
  const n = (x?: number) => x || 0;
  if (n(l.pa)) parts.push(`${n(l.pc)}/${n(l.pa)}, ${n(l.py)} yds, ${n(l.ptd)} TD, ${n(l.pint)} INT`);
  if (n(l.ra)) parts.push(`${n(l.ra)} car, ${n(l.ry)} yds${n(l.rtd) ? `, ${l.rtd} TD` : ""}`);
  if (n(l.rc)) parts.push(`${n(l.rc)} rec, ${n(l.rcy)} yds${n(l.rctd) ? `, ${l.rctd} TD` : ""}`);
  if (n(l.tk) || n(l.sk) || n(l.int)) parts.push(`${n(l.tk)} tkl${n(l.sk) ? `, ${l.sk} sck` : ""}${n(l.int) ? `, ${l.int} INT` : ""}${n(l.pd) ? `, ${l.pd} PD` : ""}`);
  if (n(l.fga) || n(l.xpa)) parts.push(`FG ${n(l.fgm)}/${n(l.fga)}, XP ${n(l.xpm)}/${n(l.xpa)}`);
  if (n(l.pnt)) parts.push(`${l.pnt} punts, ${avg(n(l.pnty), n(l.pnt))} avg`);
  return parts.join("; ") || "Played";
}

type Row = { s: StatSeason; label: string; team: string; t: Totals; note?: string };

/** Regular-season totals for a season, or null if he has no regular-season games in it. */
function totalsOf(s: StatSeason, p: Player): Omit<Row, "s" | "label"> | null {
  const t = zeroTotals();
  let team = "";
  if (s.kind === "league") {
    const { games, teams } = indexes(s.d);
    for (const l of s.d.lines) {
      if (l.p !== p.id) continue;
      const g = games.get(l.g);
      if (!g || g.stage !== 1 || g.week > REG_SEASON_LAST_WEEK) continue;
      addLine(t, l as Line);
      team = teams.get(l.t)?.abbr ?? team;
    }
  } else {
    for (const e of s.log) if (e.game.season === s.year && !e.game.post) { addLine(t, e.line as Line); team = e.team; }
  }
  return t.gp ? { team, t, note: s.kind === "league" ? s.d.partialStats : undefined } : null;
}

export function PlayerStats({ slug, p, league, seasons, pick, base }: {
  slug: string; p: Player; league: string; seasons: StatSeason[]; pick: string | undefined; base: string;
}) {
  const rows: Row[] = [];
  for (const s of seasons) {
    const t = totalsOf(s, p);
    if (t) rows.push({ s, label: s.kind === "nfl" ? `${s.year} NFL` : `${s.year} ${league}`, ...t });
  }
  // Seasons with only playoff/preseason games still get a game log.
  const withGames = seasons.filter((s) => s.kind === "nfl" ? s.log.some((e) => e.game.season === s.year) : s.d.lines.some((l) => l.p === p.id));
  if (!withGames.length) return <p className="muted">No games logged for him yet.</p>;
  const cur = withGames.find((s) => key(s) === pick) ?? withGames[0];
  const has = (f: (t: Totals) => number) => rows.some((r) => f(r.t) > 0);
  const show = {
    pass: has((t) => t.pa), rush: has((t) => t.ra), rec: has((t) => t.rc + t.rcy),
    def: has((t) => t.tk + t.sk + t.int), kick: has((t) => t.fga + t.xpa), punt: has((t) => t.pnt),
  };
  const href = (s: StatSeason) => `${base}?tab=log&season=${key(s)}`;

  return (
    <>
      {rows.length > 0 && (
        <div className="panel tbl-wrap">
          <table className="tbl career-tbl">
            <caption>Career <span className="muted small">regular season · {league} seasons, then real NFL seasons</span></caption>
            <thead>
              <tr>
                <th>Season</th><th>Team</th><th className="num">GP</th>
                {show.pass && <><th className="num">C/ATT</th><th className="num">PASS YDS</th><th className="num">TD-INT</th><th className="num">RTG</th></>}
                {show.rush && <><th className="num">CAR</th><th className="num">RUSH YDS</th><th className="num">TD</th></>}
                {show.rec && <><th className="num">REC</th><th className="num">REC YDS</th><th className="num">TD</th></>}
                {show.def && <><th className="num">TKL</th><th className="num">SCK</th><th className="num">INT</th></>}
                {show.kick && <><th className="num">FG</th><th className="num">XP</th></>}
                {show.punt && <><th className="num">PUNTS</th><th className="num">AVG</th></>}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ s, label, team, t, note }) => (
                <tr key={key(s)} className={key(s) === key(cur) ? "row-on" : undefined}>
                  <td className="nw"><Link href={href(s)} scroll={false}>{label}</Link>{note && <span className="muted small" title={note}> partial</span>}</td>
                  <td>{team}</td>
                  <td className="num">{t.gp}</td>
                  {show.pass && <><td className="num">{t.pa ? `${t.pc}/${t.pa}` : "–"}</td><td className="num">{t.pa ? t.py : "–"}</td><td className="num">{t.pa ? `${t.ptd}-${t.pint}` : "–"}</td><td className="num">{t.pa ? passerRating(t).toFixed(1) : "–"}</td></>}
                  {show.rush && <><td className="num">{t.ra || "–"}</td><td className="num">{t.ra ? t.ry : "–"}</td><td className="num">{t.ra ? t.rtd : "–"}</td></>}
                  {show.rec && <><td className="num">{t.rc || "–"}</td><td className="num">{t.rc ? t.rcy : "–"}</td><td className="num">{t.rc ? t.rctd : "–"}</td></>}
                  {show.def && <><td className="num">{t.tk}</td><td className="num">{t.sk}</td><td className="num">{t.int}</td></>}
                  {show.kick && <><td className="num">{t.fga ? `${t.fgm}/${t.fga}` : "–"}</td><td className="num">{t.xpa ? `${t.xpm}/${t.xpa}` : "–"}</td></>}
                  {show.punt && <><td className="num">{t.pnt || "–"}</td><td className="num">{t.pnt ? avg(t.pnty, t.pnt) : "–"}</td></>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <nav className="week-chips" aria-label="Game log season">
        {withGames.map((s) => (
          <Link key={key(s)} href={href(s)} scroll={false} aria-current={key(s) === key(cur) ? "page" : undefined}>{s.kind === "nfl" ? `${s.year} NFL` : `${s.year} ${league}`}</Link>
        ))}
      </nav>
      {cur.kind === "league" ? <LeagueLog slug={slug} p={p} s={cur} league={league} /> : <NflLog s={cur} />}
    </>
  );
}

function LeagueLog({ slug, p, s, league }: { slug: string; p: Player; s: Extract<StatSeason, { kind: "league" }>; league: string }) {
  const d = s.d;
  const { teams, games } = indexes(d);
  const log = d.lines.filter((l) => l.p === p.id).map((l) => ({ l, g: games.get(l.g)! })).filter((x) => x.g)
    .sort((a, b) => a.g.stage - b.g.stage || a.g.week - b.g.week);
  return (
    <div className="panel tbl-wrap">
      <table className="tbl">
        <caption>{s.year} {league} game log{d.partialStats && <span className="muted small"> · {d.partialStats}</span>}</caption>
        <thead><tr><th>Week</th><th>Opp</th><th>Result</th><th>Line</th></tr></thead>
        <tbody>
          {log.map(({ l, g }) => {
            const home = g.home === l.t;
            const opp = teams.get(home ? g.away : g.home);
            const us = home ? g.hs : g.as, them = home ? g.as : g.hs;
            return (
              <tr key={l.g}>
                <td className="muted nw">{weekTitle(d, g.stage, g.week).replace(" Playoff", "")}</td>
                <td className="nw">{home ? "vs" : "at"} {opp?.abbr ?? "?"}</td>
                <td className="nw">{g.final ? `${us > them ? "W" : us < them ? "L" : "T"} ${us}-${them}` : ""}{g.simmed ? <span className="muted small"> sim</span> : null}</td>
                <td><Link href={`/l/${slug}/games/${g.id}${s.past ? `?season=${s.year}` : ""}`}>{lineText(l as Line)}</Link></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function NflLog({ s }: { s: Extract<StatSeason, { kind: "nfl" }> }) {
  const log = s.log.filter((e) => e.game.season === s.year);
  return (
    <div className="panel tbl-wrap">
      <table className="tbl">
        <caption>{s.year} NFL game log <span className="muted small">real games · nflverse</span></caption>
        <thead><tr><th>Week</th><th>Opp</th><th>Result</th><th>Line</th></tr></thead>
        <tbody>
          {log.map(({ game: g, team, line }) => {
            const home = g.home === team;
            const us = home ? g.hs : g.as, them = home ? g.as : g.hs;
            return (
              <tr key={g.id}>
                <td className="muted nw">{g.post ? postName(g.week, g.season) : `Week ${g.week}`}</td>
                <td className="nw">{home ? "vs" : "at"} {home ? g.away : g.home}</td>
                <td className="nw">{us > them ? "W" : us < them ? "L" : "T"} {us}-{them}</td>
                <td>{realText(line)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function realText(l: RealLine) {
  const t = lineText(l as Line);
  return l.tgt && l.rc !== undefined ? t.replace(/(\d+) rec,/, `$1/${l.tgt} rec,`) : t;
}

/** nflverse playoff weeks run on from the regular season (19-22 since 2021). */
function postName(week: number, season: number) {
  const first = season >= 2021 ? 19 : 18;
  return ["Wild Card", "Divisional", "Conference", "Super Bowl"][week - first] ?? `Week ${week}`;
}
