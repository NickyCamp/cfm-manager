// Every season's player stats (Nick, 2026-11-24: "build in every year's stats for players").
//
// EA only returns the current season, and data.json starts over when the year changes, so the
// worker keeps each season's stat lines in league-data/<slug>/stats-<year>.json.gz, merged on
// every sync (a line once seen is never dropped). Scores stay in seasons.json.gz (seasons.ts).
// Leagues that rolled over before this existed get a one-time seed (scripts/season-seeds/).

import { normName } from "./headshots";
import type { ArchivedSeason, ArchivedTeam } from "./seasons";
import type { Game, LeagueData, Player, StatLine, Team, TeamGame, Week } from "./types";

/** first, last, position: names for players who may no longer be in the league. */
export type SeasonName = [first: string, last: string, pos: string];

export type SeasonStats = {
  version: 1;
  year: number;
  savedAt: string;
  /** Only part of the season's player stats survived (NCL 2026: Weeks 1–5 from one saved export). */
  partial?: string;
  lines: StatLine[];
  teamGames: TeamGame[];
  names: Record<string, SeasonName>;
};

const lineKey = (l: StatLine) => `${l.g}:${l.p}`;
const tgKey = (t: TeamGame) => `${t.g}:${t.t}`;

/** Adds this build's lines to the season's file. Newer lines replace older ones for the same game and player. */
export function mergeSeasonStats(old: SeasonStats | null, d: LeagueData): SeasonStats {
  const year = d.season.year;
  const base: SeasonStats = old && old.year === year ? old : { version: 1, year, savedAt: d.pulledAt, lines: [], teamGames: [], names: {} };
  const lines = new Map(base.lines.map((l) => [lineKey(l), l]));
  for (const l of d.lines) lines.set(lineKey(l), l);
  const tgs = new Map(base.teamGames.map((t) => [tgKey(t), t]));
  for (const t of d.teamGames) tgs.set(tgKey(t), t);
  const names = { ...base.names };
  const ids = new Set([...lines.values()].map((l) => l.p));
  for (const p of d.players) if (ids.has(p.id)) names[String(p.id)] = [p.first, p.last, p.pos];
  return { ...base, savedAt: d.pulledAt, lines: [...lines.values()], teamGames: [...tgs.values()], names };
}

// ---------- seeds (one-time imports of seasons played before CFM Manager kept them) ----------

export type SeasonSeed = {
  year: number;
  source: string;
  partialStats?: boolean;
  weeks: Week[];
  games: Game[];
  /** p is the player's MyMadden id (birth date YYYYMMDD + presentation id) as a string. */
  lines: (Omit<StatLine, "p"> & { p: string })[];
  teamGames: TeamGame[];
  people: Record<string, SeasonName>;
};

/**
 * Matches a seed's MyMadden ids to this league's EA roster ids: same birth date and name
 * (or the only player with that birth date and last name). Players no longer in the league
 * keep their MyMadden id, with their name in the season's names.
 */
export function mapSeedPlayers(seed: SeasonSeed, players: Player[]) {
  const byBorn = new Map<string, Player[]>();
  for (const p of players) {
    if (!p.born) continue;
    const k = p.born.replace(/-/g, "");
    const l = byBorn.get(k);
    if (l) l.push(p); else byBorn.set(k, [p]);
  }
  const map = new Map<string, number>();
  let matched = 0;
  for (const [mm, [first, last]] of Object.entries(seed.people)) {
    const cands = byBorn.get(mm.slice(0, 8)) || [];
    const full = normName(`${first} ${last}`);
    let hit = cands.filter((p) => normName(`${p.first} ${p.last}`) === full);
    if (hit.length !== 1) hit = cands.filter((p) => normName(p.last) === normName(last));
    if (hit.length === 1) { map.set(mm, hit[0].id); matched++; }
    else map.set(mm, Number(mm));
  }
  return { map, matched, total: Object.keys(seed.people).length };
}

