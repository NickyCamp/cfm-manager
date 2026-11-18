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
