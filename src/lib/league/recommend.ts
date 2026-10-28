// Recommended contract: what a player will likely ask for, priced off the
// league's own market. Pure; runs in the browser.
//
// Peers: same position group, signed to a team (not practice squad, not a
// rookie-scale deal). First tier with anyone in it:
//   1. within 3 OVR at or below him and 3 years of age
//   2. within 3 OVR, any age
//   3. within 6 OVR, any age
// Ask = the highest per-year among peers, +2%. A player 29 or younger won't
// take less per year than his current (non-rookie) deal. Length follows age;
// the bonus share is the median of the top peers' (capped at 60%).

export type MarketPlayer = {
  id: number; n: string; pos: string; t: number; age: number; ovr: number; ps: boolean; yp: number;
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
const BUMP = 1.02;
const round50k = (v: number) => Math.round(v / 50_000) * 50_000;

export const posGroup = (pos: string) => GROUP[pos] || pos;
export const groupLabel = (pos: string) => GROUP_LABEL[posGroup(pos)] || `${pos}s`;
const total = (p: MarketPlayer) => p.c[2] + p.c[3];
export const apyOf = (p: MarketPlayer) => (p.c[0] > 0 ? total(p) / p.c[0] : 0);
/** Rookie-scale deal: signed when he entered the league, 3+ years. */
export const isRookieDeal = (p: MarketPlayer) => p.c[0] >= 3 && p.c[0] - p.c[1] === p.yp;

export function lengthForAge(age: number) {
  return age <= 27 ? 5 : age <= 29 ? 4 : age <= 31 ? 3 : age <= 33 ? 2 : 1;
}

export type Recommendation = {
  apy: number; length: number; total: number; bonus: number; yearlySalary: number;
  peers: MarketPlayer[];      // the market, highest per-year first
  bar: MarketPlayer;          // the deal that sets his price
  tierLabel: string;          // which peer group was used
  keepsOwn: boolean;          // his current deal is above the market and he won't go lower
  group: string;
};

export function recommend(p: MarketPlayer, all: MarketPlayer[]): Recommendation | null {
  const g = posGroup(p.pos);
  const pool = all.filter((x) => x.id !== p.id && posGroup(x.pos) === g && x.c[0] > 0 && total(x) > 0 && x.t && !x.ps && !isRookieDeal(x));
  const tiers: [string, (x: MarketPlayer) => boolean][] = [
    ["within 3 OVR (at or below) and 3 years of age", (x) => x.ovr <= p.ovr && p.ovr - x.ovr <= 3 && Math.abs(x.age - p.age) <= 3],
    ["within 3 OVR, any age", (x) => Math.abs(x.ovr - p.ovr) <= 3],
    ["within 6 OVR, any age", (x) => Math.abs(x.ovr - p.ovr) <= 6],
  ];
  for (const [label, test] of tiers) {
    const peers = pool.filter(test).sort((a, b) => apyOf(b) - apyOf(a));
    if (!peers.length) continue;
    const bar = peers[0];
    const barApy = apyOf(bar);
    const ownApy = p.c[0] > 0 && total(p) > 0 && !isRookieDeal(p) ? apyOf(p) : 0;
    const floorApy = p.age <= 29 ? ownApy : 0;
    const keepsOwn = floorApy > barApy;
    const apy = round50k(Math.max(barApy, floorApy) * BUMP);
    const length = lengthForAge(p.age);
    const totalValue = apy * length;
    const shares = peers.slice(0, 8).map((x) => x.c[3] / total(x)).sort((a, b) => a - b);
    const mid = shares.length >> 1;
    const median = shares.length % 2 ? shares[mid] : (shares[mid - 1] + shares[mid]) / 2;
    const bonus = round50k(totalValue * Math.min(0.6, median || 0));
    return { apy, length, total: totalValue, bonus, yearlySalary: (totalValue - bonus) / length, peers, bar, tierLabel: label, keepsOwn, group: g };
  }
  return null;
}