/** A seed as an archived season (scores) plus its stats file, with player ids mapped to this league's. */
export function seedSeason(seed: SeasonSeed, d: LeagueData, savedAt: string) {
  const { map, matched, total } = mapSeedPlayers(seed, d.players);
  const id = (mm: string) => map.get(mm) ?? Number(mm);
  const lines: StatLine[] = seed.lines.map((l) => ({ ...l, p: id(l.p) }));
  const names: Record<string, SeasonName> = {};
  for (const [mm, n] of Object.entries(seed.people)) {
    const cur = d.players.find((p) => p.id === map.get(mm));
    names[String(id(mm))] = cur ? [cur.first, cur.last, cur.pos] : n;
  }
  const teams: ArchivedTeam[] = d.teams.map((t) => ({ id: t.id, abbr: t.abbr, city: t.city, name: t.name, primary: t.primary }));
  const season: ArchivedSeason = { year: seed.year, savedAt, teams, weeks: seed.weeks, games: seed.games.filter((g) => g.home && g.away) };
  const stats: SeasonStats = {
    version: 1, year: seed.year, savedAt, lines, teamGames: seed.teamGames, names,
    ...(seed.partialStats ? { partial: "Player stats from this season only cover part of it (what was saved before CFM Manager)." } : {}),
  };
  return { season, stats, matched, total };
}

/** Seed underneath, anything already saved on top (saved data is newer). */
export function mergeStatsFiles(under: SeasonStats, over: SeasonStats | null): SeasonStats {
  if (!over) return under;
  const lines = new Map(under.lines.map((l) => [lineKey(l), l]));
  for (const l of over.lines) lines.set(lineKey(l), l);
  const tgs = new Map(under.teamGames.map((t) => [tgKey(t), t]));
  for (const t of over.teamGames) tgs.set(tgKey(t), t);
  return { ...under, savedAt: over.savedAt, lines: [...lines.values()], teamGames: [...tgs.values()], names: { ...under.names, ...over.names } };
}

// ---------- reading a past season like the current one ----------

/**
 * A past season shaped like LeagueData, so box scores, game logs and totals use the same code.
 * Teams come from the current data when the id still exists (colors, abbr), players too;
 * players who left the league get a stand-in with `gone` and `archived` (no player page).
 */
export function pastSeasonData(d: LeagueData, season: ArchivedSeason, stats: SeasonStats | null): LeagueData {
  const cur = new Map(d.teams.map((t) => [t.id, t]));
  const teams: Team[] = season.teams.map((a) => cur.get(a.id) ?? standInTeam(a));
  for (const t of d.teams) if (!teams.some((x) => x.id === t.id)) teams.push(t);
  const players: Player[] = [...d.players];
  const have = new Set(players.map((p) => p.id));
  for (const [id, [first, last, pos]] of Object.entries(stats?.names ?? {})) {
    if (have.has(Number(id))) continue;
    players.push(standInPlayer(Number(id), first, last, pos));
  }
  return {
    ...d,
    season: { year: season.year, stage: 1, week: 22, title: `${season.year} season`, secsSinceAdvance: null },
    weeks: season.weeks,
    teams,
    players,
    games: season.games,
    lines: stats?.lines ?? [],
    teamGames: stats?.teamGames ?? [],
    prevSeason: undefined,
  };
}

function standInTeam(a: ArchivedTeam): Team {
  const z = { w: 0, l: 0, t: 0, pct: 0, divW: 0, divL: 0, divT: 0, confW: 0, confL: 0, confT: 0, homeW: 0, homeL: 0, homeT: 0, awayW: 0, awayL: 0, awayT: 0, pf: 0, pa: 0, streak: 0, seed: 0, rank: 0 };
  return {
    id: a.id, abbr: a.abbr, city: a.city, name: a.name, primary: a.primary, secondary: a.primary, division: "", conference: "", user: "", ovr: 0,
    cap: { room: 0, spent: 0, available: 0 }, rec: z, ranks: { offYds: 0, defYds: 0, offPass: 0, offRush: 0, defPass: 0, defRush: 0 },
  };
}

function standInPlayer(id: number, first: string, last: string, pos: string): Player {
  return {
    id, team: 0, first, last, pos, age: 0, ovr: 0, dev: 0, jersey: 0, yearsPro: 0, college: "", height: 0, weight: 0,
    draft: { round: 0, pick: 0, year: 0 }, ps: false, ir: false, injury: 0,
    contract: { length: 0, yearsLeft: 0, salary: 0, bonus: 0, capHit: 0, releasePenalty: 0, releaseSavings: 0 },
    abilities: [], gone: true, archived: true,
  };
}
