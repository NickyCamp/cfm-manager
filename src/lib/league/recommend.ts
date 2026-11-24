// Recommended contract: what a player will likely get on his next deal. Pure; runs in the browser.
//
// Reworked 2026-11-24 (Nick: "align the projected contracts with what players are actually being
// extended at"). The old version priced every player off the best-paid peer in the league's current
// contracts (+2%) and never let a 29-or-under player drop below his current deal. Checked against the
// 165 in-game extensions logged in NCL and EML27 (Oct–Nov 2026), it was off by 31% on average and within
// 20% only 47% of the time: one outlier deal set the price for a whole tier, and players on big imported
// real-NFL deals were re-signed for far less than the floor said (Rodgers $21.8M/yr → $9.3M, McKinstry
// $36.5M → $14.9M).
//
// Madden prices an extension off the player himself, not the market: position, overall, dev trait and
// length explain most of it. The fit below (log of new money per year, leave-one-out over the 165
// extensions) is off by 18% on average and within 20% for 70% of them.
//
//   per year = e^(base + group + slope·(ovr−85) + dev·devTrait + len·(years−4)) × leagueCap / REF_CAP
//   slope: 0.093 per point below 85, 0.060 above (+ a small per-position tweak; QBs climb fastest)
//
// Each league then nudges that by its own logged extensions (askCalibration): the median miss, shrunk
// toward zero until a league has a few dozen, overall and per position group. Length follows what
// teams actually sign by age; the bonus share is the league's median from its extensions (47% if few).
// The league's current contracts at his level are still listed as context, but no longer set the price.

import { calculateOffer } from "./cap";
import type { AskCalibration, LoggedExtension } from "./types";

export type { AskCalibration, LoggedExtension };

export type MarketPlayer = {
  id: number; n: string; pos: string; t: number; age: number; ovr: number; ps: boolean; yp: number; dev?: number;
  c: [length: number, yearsLeft: number, salary: number, bonus: number, capHit: number];
};

const GROUP: Record<string, string> = {
  LEDG: "EDGE", REDG: "EDGE", LT: "OT", RT: "OT", LG: "IOL", RG: "IOL", C: "IOL",
  FS: "S", SS: "S", SAM: "OLB", WILL: "OLB", HB: "RB", FB: "RB",
};
const GROUP_LABEL: Record<string, string> = {
  EDGE: "edge rushers", OT: "tackles", IOL: "interior linemen", S: "safeties", OLB: "outside linebackers", RB: "running backs",
  QB: "quarterbacks", WR: "receivers", TE: "tight ends", DT: "defensive tackles", MIKE: "middle linebackers", CB: "cornerbacks",
  K: "kickers", P: "punters", LS: "long snappers",
};
const round50k = (v: number) => Math.round(v / 50_000) * 50_000;

export const posGroup = (pos: string) => GROUP[pos] || pos;
export const groupLabel = (pos: string) => GROUP_LABEL[posGroup(pos)] || `${pos}s`;
const total = (p: MarketPlayer) => p.c[2] + p.c[3];
export const apyOf = (p: MarketPlayer) => (p.c[0] > 0 ? total(p) / p.c[0] : 0);
/** Rookie-scale deal: signed when he entered the league, 3+ years. */
export const isRookieDeal = (p: MarketPlayer) => p.c[0] >= 3 && p.c[0] - p.c[1] === p.yp;

/** Length teams actually give by age (median of the logged extensions): young players get long deals. */
export function lengthForAge(age: number) {
  return age <= 25 ? 5 : age <= 26 ? 4 : age <= 30 ? 3 : age <= 32 ? 2 : 1;
}

