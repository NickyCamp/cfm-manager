// Every season a player has stats in, for the player page's Stats tab and the bot's /gamelog
// and /yearlog (Nick, 2026-11-24): this league's seasons (current + kept past ones, seasonStats.ts),
// then real NFL seasons (realStats.ts).
import { REG_SEASON_LAST_WEEK, addLine, indexes, passerRating, weekTitle, zeroTotals, type Totals } from "./derive";
import { avg } from "./format";
import { getPastSeason, pastYears } from "./load";
import { realLog, realSeasons, type RealEntry, type RealLine } from "./realStats";
import type { LeagueData, Player } from "./types";

type Line = Partial<Record<string, number>>;

/** One season of one kind: the league's (`d` is that season's data) or real NFL games. */
export type StatSeason =
  | { kind: "league"; year: number; d: LeagueData; past: boolean }
  | { kind: "nfl"; year: number; log: RealEntry[] };

/** "2027" for a league season, "nfl-2025" for a real one (the ?season= value and the bot's year box). */
export const seasonKey = (s: StatSeason) => (s.kind === "nfl" ? `nfl-${s.year}` : String(s.year));
export const seasonLabel = (s: StatSeason, league: string) => (s.kind === "nfl" ? `${s.year} NFL` : `${s.year} ${league}`);

/** The current season, the league's past seasons (newest first), then real NFL seasons. */
export async function playerSeasons(slug: string, d: LeagueData, p: Player): Promise<StatSeason[]> {
  const years = await pastYears(slug, d);
  const past = (await Promise.all(years.map((y) => getPastSeason(slug, y)))).filter((x): x is LeagueData => Boolean(x));
  const real = realLog(p);
  return [
    { kind: "league", year: d.season.year, d, past: false },
    ...past.map((x) => ({ kind: "league" as const, year: x.season.year, d: x, past: true })),
    ...realSeasons(real).map((year) => ({ kind: "nfl" as const, year, log: real })),
  ];
}

/** Seasons he has any game in (preseason/playoffs count), in playerSeasons' order. */
export const seasonsWithGames = (seasons: StatSeason[], p: Player) =>
  seasons.filter((s) => (s.kind === "nfl" ? s.log.some((e) => e.game.season === s.year) : s.d.lines.some((l) => l.p === p.id)));

/** A short label for a league's name in tables ("NCL"), else "League". */
export const leagueShort = (name: string | undefined, slug: string) =>
  name && name.length <= 8 ? name : slug.length <= 6 ? slug.toUpperCase() : "League";

export function lineText(l: Line) {
  const parts: string[] = [];
  const n = (x?: number) => x || 0;
  if (n(l.pa)) parts.push(`${n(l.pc)}/${n(l.pa)}, ${n(l.py)} yds, ${n(l.ptd)} TD, ${n(l.pint)} INT`);
  if (n(l.ra)) parts.push(`${n(l.ra)} car, ${n(l.ry)} yds${n(l.rtd) ? `, ${l.rtd} TD` : ""}`);
  if (n(l.rc)) parts.push(`${n(l.tgt) ? `${n(l.rc)}/${n(l.tgt)}` : n(l.rc)} rec, ${n(l.rcy)} yds${n(l.rctd) ? `, ${l.rctd} TD` : ""}`);
  if (n(l.tk) || n(l.sk) || n(l.int)) parts.push(`${n(l.tk)} tkl${n(l.sk) ? `, ${l.sk} sck` : ""}${n(l.int) ? `, ${l.int} INT` : ""}${n(l.pd) ? `, ${l.pd} PD` : ""}`);
  if (n(l.fga) || n(l.xpa)) parts.push(`FG ${n(l.fgm)}/${n(l.fga)}, XP ${n(l.xpm)}/${n(l.xpa)}`);
  if (n(l.pnt)) parts.push(`${l.pnt} punts, ${avg(n(l.pnty), n(l.pnt))} avg`);
  return parts.join("; ") || "Played";
}

/** A season's totals in one line ("206 car, 1,722 yds, 22 TD; …"), with passer rating for QBs. */
export function totalsText(t: Totals) {
  const base = lineText(t as unknown as Line);
  return t.pa ? base.replace(/ INT/, ` INT, ${passerRating(t).toFixed(1)} rtg`) : base;
}

export type SeasonRow = { s: StatSeason; team: string; t: Totals; note?: string };

/** Regular-season totals for one season, or null if he has no regular-season games in it. */
export function seasonRow(s: StatSeason, p: Player): SeasonRow | null {
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
  return t.gp ? { s, team, t, note: s.kind === "league" ? s.d.partialStats : undefined } : null;
}

export type LogRow = { week: string; opp: string; result: string; simmed?: boolean; line: string; gameId?: number };

/** One season's game log, oldest game first. */
export function seasonLog(s: StatSeason, p: Player): LogRow[] {
  if (s.kind === "nfl") {
    return s.log.filter((e) => e.game.season === s.year).map(({ game: g, team, line }) => {
      const home = g.home === team;
      const us = home ? g.hs : g.as, them = home ? g.as : g.hs;
      return { week: g.post ? postName(g.week, g.season) : `Week ${g.week}`, opp: `${home ? "vs" : "at"} ${home ? g.away : g.home}`,
        result: `${us > them ? "W" : us < them ? "L" : "T"} ${us}-${them}`, line: lineText(line as RealLine as Line) };
    });
  }
  const d = s.d;
  const { teams, games } = indexes(d);
  return d.lines.filter((l) => l.p === p.id).map((l) => ({ l, g: games.get(l.g)! })).filter((x) => x.g)
    .sort((a, b) => a.g.stage - b.g.stage || a.g.week - b.g.week)
    .map(({ l, g }) => {
      const home = g.home === l.t;
      const us = home ? g.hs : g.as, them = home ? g.as : g.hs;
      return {
        week: weekTitle(d, g.stage, g.week).replace(" Playoff", ""), opp: `${home ? "vs" : "at"} ${teams.get(home ? g.away : g.home)?.abbr ?? "?"}`,
        result: g.final ? `${us > them ? "W" : us < them ? "L" : "T"} ${us}-${them}` : "", simmed: Boolean(g.simmed), line: lineText(l as Line), gameId: g.id,
      };
    });
}

/** nflverse playoff weeks run on from the regular season (19-22 since 2021). */
function postName(week: number, season: number) {
  const first = season >= 2021 ? 19 : 18;
  return ["Wild Card", "Divisional", "Conference", "Super Bowl"][week - first] ?? `Week ${week}`;
}
