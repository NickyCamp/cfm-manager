// Past seasons' scores (added 2026-11-16, Nick: the Scores tab keeps every season).
// EA only returns the current season's schedule, so the worker copies each
// season's games into league-data/<slug>/seasons.json.gz on every sync; once
// the league moves to a new year, the old year stays in the file.

import type { Game, LeagueData, Week } from "./types";

export type ArchivedTeam = { id: number; abbr: string; city: string; name: string; primary: string };
export type ArchivedSeason = { year: number; savedAt: string; teams: ArchivedTeam[]; weeks: Week[]; games: Game[] };
export type SeasonArchive = { version: 1; seasons: Record<string, ArchivedSeason> };

/** Puts this build's season (scheduled games only) into the archive, replacing any older copy of the same year. */
export function archiveSeason(a: SeasonArchive | null, d: LeagueData): SeasonArchive {
  const games = d.games.filter((g) => g.home && g.away);
  const out: SeasonArchive = a ?? { version: 1, seasons: {} };
  if (!games.length) return out; // nothing scheduled yet (offseason pull of a new league): keep what's there
  out.seasons[String(d.season.year)] = {
    year: d.season.year,
    savedAt: d.pulledAt,
    teams: d.teams.map((t) => ({ id: t.id, abbr: t.abbr, city: t.city, name: t.name, primary: t.primary })),
    weeks: d.weeks,
    games,
  };
  return out;
}
