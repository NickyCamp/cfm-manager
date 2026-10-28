// Dev tracker: who's on pace for a dev trait bump at season's end.
// Ported from the NCL site's Dev Watch, which follows the Madden 21 "Dynamic
// Dev Progression Guide" (Jox, /u/TheWunderwaffe):
// - Each player is ranked in each listed stat against everyone at his EXACT
//   position (a FS only against other FS). Ranks are averaged and rounded down.
// - That average is checked against the range for his next tier. Dev only
//   moves one tier a season:
//     Normal -> Star        Star range, plus 8+ games started
//     Star -> Superstar     Superstar range, plus 10+ games started
//     Superstar -> X-Factor X-Factor range
// - QBs and HBs can also qualify through wider ranges if they're on pace for
//   a rushing (QB) or receiving (HB) bar.
// Madden 27 positions mapped from the guide: LE/RE -> LEDG/REDG,
// LOLB/ROLB -> SAM/WILL, MLB -> MIKE. EA's data has no tackles-for-loss or
// games-started stats: TFLs are left out, and games with a stat line stand in
// for starts.

import { REG_SEASON_LAST_WEEK, seasonTotals, type Totals } from "./derive";
import type { LeagueData, Player } from "./types";

export type StatId = "py" | "ptd" | "ry" | "rtd" | "rcy" | "rctd" | "sk" | "tk" | "pd" | "int";
export const STAT_LABEL: Record<StatId, string> = {
  py: "Pass yds", ptd: "Pass TD", ry: "Rush yds", rtd: "Rush TD", rcy: "Rec yds", rctd: "Rec TD",
  sk: "Sacks", tk: "Tackles", pd: "Defl", int: "INT",
};

type Cut = { A: number; B: number; C: number }; // A = X-Factor range, B = Superstar, C = Star (top N)
type Rule = {
  group: string; pos: string[]; sets: StatId[][]; cut: Cut; setCuts?: (Cut | null)[];
  alt?: { cut: Cut; needs: [StatId, number][]; note: string };
};

export const DEV_RULES: Rule[] = [
  { group: "QB", pos: ["QB"], sets: [["ptd", "py"]], cut: { A: 3, B: 7, C: 7 },
    alt: { cut: { A: 5, B: 10, C: 10 }, needs: [["rtd", 8], ["ry", 750]], note: "8+ rush TD and 750+ rush yds" } },
  { group: "HB", pos: ["HB"], sets: [["rtd", "ry"]], cut: { A: 3, B: 7, C: 7 },
    alt: { cut: { A: 5, B: 10, C: 10 }, needs: [["rctd", 5], ["rcy", 700]], note: "5+ rec TD and 700+ rec yds" } },
  { group: "WR", pos: ["WR"], sets: [["rctd", "rcy"]], cut: { A: 5, B: 10, C: 15 } },
  { group: "TE", pos: ["TE"], sets: [["rctd", "rcy"]], cut: { A: 3, B: 10, C: 10 } },
  { group: "DT", pos: ["DT"], sets: [["tk", "sk"]], cut: { A: 5, B: 7, C: 10 } },
  { group: "Edge", pos: ["LEDG", "REDG"], sets: [["tk", "sk"]], cut: { A: 3, B: 7, C: 10 } },
  { group: "LB", pos: ["SAM", "WILL"], sets: [["tk", "sk"], ["pd", "int"]], cut: { A: 3, B: 5, C: 7 } },
  { group: "LB", pos: ["MIKE"], sets: [["tk", "int"], ["pd", "int"]], cut: { A: 3, B: 5, C: 10 }, setCuts: [null, { A: 3, B: 5, C: 5 }] },
  { group: "CB", pos: ["CB"], sets: [["pd", "int"]], cut: { A: 5, B: 10, C: 15 } },
  { group: "Safety", pos: ["FS", "SS"], sets: [["pd", "int"]], cut: { A: 3, B: 5, C: 5 } },
];
export const DEV_GROUPS = ["QB", "HB", "WR", "TE", "DT", "Edge", "LB", "CB", "Safety"];
export const SEASON_GAMES = 17;
export const STAR_STARTS = 8;
export const SUPERSTAR_STARTS = 10;
const CLOSE_WINDOW = 2;
const NEXT = ["Star", "Superstar", "X-Factor"] as const;

