// /stats category [team]: the top 10 in one stat (Nick, 2026-11-13: "like /stats passing yards
// or interceptions thrown, for all those types of stats"). Regular season, from the same
// season totals as the site's Leaders page. Discord allows 25 choices, so this list stays ≤ 25.
import { passerRating, seasonTotals, type Totals } from "../league/derive";
import type { LeagueData, Player } from "../league/types";

type T = Totals & { team: number };
export type StatCat = {
  key: string;
  label: string;
  value: (t: T) => number;
  /** How the number reads, e.g. "67.4%". Defaults to a whole number with commas. */
  fmt?: (v: number) => string;
  /** A short line of context after the number, e.g. "312/463". */
  detail?: (t: T) => string;
  /** Rate stats only count players with enough volume; `games` is the most games any player has played. */
  qualifies?: (t: T, games: number) => boolean;
  minNote?: string;
};

const n = (v: number) => Math.round(v).toLocaleString("en-US");
const one = (v: number) => v.toFixed(1);
const pctf = (v: number) => `${v.toFixed(1)}%`;

export const STAT_CATS: StatCat[] = [
  // Passing
  { key: "pass_yds", label: "Passing yards", value: (t) => t.py, detail: (t) => `${t.pc}/${t.pa}` },
  { key: "pass_td", label: "Passing TDs", value: (t) => t.ptd },
  { key: "pass_int", label: "Interceptions thrown", value: (t) => t.pint, detail: (t) => `${t.pa} att` },
  { key: "comp_pct", label: "Completion %", value: (t) => (t.pa ? (t.pc / t.pa) * 100 : 0), fmt: pctf, detail: (t) => `${t.pc}/${t.pa}`, qualifies: (t, g) => t.pa >= 10 * g, minNote: "10+ attempts per game" },
  { key: "pass_rtg", label: "Passer rating", value: (t) => passerRating(t), fmt: one, detail: (t) => `${t.ptd} TD, ${t.pint} INT`, qualifies: (t, g) => t.pa >= 10 * g, minNote: "10+ attempts per game" },
  { key: "sacks_taken", label: "Sacks taken", value: (t) => t.psk },
  // Rushing
  { key: "rush_yds", label: "Rushing yards", value: (t) => t.ry, detail: (t) => `${t.ra} car` },
  { key: "rush_td", label: "Rushing TDs", value: (t) => t.rtd },
  { key: "ypc", label: "Yards per carry", value: (t) => (t.ra ? t.ry / t.ra : 0), fmt: one, detail: (t) => `${t.ra} car`, qualifies: (t, g) => t.ra >= 6 * g, minNote: "6+ carries per game" },
  { key: "broken_tackles", label: "Broken tackles", value: (t) => t.rbt },
  { key: "fumbles", label: "Fumbles", value: (t) => t.rfum },
  // Receiving
  { key: "rec", label: "Receptions", value: (t) => t.rc },
  { key: "rec_yds", label: "Receiving yards", value: (t) => t.rcy, detail: (t) => `${t.rc} rec` },
  { key: "rec_td", label: "Receiving TDs", value: (t) => t.rctd },
  { key: "yac", label: "Yards after catch", value: (t) => t.rcyac },
  { key: "drops", label: "Drops", value: (t) => t.rcdrop },
  // Defense
  { key: "tackles", label: "Tackles", value: (t) => t.tk },
  { key: "sacks", label: "Sacks", value: (t) => t.sk, fmt: (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1)) },
  { key: "def_int", label: "Interceptions (defense)", value: (t) => t.int },
  { key: "pass_def", label: "Passes defended", value: (t) => t.pd },
  { key: "ff", label: "Forced fumbles", value: (t) => t.ff },
  { key: "def_td", label: "Defensive TDs", value: (t) => t.dtd },
  // Kicking and punting
  { key: "fg_made", label: "Field goals made", value: (t) => t.fgm, detail: (t) => `${t.fgm}/${t.fga}, long ${t.fglng}` },
  { key: "fg_pct", label: "Field goal %", value: (t) => (t.fga ? (t.fgm / t.fga) * 100 : 0), fmt: pctf, detail: (t) => `${t.fgm}/${t.fga}`, qualifies: (t) => t.fga >= 10, minNote: "10+ attempts" },
  { key: "punt_avg", label: "Punting average", value: (t) => (t.pnt ? t.pnty / t.pnt : 0), fmt: one, detail: (t) => `${t.pnt} punts, ${t.pnt20} inside 20`, qualifies: (t) => t.pnt >= 15, minNote: "15+ punts" },
];

export type StatRow = { rank: number; player: Player | undefined; team: number; value: string; raw: number; detail?: string };

/** The top `limit` for one category, optionally one team's players only. Ties share a rank. */
export function statLeaders(d: LeagueData, cat: StatCat, teamId?: number, limit = 10): { rows: StatRow[]; total: number } {
  const totals = seasonTotals(d);
  const games = Math.max(1, ...[...totals.values()].map((t) => t.gp));
  const ps = new Map(d.players.map((p) => [p.id, p]));
  const list = [...totals.entries()]
    .filter(([, t]) => (teamId == null || t.team === teamId) && cat.value(t) > 0 && (!cat.qualifies || cat.qualifies(t, games)))
    .map(([id, t]) => ({ id, t, v: cat.value(t) }))
    .sort((a, b) => b.v - a.v);
  const rows: StatRow[] = [];
  list.slice(0, limit).forEach((x, i) => {
    const rank = i > 0 && Math.abs(list[i - 1].v - x.v) < 1e-9 ? rows[i - 1].rank : i + 1;
    rows.push({ rank, player: ps.get(x.id), team: x.t.team, value: (cat.fmt || n)(x.v), raw: x.v, detail: cat.detail?.(x.t) });
  });
  return { rows, total: list.length };
}
