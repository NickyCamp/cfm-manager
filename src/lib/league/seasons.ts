// Past seasons' scores (added 2026-11-16, Nick: the Scores tab keeps every season).
// EA only returns the current season's schedule, so the worker copies each
// season's games into league-data/<slug>/seasons.json.gz on every sync; once
// the league moves to a new year, the old year stays in the file.

import type { Game, LeagueData, Week } from "./types";

export type ArchivedTeam = { id: number; abbr: string; city: string; name: string; primary: string };
export type ArchivedSeason = { year: number; savedAt: string; teams: ArchivedTeam[]; weeks: Week[]; games: Game[] };
/** seeded: years a one-time import (scripts/season-seeds/) was applied for. */
export type SeasonArchive = { version: 1; seasons: Record<string, ArchivedSeason>; seeded?: number[] };

/**
 * Adds this build's season (scheduled games only) to the archive. Games are merged by id, never
 * dropped: offseason pulls only list a handful of last season's games, and replacing the season
 * with them wiped NCL's 2027 scores (fixed 2026-11-24).
 */
export function archiveSeason(a: SeasonArchive | null, d: LeagueData): SeasonArchive {
  const games = d.games.filter((g) => g.home && g.away);
  const out: SeasonArchive = a ?? { version: 1, seasons: {} };
  if (!games.length) return out; // nothing scheduled yet (offseason pull of a new league): keep what's there
  const year = String(d.season.year);
  const old = out.seasons[year];
  out.seasons[year] = mergeArchived(old, {
    year: d.season.year,
    savedAt: d.pulledAt,
    teams: d.teams.map((t) => ({ id: t.id, abbr: t.abbr, city: t.city, name: t.name, primary: t.primary })),
    weeks: d.weeks,
    games,
  });
  return out;
}

/** `over` on top of `under`: same-id games and same weeks are replaced, the rest kept. */
export function mergeArchived(under: ArchivedSeason | undefined, over: ArchivedSeason): ArchivedSeason {
  if (!under) return over;
  const games = new Map(under.games.map((g) => [g.id, g]));
  for (const g of over.games) {
    const was = games.get(g.id);
    // A later pull can still list a finished game as unplayed (EA's leftovers): keep the final.
    if (was?.final && !g.final) continue;
    games.set(g.id, { ...g, simmed: g.simmed ?? was?.simmed ?? null });
  }
  const weeks = new Map(under.weeks.map((w) => [`${w.stage}:${w.week}`, w]));
  for (const w of over.weeks) {
    const k = `${w.stage}:${w.week}`, was = weeks.get(k);
    weeks.set(k, was && was.games > w.games ? { ...was, title: w.title || was.title } : w);
  }
  const teams = new Map(under.teams.map((t) => [t.id, t]));
  for (const t of over.teams) teams.set(t.id, t);
  return {
    ...over,
    teams: [...teams.values()],
    weeks: [...weeks.values()].sort((a, b) => a.stage - b.stage || a.week - b.week),
    games: [...games.values()].sort((a, b) => a.stage - b.stage || a.week - b.week || a.id - b.id),
  };
}
