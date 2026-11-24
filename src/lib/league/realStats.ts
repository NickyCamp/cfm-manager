// Real NFL game logs (Nick, 2026-11-24), from nflverse via scripts/real-stats/update.mjs.
// League players are matched to real ones the same way as headshots (name + birth date,
// headshots.ts); generated draft-class players never match and simply have none.
import data from "./real-stats.json";
import { rowMatcher, type Row } from "./headshots";
import type { Player, StatLine } from "./types";

/** A real game line: StatLine's keys, plus targets and tackles for loss. */
export type RealLine = Omit<StatLine, "g" | "p" | "t"> & { tgt?: number; tfl?: number };
export type RealGame = { id: string; season: number; week: number; post: boolean; away: string; as: number; home: string; hs: number };
export type RealEntry = { game: RealGame; team: string; line: RealLine };

type File = { updated: string; games: [string, number, number, string, string, number, string, number][]; players: Row[]; logs: Record<string, [number, string, RealLine][]> };
const file = data as unknown as File;
const games: RealGame[] = file.games.map(([id, season, week, type, away, as, home, hs]) => ({ id, season, week, post: type === "P", away, as, home, hs }));
const match = rowMatcher(file.players);

export const realStatsUpdated = file.updated;

/** Every real NFL game the player has a line in (2025 on), oldest first; [] if he isn't a real player. */
export function realLog(p: Player): RealEntry[] {
  if (p.archived) return [];
  const r = match(p);
  if (!r) return [];
  return (file.logs[r[5]] || []).map(([gi, team, line]) => ({ game: games[gi], team, line }));
}

/** Real seasons the player has games in, newest first. */
export const realSeasons = (log: RealEntry[]) => [...new Set(log.map((e) => e.game.season))].sort((a, b) => b - a);
