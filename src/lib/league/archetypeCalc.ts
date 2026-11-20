// Archetype calculator math. Pure functions with the data passed in, so the
// calculator can run in the browser while the player's ratings are edited.
// Same rules as abilities.ts (eligibleAbilities / archetypeScores), which stays
// the server-side source for the Abilities pages.
import { RATING_KEYS } from "./ratings";

export type CalcFormula = { w: Record<string, number>; b: number };
export type CalcArch = { positions: Record<string, string>; groups: Record<string, Record<string, CalcFormula>> };
export type CalcTierName = "Bronze" | "Silver" | "Gold" | "Single";
export type CalcReq = [type: "arch" | "rating" | "ovr", key: string, min: number];
export type CalcTier = { tier: CalcTierName; pos: string[]; slots: number[] | null; reqs: CalcReq[] };
export type CalcAbility = { key: string; title: string; kind: string; tiers: CalcTier[] };
export type CalcSlot = { ovr: number; locked: boolean };

const idx = (k: string) => RATING_KEYS.indexOf(k as never);

/** Archetype ratings for a position from a full ratings array (unrounded). */
export function archetypeScores(arch: CalcArch, pos: string, ratings: number[]): Record<string, number> | null {
  const g = arch.positions[pos];
  const f = g ? arch.groups[g] : null;
  if (!f) return null;
  return Object.fromEntries(Object.entries(f).map(([name, x]) => [name, Object.entries(x.w).reduce((a, [k, w]) => a + w * (ratings[idx(k)] ?? 0), x.b)]));
}

/** Overall = the best archetype rating, rounded. */
export const bestOf = (s: Record<string, number>) => Object.entries(s).sort((a, b) => b[1] - a[1])[0];

/**
 * Ability slot unlock overalls for a dev trait (0 = the X-Factor slot).
 * Keeps the player's own slots when the dev trait is unchanged; otherwise uses the
 * layouts seen in league data (Superstar 75/80/85; X-Factor QB 70–90, others 75/80/85/95).
 */
export function slotLayout(dev: number, pos: string, own: number[] | null, ownDev: number): { slots: number[]; estimated: boolean } {
  if (dev < 2) return { slots: [], estimated: false };
  if (own && own.length && dev === ownDev) return { slots: own, estimated: false };
  if (own && own.length && dev === 2 && ownDev === 3) return { slots: own.filter((s) => s > 0), estimated: false };
  if (dev === 2) return { slots: [75, 80, 85], estimated: true };
  return { slots: pos === "QB" ? [0, 70, 75, 80, 85, 90] : [0, 75, 80, 85, 95], estimated: true };
}

/** Slots numbered the way ability requirements count them; a numbered slot is open once overall reaches its unlock. */
export function numberSlots(slots: number[], ovr: number) {
  const numbered = slots.filter((s) => s > 0).sort((a, b) => a - b).map((s, i) => ({ n: i + 1, unlock: s, open: ovr >= s }));
  return { xf: slots.includes(0), numbered };
}

export type CalcShortfall = { label: string; key: string; min: number; have: number | null };
export type CalcEligibility = { ability: CalcAbility; tier: CalcTierName; borderline: boolean; next: { tier: CalcTierName; missing: CalcShortfall[] } | null };
export type CalcNear = { ability: CalcAbility; tier: CalcTierName; missing: CalcShortfall[] };

const TIER_ORDER: CalcTierName[] = ["Bronze", "Silver", "Gold"];

type Input = { pos: string; ovr: number; dev: number; ratings: number[]; scores: Record<string, number> | null; slots: number[]; labels: Record<string, string> };

function check(t: CalcTier, p: Input, slotOk: (s: number[] | null) => boolean) {
  const missing: CalcShortfall[] = [];
  let borderline = false;
  for (const [type, key, min] of t.reqs) {
    if (type === "ovr") { if (p.ovr < min) missing.push({ label: "Overall", key: "ovr", min, have: p.ovr }); continue; }
    if (type === "rating") {
      const have = p.ratings[idx(key)] ?? null;
      if (have == null || have < min) missing.push({ label: p.labels[key] || key, key, min, have });
      continue;
    }
    const s = p.scores?.[key];
    if (s == null) { missing.push({ label: `${key} archetype`, key: `arch:${key}`, min, have: null }); continue; }
    if (Math.abs(s - min) < 1) borderline = true;
    if (Math.round(s) < min) missing.push({ label: `${key} archetype`, key: `arch:${key}`, min, have: Math.round(s) });
  }
  if (!slotOk(t.slots)) missing.push({ label: t.slots ? `Ability slot ${t.slots.join(" or ")} unlocked` : "X-Factor slot", key: "slot", min: 0, have: null });
  return { ok: missing.length === 0, missing, borderline };
}

