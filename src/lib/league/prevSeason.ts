// Last season's per-game numbers, kept for early-season player props (Nick, 2026-11-20: props
// disappeared in 2028 Week 1 because a player needed 2 games this season first).
//
// EA only returns this season's box scores, so when a league moves to a new year the worker
// (mergeHistory in build.ts) folds the old season's regular-season lines into a small summary
// per player and keeps it on LeagueData.prevSeason until the next rollover. NCL rolled over to
// 2028 before this existed; its 2027 summary was recovered from a saved sync and lives in
// prev-seasons/ (attached at load time, load.ts).

import type { LeagueData, StatLine } from "./types";

/** The stats props use. td = rush + receiving TDs. */
export const PREV_KEYS = ["py", "pa", "pc", "ptd", "pint", "ry", "ra", "rcy", "rc", "td", "sk"] as const;
export type PrevKey = (typeof PREV_KEYS)[number];

/** One player's regular season: games with a line, the team he had most games for, and per stat
 *  the sum and sum of squares (so a mean and a game-to-game spread can be worked out). */
export type PrevPlayer = { n: number; t: number; s: Partial<Record<PrevKey, number>>; q: Partial<Record<PrevKey, number>> };
export type PrevSeason = { year: number; players: Record<string, PrevPlayer> };

export const prevVal = (l: StatLine, k: PrevKey) => (k === "td" ? (l.rtd || 0) + (l.rctd || 0) : (l[k] as number | undefined) || 0);

/** Summarises a season's regular-season lines (stage 1, final, weeks 0–17 as EA numbers them). Players with none of the stats are left out. */
export function summarizeSeason(d: Pick<LeagueData, "season" | "games" | "lines">): PrevSeason {
  const reg = new Set(d.games.filter((g) => g.stage === 1 && g.final && g.week <= 17 && !g.forced && !g.disconnect).map((g) => g.id));
  const acc = new Map<number, { n: number; teams: Map<number, number>; s: Record<string, number>; q: Record<string, number> }>();
  for (const l of d.lines) {
    if (!reg.has(l.g)) continue;
    let a = acc.get(l.p);
    if (!a) { a = { n: 0, teams: new Map(), s: {}, q: {} }; acc.set(l.p, a); }
    a.n++;
    a.teams.set(l.t, (a.teams.get(l.t) || 0) + 1);
    for (const k of PREV_KEYS) {
      const v = prevVal(l, k);
      if (!v) continue;
      a.s[k] = (a.s[k] || 0) + v;
      a.q[k] = (a.q[k] || 0) + v * v;
    }
  }
  const players: Record<string, PrevPlayer> = {};
  for (const [id, a] of acc) {
    if (!Object.keys(a.s).length) continue;
    const t = [...a.teams].sort((x, y) => y[1] - x[1])[0][0];
    players[String(id)] = { n: a.n, t, s: a.s, q: a.q };
  }
  return { year: d.season.year, players };
}
