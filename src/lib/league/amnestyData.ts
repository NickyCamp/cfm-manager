// Server-side data for the amnesty views: the same per-player cap picture the Trade Tool
// uses (buildTradeData: cap hit by season, bonus share by season, void-year bonus, Madden's
// penalty), plus the full contract totals for the admin page.
import { buildTradeData } from "./tradeData";
import type { LeagueData } from "./types";

export type AmnestyPlayer = {
  id: number; n: string; pos: string; t: number; age: number; ovr: number; ps: boolean;
  c: { length: number; yearsLeft: number; salary: number; bonus: number; capHit: number; pen: number; saves: number };
  hits: number[]; bonus: number[]; dead: number[];
};
export type AmnestyTeam = { id: number; abbr: string; name: string; space: number; spaces: number[]; capSet: boolean[] };

export function buildAmnestyData(d: LeagueData) {
  const td = buildTradeData(d);
  const byId = new Map(d.players.map((p) => [p.id, p]));
  const players: AmnestyPlayer[] = td.players.map((tp) => {
    const c = byId.get(tp.id)!.contract;
    return {
      id: tp.id, n: tp.n, pos: tp.pos, t: tp.t, age: tp.age, ovr: tp.ovr, ps: tp.ps,
      c: { length: c.length, yearsLeft: c.yearsLeft, salary: c.salary, bonus: c.bonus, capHit: c.capHit, pen: c.releasePenalty, saves: c.releaseSavings },
      hits: tp.hits, bonus: tp.bonus, dead: tp.dead,
    };
  });
  const teams: AmnestyTeam[] = td.teams.map((t) => ({ id: t.id, abbr: t.abbr, name: t.name, space: t.cap[0] - t.committed[0], spaces: t.cap.map((c, i) => c - t.committed[i]), capSet: td.capSet }));
  return { year: td.year, years: td.years, players, teams };
}
export type AmnestyData = ReturnType<typeof buildAmnestyData>;

/** Plan inputs for a player (hits/bonus/dead are already by season from this season on). */
export const amnestyInput = (p: AmnestyPlayer) => ({ capHit: p.c.capHit, pen: p.c.pen, bonus: p.bonus, hits: p.hits, dead: p.dead, ps: p.ps });

/**
 * The team's cap space this season and next for each way of moving on (Nick, 2026-11-20):
 * keep him, a normal cut, Option 1 (1 year, 50% now) and Option 2 (2 years, 25% + 25%).
 * splits: dead money [this season, next season] for each option.
 */
export function teamSpaceRows(team: AmnestyTeam, keepCost: number[], normal: number[], opt1: number[], opt2: number[]) {
  const after = (dead: number[]) => [0, 1].map((i) => team.spaces[i] + keepCost[i] - (dead[i] || 0));
  return [
    { key: "keep", label: "Keep him", v: [team.spaces[0], team.spaces[1]] },
    { key: "cut", label: "Normal cut", v: after(normal) },
    { key: "opt1", label: "Option 1 · 1 year", v: after(opt1) },
    { key: "opt2", label: "Option 2 · 2 years", v: after(opt2) },
  ];
}