/** What the player qualifies for, plus abilities he's close to (Bronze/X-Factor missing at most `nearMax` requirements). */
export function abilityEligibility(abilities: CalcAbility[], p: Input, nearMax = 2): { eligible: CalcEligibility[]; near: CalcNear[] } {
  const { xf, numbered } = numberSlots(p.slots, p.ovr);
  const open = new Set(numbered.filter((s) => s.open).map((s) => s.n));
  const eligible: CalcEligibility[] = [];
  const near: CalcNear[] = [];
  for (const a of abilities) {
    const tiers = a.tiers.filter((t) => t.pos.includes(p.pos));
    if (!tiers.length) continue;
    const xfactor = a.kind === "X-Factor";
    if (xfactor && p.dev !== 3) continue;
    if (!p.slots.length) continue;
    const slotOk = (s: number[] | null) => (xfactor ? xf : (s || []).some((n) => open.has(n)));
    const ladder = xfactor ? tiers : (TIER_ORDER.map((n) => tiers.find((t) => t.tier === n)).filter(Boolean) as CalcTier[]);
    let best: CalcTierName | null = null, borderline = false, next: CalcEligibility["next"] = null;
    for (const t of ladder) {
      const r = check(t, p, slotOk);
      if (r.ok) { best = t.tier; borderline = borderline || r.borderline; continue; }
      if (best) next = { tier: t.tier, missing: r.missing };
      else if (r.missing.length <= nearMax) near.push({ ability: a, tier: t.tier, missing: r.missing });
      break;
    }
    if (best) eligible.push({ ability: a, tier: best, borderline, next });
  }
  const rank = (t: CalcTierName) => (t === "Single" ? 4 : TIER_ORDER.indexOf(t) + 1);
  eligible.sort((x, y) => rank(y.tier) - rank(x.tier) || x.ability.title.localeCompare(y.ability.title));
  near.sort((x, y) => x.missing.length - y.missing.length || x.ability.title.localeCompare(y.ability.title));
  return { eligible, near };
}

export const tierRank = (t: CalcTierName | null | undefined) => (!t ? 0 : t === "Single" ? 4 : TIER_ORDER.indexOf(t) + 1);

// ---- Fastest path -----------------------------------------------------------
// Fewest rating points to reach an overall, an archetype rating or an ability tier.
// Archetype ratings are linear in the ratings, so the cheapest way to raise one is to
// spend points where its weight is highest. With several targets at once (an ability
// needing two archetypes plus an overall), each point goes where it helps the unmet
// targets most, then any point that isn't needed is taken back.

/** Ratings the league store can't raise (NCL rules). */
export const STORE_LOCKED = ["throwPowerRating", "speedRating", "accelRating", "agilityRating", "changeOfDirectionRating", "strengthRating", "jumpRating"];
export type PathRules = { cap: number; locked: string[] };
export type PathTarget =
  | { kind: "ovr"; min: number }
  | { kind: "arch"; name: string; min: number }
  | { kind: "ability"; key: string; tier: CalcTierName };
export type PathStep = { key: string; from: number; to: number };
export type PathResult =
  | { ok: true; ratings: number[]; steps: PathStep[]; points: number; via: string | null }
  | { ok: false; reason: string };
type PathInput = { arch: CalcArch; pos: string; dev: number; ratings: number[]; offset: number; slots: number[]; abilities: CalcAbility[]; labels: Record<string, string> };

const EPS = 1e-9;
const score = (f: CalcFormula, r: number[]) => Object.entries(f.w).reduce((a, [k, w]) => a + w * (r[idx(k)] ?? 0), f.b);

function solve(start: number[], mins: Map<number, number>, cons: { f: CalcFormula; t: number }[], rules: PathRules, labels: Record<string, string>): { r: number[] } | { reason: string } {
  const locked = new Set(rules.locked.map(idx));
  const cap = (i: number) => (locked.has(i) ? start[i] : Math.max(start[i], rules.cap));
  const r = [...start];
  for (const [i, min] of mins) {
    if (r[i] >= min) continue;
    if (min > cap(i)) return { reason: `needs ${labels[RATING_KEYS[i]] || RATING_KEYS[i]} ${min}${locked.has(i) ? ", which the store can't raise" : `, above the ${rules.cap} cap`}` };
    r[i] = min;
  }
  const weights = cons.map((c) => Object.entries(c.f.w).map(([k, w]) => [idx(k), w] as const).filter(([i, w]) => i >= 0 && w > 0));
  const met = (rr: number[]) => cons.map((c) => score(c.f, rr) >= c.t - EPS);
  for (let guard = 0; guard < 6000; guard++) {
    const m = met(r);
    if (m.every(Boolean)) break;
    const gain = new Map<number, number>();
    cons.forEach((_, ci) => { if (!m[ci]) for (const [i, w] of weights[ci]) if (r[i] < cap(i)) gain.set(i, (gain.get(i) || 0) + w); });
    let best = -1, bg = 0;
    for (const [i, g] of gain) if (g > bg) { bg = g; best = i; }
    if (best < 0) return { reason: "can't get there: the ratings that feed it are maxed out" };
    r[best]++;
  }
  // Take back points that turned out not to be needed (cheapest-weight ratings first).
  const total = (i: number) => cons.reduce((a, c) => a + (c.f.w[RATING_KEYS[i]] || 0), 0);
  const raised = r.map((v, i) => i).filter((i) => r[i] > start[i]).sort((a, b) => total(a) - total(b));
  for (const i of raised) {
    while (r[i] > start[i] && r[i] > (mins.get(i) ?? -1)) {
      r[i]--;
      if (!met(r).every(Boolean)) { r[i]++; break; }
    }
  }
  return { r };
}