// ---- The extension model (fit 2026-11-24 on NCL + EML27 extensions, both leagues' cap ≈ $349.5M) ----
/** The league cap the fit was made at; asks scale with the league's cap for the season the deal starts. */
export const REF_CAP = 349_510_000;
const BASE = 16.4052;
const SLOPE_BELOW = 0.0934; // per OVR point under 85
const SLOPE_ABOVE = 0.0596; // per OVR point over 85
const DEV_STEP = 0.0366;    // per dev tier (Normal 0 … X-Factor 3)
const LEN_STEP = -0.0573;   // per year of length past 4 (longer deals pay a little less per year)
/** Per position group: [level, extra slope per OVR point]. */
const GROUP_FIT: Record<string, [number, number]> = {
  QB: [0.648, 0.0156], EDGE: [0.522, -0.0042], OT: [0.392, -0.0079], DT: [0.348, -0.0112], WR: [0.294, 0.0025],
  IOL: [0.19, -0.0067], TE: [0.084, -0.0062], CB: [0.011, 0.0067], MIKE: [-0.014, 0.0035], S: [-0.043, 0.0033],
  OLB: [-0.207, -0.0096], RB: [-0.422, -0.0101], K: [-0.498, 0.0019], P: [-0.563, 0.0098], LS: [-0.742, 0.0124],
};
const SPECIALISTS = new Set(["K", "P", "LS"]);
const DEFAULT_BONUS_SHARE = 0.47;

const capScale = (cap?: number) => (cap && cap > REF_CAP * 0.6 && cap < REF_CAP * 1.6 ? cap / REF_CAP : 1); // cap-off leagues: no scaling

/** New money per year Madden's extensions land at for this player, before any league adjustment. */
export function modelApy(pos: string, ovr: number, dev: number, length: number, cap?: number) {
  const [lvl, extra] = GROUP_FIT[posGroup(pos)] ?? [0, 0];
  const o = ovr - 85;
  const x = BASE + lvl + (SLOPE_BELOW + extra) * Math.min(o, 0) + (SLOPE_ABOVE + extra) * Math.max(o, 0)
    + DEV_STEP * dev + LEN_STEP * (Math.min(Math.max(length, 1), 9) - 4);
  const scale = capScale(cap);
  let apy = Math.exp(x) * scale;
  if (SPECIALISTS.has(posGroup(pos))) apy = Math.min(apy, 0.03 * REF_CAP * scale); // kickers top out around $10M
  return Math.max(apy, 0.003 * REF_CAP * scale);                                 // about the league minimum
}

// ---- Extensions from the transaction log ----

type Tx = { kind: string; p: number; name: string; pos: string; age: number; ovr: number; dev: number; to?: number;
  wk: { year: number; title: string }; before?: number[]; after?: number[]; caps?: [number, number] };

/**
 * Every in-game extension/re-signing in the league's transaction log, as the new money only. An extension
 * restarts the contract: EA's totals then hold the old deal's remaining years and uncharged bonus plus the
 * new deal, so those are taken back out (the old salary by its share of years left).
 */
