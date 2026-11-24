// Real NFL game logs (Nick, 2026-11-24), from nflverse via scripts/real-stats/update.mjs: whole careers
// 2004–2025 for players still in the NFL in 2024 or later (2026 on is the league's own cycle).
// League players are matched to real ones the same way as headshots (name + birth date, headshots.ts);
// generated draft-class players never match and simply have none.
// One file per season (real-stats/<year>.json), loaded only when a page or command needs it.
import index from "./real-stats/players.json";
import { rowMatcher, type Row } from "./headshots";
import type { Player, StatLine } from "./types";

/** A real game line: StatLine's keys, plus targets and tackles for loss. */
export type RealLine = Omit<StatLine, "g" | "p" | "t"> & { tgt?: number; tfl?: number };
export type RealGame = { id: string; season: number; week: number; post: boolean; away: string; as: number; home: string; hs: number };
export type RealEntry = { game: RealGame; team: string; line: RealLine };

type IndexRow = [...Row, number[]];
type SeasonFile = { games: [string, number, string, string, number, string, number][]; logs: Record<string, [number, string, RealLine][]> };

const rows = (index as unknown as { players: IndexRow[] }).players;
const match = rowMatcher(rows as unknown as Row[]);
export const realStatsUpdated = (index as unknown as { updated: string }).updated;

const seasonFiles = new Map<number, Promise<SeasonFile>>();
function seasonFile(year: number): Promise<SeasonFile> {
  let f = seasonFiles.get(year);
  if (!f) {
    f = import(`./real-stats/${year}.json`).then((m) => (m.default ?? m) as SeasonFile);
    seasonFiles.set(year, f);
  }
  return f;
}

/** The real seasons a league player has games in (newest first), without loading any season file. */
export function realSeasonList(p: Player): number[] {
  if (p.archived) return [];
  const r = match(p) as unknown as IndexRow | undefined;
  return r ? [...r[7]].sort((a, b) => b - a) : [];
}

/** Every real NFL game the player has a line in, oldest first; [] if he isn't a real player. */
export async function realLog(p: Player): Promise<RealEntry[]> {
  if (p.archived) return [];
  const r = match(p) as unknown as IndexRow | undefined;
  if (!r) return [];
  const id = r[5];
  const out: RealEntry[] = [];
  for (const year of [...r[7]].sort((a, b) => a - b)) {
    const f = await seasonFile(year);
    for (const [gi, team, line] of f.logs[id] || []) {
      const [gid, week, type, away, as, home, hs] = f.games[gi];
      out.push({ game: { id: gid, season: year, week, post: type === "P", away, as, home, hs }, team, line });
    }
  }
  return out;
}

/** Real seasons in a log, newest first. */
export const realSeasons = (log: RealEntry[]) => [...new Set(log.map((e) => e.game.season))].sort((a, b) => b - a);