/** Cheapest ratings to hit the target from `p.ratings`, or why it can't be done. */
export function fastestPath(target: PathTarget, p: PathInput, rules: PathRules): PathResult {
  const group = p.arch.positions[p.pos];
  const formulas = group ? p.arch.groups[group] : null;
  if (!formulas) return { ok: false, reason: `no archetype formulas for ${p.pos}` };
  const mins = new Map<number, number>();
  const archMins = new Map<string, number>();
  let ovrMin = 0;

  if (target.kind === "ovr") ovrMin = target.min;
  else if (target.kind === "arch") {
    if (!formulas[target.name]) return { ok: false, reason: `${p.pos} has no ${target.name} archetype` };
    archMins.set(target.name, target.min);
  } else {
    const a = p.abilities.find((x) => x.key === target.key);
    const tiers = a?.tiers.filter((t) => t.pos.includes(p.pos)) || [];
    if (!a || !tiers.length) return { ok: false, reason: `${p.pos}s can't get this ability` };
    const xfactor = a.kind === "X-Factor";
    if (xfactor && p.dev !== 3) return { ok: false, reason: "X-Factor abilities need X-Factor dev" };
    if (p.dev < 2) return { ok: false, reason: "only Superstar and X-Factor players get ability slots" };
    // A tier only counts once every tier below it is met, so take the requirements of the whole ladder.
    const ladder = xfactor ? tiers : (TIER_ORDER.map((n) => tiers.find((t) => t.tier === n)).filter(Boolean) as CalcTier[]);
    const upto = ladder.findIndex((t) => t.tier === target.tier);
    if (upto < 0) return { ok: false, reason: `no ${target.tier} tier at ${p.pos}` };
    const { xf, numbered } = numberSlots(p.slots, 0);
    for (const t of ladder.slice(0, upto + 1)) {
      for (const [type, key, min] of t.reqs) {
        if (type === "ovr") ovrMin = Math.max(ovrMin, min);
        else if (type === "rating") { const i = idx(key); if (i >= 0) mins.set(i, Math.max(mins.get(i) ?? 0, min)); }
        else { if (!formulas[key]) return { ok: false, reason: `needs the ${key} archetype, which ${p.pos}s don't have` }; archMins.set(key, Math.max(archMins.get(key) ?? 0, min)); }
      }
      if (xfactor) { if (!xf) return { ok: false, reason: "no X-Factor slot" }; continue; }
      const unlocks = numbered.filter((s) => (t.slots || []).includes(s.n)).map((s) => s.unlock);
      if (!unlocks.length) return { ok: false, reason: `needs ability slot ${(t.slots || []).join(" or ")}, which he doesn't have` };
      ovrMin = Math.max(ovrMin, Math.min(...unlocks));
    }
  }

  const base = [...archMins].map(([name, min]) => ({ f: formulas[name], t: min - 0.5 }));
  // Overall is the best archetype (plus calibration), so try reaching it through each one and keep the cheapest.
  const routes: (string | null)[] = ovrMin > 0 ? Object.keys(formulas) : [null];
  let best: { r: number[]; points: number; via: string | null } | null = null;
  let reason = "can't get there";
  for (const via of routes) {
    const cons = via ? [...base, { f: formulas[via], t: ovrMin - p.offset - 0.5 }] : base;
    const s = solve(p.ratings, mins, cons, rules, p.labels);
    if ("reason" in s) { reason = s.reason; continue; }
    const points = s.r.reduce((a, v, i) => a + v - p.ratings[i], 0);
    if (!best || points < best.points) best = { r: s.r, points, via };
  }
  if (!best) return { ok: false, reason };
  const steps = best.r.map((v, i) => ({ key: RATING_KEYS[i], from: p.ratings[i], to: v })).filter((s) => s.to !== s.from).sort((a, b) => b.to - b.from - (a.to - a.from));
  // If the overall was already there, don't credit an archetype for it.
  const startBest = Math.round(bestOf(Object.fromEntries(Object.entries(formulas).map(([n, f]) => [n, score(f, p.ratings)])))[1]) + p.offset;
  return { ok: true, ratings: best.r, steps, points: best.points, via: ovrMin > startBest ? best.via : null };
}