export function loggedExtensions(events: Tx[] | undefined | null): LoggedExtension[] {
  const out: LoggedExtension[] = [];
  const seen = new Set<string>();
  for (const e of events || []) {
    if (e.kind !== "extended" || !e.before || !e.after || !e.p) continue;
    const [L, yl, sal, bon] = e.before;
    const a = e.after;
    if (a[0] !== a[1]) continue;                        // contract didn't restart: a restructure or bonus reset
    const key = `${e.p}:${a.join(",")}`;
    if (seen.has(key)) continue;                        // the same deal logged twice (imported + live)
    seen.add(key);
    const tick = e.caps && e.caps[0] < e.caps[1] ? 1 : 0; // offseason rollover between the two syncs
    const k = Math.max(0, yl - tick);                   // old-deal years still to play
    const len = a[0] - k;
    if (len < 1 || len > 10) continue;
    const oldSal = L ? (sal * k) / L : 0;
    const by = Math.min(L, 5) || 1;
    const uncharged = L ? (bon * Math.max(0, by - (L - k) - (k > 0 ? 1 : 0))) / by : 0;
    const newBonus = Math.max(0, a[3] - uncharged);
    const newTotal = a[2] - oldSal + newBonus;
    if (newTotal <= 0 || newBonus > newTotal) continue;
    out.push({
      id: e.p, n: e.name, pos: e.pos, t: e.to ?? 0, age: e.age, ovr: e.ovr, dev: e.dev, len,
      apy: Math.round(newTotal / len), bs: newBonus / newTotal, year: e.caps?.[1] ?? e.wk.year, when: `${e.wk.year} ${e.wk.title}`,
    });
  }
  return out.reverse(); // newest first
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** How far this league's own extensions sit from the model, shrunk toward none while there are few. */
export function askCalibration(exts: LoggedExtension[], capAt: (year: number) => number): AskCalibration {
  const res = exts.map((x) => ({ g: posGroup(x.pos), r: Math.log(x.apy / modelApy(x.pos, x.ovr, x.dev, x.len, capAt(x.year))) }));
  const n = res.length;
  const overall = n ? median(res.map((x) => x.r)) * (n / (n + 15)) : 0;
  const groups: Record<string, number> = {};
  for (const g of new Set(res.map((x) => x.g))) {
    const rs = res.filter((x) => x.g === g).map((x) => x.r - overall);
    groups[g] = +(median(rs) * (rs.length / (rs.length + 6))).toFixed(4);
  }
  const bs = exts.map((x) => x.bs);
  return {
    n, overall: +overall.toFixed(4), groups,
    bonusShare: n >= 6 ? Math.min(0.6, Math.max(0.2, median(bs))) : DEFAULT_BONUS_SHARE,
    exts: exts.slice(0, 400),
  };
}

export type Recommendation = {
  apy: number; length: number; total: number; bonus: number; yearlySalary: number;
  modelApy: number;            // the model before this league's adjustment
  leagueAdj: number;           // this league's multiplier (1 = no adjustment)
  basedOn: number;             // logged extensions in this league behind the adjustment
  comps: LoggedExtension[];    // recent extensions of similar players in this league
  peers: MarketPlayer[];       // current deals at his level, highest per-year first (context only)
  group: string;
};

/**
 * @param cap   the league cap for the season the new deal starts (asks scale with it)
 * @param cal   the league's extension calibration (LeagueData.askCal)
 */
export function recommend(p: MarketPlayer, all: MarketPlayer[], cal?: AskCalibration | null, cap?: number): Recommendation | null {
  if (!p.pos) return null;
  const g = posGroup(p.pos);
  const length = lengthForAge(p.age);
  const base = modelApy(p.pos, p.ovr, p.dev ?? 0, length, cap);
  const adj = Math.exp((cal?.overall ?? 0) + (cal?.groups[g] ?? 0));
  const apy = Math.max(round50k(base * adj), 50_000);
  const totalValue = apy * length;
  const bonus = round50k(totalValue * (cal?.bonusShare ?? DEFAULT_BONUS_SHARE));

  const comps = (cal?.exts || [])
    .filter((x) => x.id !== p.id && posGroup(x.pos) === g && Math.abs(x.ovr - p.ovr) <= 4)
    .map((x, i) => ({ x, score: Math.abs(x.ovr - p.ovr) + Math.abs(x.age - p.age) * 0.5 + i * 0.01 }))
    .sort((a, b) => a.score - b.score).slice(0, 4).map((c) => c.x);
  const peers = all
    .filter((x) => x.id !== p.id && posGroup(x.pos) === g && x.c[0] > 0 && total(x) > 0 && x.t && !x.ps && !isRookieDeal(x) && Math.abs(x.ovr - p.ovr) <= 3)
    .sort((a, b) => apyOf(b) - apyOf(a));

  return {
    apy, length, total: totalValue, bonus, yearlySalary: (totalValue - bonus) / length,
    modelApy: base, leagueAdj: adj, basedOn: cal?.n ?? 0, comps, peers, group: g,
  };
}

/** Year-by-year cap hits of a recommended deal (salaries rise each year, bonus spread over up to 5 years),
 *  starting the season after his current deal ends: startYear = cap season + years left (0 left = this season). */
export function askCapHits(r: Recommendation, startYear: number): { year: number; capHit: number }[] {
  return calculateOffer({ startYear, length: r.length, yearlySalary: r.yearlySalary, totalBonus: r.bonus }).rows
    .map((x) => ({ year: x.year, capHit: x.capHit }));
}