function target(dev: number, cut: Cut): { next: string; need: number } | null {
  if (dev === 0) return { next: NEXT[0], need: cut.C };
  if (dev === 1) return { next: NEXT[1], need: cut.B };
  if (dev === 2) return { next: NEXT[2], need: cut.A };
  return null;
}

export type DevStatus = "on" | "blocked" | "close" | "no" | "maxed";
export type DevRow = {
  p: Player; group: string; pos: string; avg: number; need: number | null; next: string | null;
  status: DevStatus; via: string | null; gp: number; left: number; startsNeeded: number;
  stats: { id: StatId; value: number; rank: number }[];
  cut: Cut; alt?: Rule["alt"];
};

export function buildDevTracker(d: LeagueData): DevRow[] {
  const totals = seasonTotals(d);
  const val = (id: number, s: StatId) => (totals.get(id)?.[s as keyof Totals] as number) || 0;
  const teamPlayed = new Map<number, number>();
  for (const g of d.games) {
    if (g.stage !== 1 || g.week > REG_SEASON_LAST_WEEK || !g.final) continue;
    for (const t of [g.home, g.away]) teamPlayed.set(t, (teamPlayed.get(t) || 0) + 1);
  }

  const rows: DevRow[] = [];
  for (const rule of DEV_RULES) {
    for (const pos of rule.pos) {
      const pool = d.players.filter((p) => p.pos === pos && p.team && !p.gone && totals.has(p.id));
      const statIds = [...new Set([...rule.sets.flat(), ...(rule.alt ? rule.alt.needs.map((n) => n[0]) : [])])];
      const rank: Partial<Record<StatId, Map<number, number>>> = {};
      for (const sid of statIds) {
        const vals = pool.map((p) => val(p.id, sid));
        rank[sid] = new Map(pool.map((p) => [p.id, 1 + vals.filter((x) => x > val(p.id, sid)).length]));
      }
      for (const p of pool) {
        const results = rule.sets.map((set, si) => {
          const ranks = set.map((sid) => rank[sid]!.get(p.id)!);
          const cut = rule.setCuts?.[si] || rule.cut;
          const avg = Math.floor(ranks.reduce((a, b) => a + b, 0) / ranks.length);
          const t = target(p.dev, cut);
          return { set, ranks, cut, avg, margin: t ? avg - t.need : avg };
        });
        const best = results.reduce((a, b) => (b.margin < a.margin ? b : a));
        const gp = totals.get(p.id)!.gp;
        const played = teamPlayed.get(p.team) || gp;
        const left = Math.max(0, SEASON_GAMES - played);
        const t = target(p.dev, best.cut);
        const startsNeeded = p.dev === 0 ? STAR_STARTS : p.dev === 1 ? SUPERSTAR_STARTS : 0;
        let status: DevStatus = "maxed";
        let via: string | null = null;
        if (t) {
          status = best.avg <= t.need ? "on" : best.avg <= t.need + CLOSE_WINDOW ? "close" : "no";
          if (status !== "on" && rule.alt) {
            const altNeed = target(p.dev, rule.alt.cut)!.need;
            const paceOk = rule.alt.needs.every(([sid, bar]) => (played ? (val(p.id, sid) / played) * SEASON_GAMES : 0) >= bar);
            if (best.avg <= altNeed && paceOk) { status = "on"; via = `Dual-threat route: on pace for ${rule.alt.note}`; }
          }
          if (status === "on" && gp + left < startsNeeded) status = "blocked";
        }
        const seen = new Set<StatId>();
        const stats = best.set.map((sid, i) => ({ id: sid, value: val(p.id, sid), rank: best.ranks[i] })).filter((s) => !seen.has(s.id) && seen.add(s.id));
        rows.push({ p, group: rule.group, pos, avg: best.avg, need: t?.need ?? null, next: t?.next ?? null, status, via, gp, left, startsNeeded, stats, cut: rule.cut, alt: rule.alt });
      }
    }
  }
  return rows;
}

export const STATUS_ORDER: Record<DevStatus, number> = { on: 0, blocked: 1, close: 2, no: 3, maxed: 4 };
