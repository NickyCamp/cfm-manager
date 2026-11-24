// Player page "Stats" tab (Nick, 2026-11-24): a career table with every season the player has
// stats in (this league's seasons, then real NFL seasons from 2025 on), and a game log for the
// picked season. The season data comes from src/lib/league/playerSeasons.ts (shared with the bot).
import Link from "next/link";
import { passerRating } from "@/lib/league/derive";
import { avg } from "@/lib/league/format";
import type { Player } from "@/lib/league/types";
import { seasonKey, seasonLabel, seasonLog, seasonRow, seasonsWithGames, type SeasonRow, type StatSeason } from "@/lib/league/playerSeasons";

export function PlayerStats({ slug, p, league, seasons, pick, base }: {
  slug: string; p: Player; league: string; seasons: StatSeason[]; pick: string | undefined; base: string;
}) {
  const rows = seasons.map((s) => seasonRow(s, p)).filter((r): r is SeasonRow => Boolean(r));
  const withGames = seasonsWithGames(seasons, p);
  if (!withGames.length) return <p className="muted">No games logged for him yet.</p>;
  const cur = withGames.find((s) => seasonKey(s) === pick) ?? withGames[0];
  const has = (f: (t: SeasonRow["t"]) => number) => rows.some((r) => f(r.t) > 0);
  const show = {
    pass: has((t) => t.pa), rush: has((t) => t.ra), rec: has((t) => t.rc + t.rcy),
    def: has((t) => t.tk + t.sk + t.int), kick: has((t) => t.fga + t.xpa), punt: has((t) => t.pnt),
  };
  const href = (s: StatSeason) => `${base}?tab=log&season=${seasonKey(s)}`;
  const log = seasonLog(cur, p);

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
              {rows.map(({ s, team, t, note }) => (
                <tr key={seasonKey(s)} className={seasonKey(s) === seasonKey(cur) ? "row-on" : undefined}>
                  <td className="nw"><Link href={href(s)} scroll={false}>{seasonLabel(s, league)}</Link>{note && <span className="muted small" title={note}> partial</span>}</td>
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
          <Link key={seasonKey(s)} href={href(s)} scroll={false} aria-current={seasonKey(s) === seasonKey(cur) ? "page" : undefined}>{seasonLabel(s, league)}</Link>
        ))}
      </nav>
      <div className="panel tbl-wrap">
        <table className="tbl">
          <caption>
            {seasonLabel(cur, league)} game log
            {cur.kind === "nfl" ? <span className="muted small"> real games · nflverse</span> : cur.d.partialStats ? <span className="muted small"> · {cur.d.partialStats}</span> : null}
          </caption>
          <thead><tr><th>Week</th><th>Opp</th><th>Result</th><th>Line</th></tr></thead>
          <tbody>
            {log.map((r, i) => (
              <tr key={i}>
                <td className="muted nw">{r.week}</td>
                <td className="nw">{r.opp}</td>
                <td className="nw">{r.result}{r.simmed ? <span className="muted small"> sim</span> : null}</td>
                <td>{r.gameId != null && cur.kind === "league" ? <Link href={`/l/${slug}/games/${r.gameId}${cur.past ? `?season=${cur.year}` : ""}`}>{r.line}</Link> : r.line}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
