// Madden 27 abilities: what each one does (mechanics) and who qualifies.
//
// Data (built by scripts/abilities/build.py, sources in its docstring):
// - Requirements per ability and tier: position, ability slot, overall,
//   individual ratings and archetype ratings (Madden School).
// - Mechanics: Madden's trigger / effect / shutdown identifiers (ClutchTrait).
//   Overlaps = abilities that change the same effect; matchups = abilities on
//   opposite sides of the ball that push the same interaction each way.
// - Archetype formulas (archetypes.json): EA doesn't export archetype ratings
//   ("Speed Rusher 90+"), so they're estimated from the player's ratings with
//   formulas fit to two leagues' rosters (overall reproduced exactly for most
//   players; 93% of current ability holders clear their archetype minimum).
//   Calls within a point of a cutoff are marked borderline.
//
// Server-only (the data is ~185 KB).
import data from "./abilities-data.json";
import arch from "./archetypes.json";
import { RATING_KEYS, RATING_LABEL } from "./ratings";
import type { Player } from "./types";

export type TierName = "Bronze" | "Silver" | "Gold" | "Single";
type Req = [type: "arch" | "rating" | "ovr", key: string, min: number];
type Tier = { tier: TierName; pos: string[]; slots: number[] | null; reqs: Req[] };
export type Ability = {
  key: string; title: string; kind: string; ms: string | null; ct?: string; side: "offense" | "defense";
  triggers?: string[]; effects?: string[]; stops?: string[]; tiers: Tier[]; overlaps: string[]; matchups: string[];
};

export const ABILITIES: Record<string, Ability> = Object.fromEntries(
  Object.entries((data as unknown as { abilities: Record<string, Omit<Ability, "key">> }).abilities).map(([k, v]) => [k, { key: k, ...v }]),
);
export const abilityKey = (title: string) => title.toLowerCase().replace(/[^a-z0-9]/g, "");
export const findAbility = (title: string): Ability | undefined => ABILITIES[abilityKey(title)];
export const clutchTraitUrl = (a: Ability) => (a.ct ? `https://abilities.clutchtrait.com/abilities/${a.ct}` : null);
export const maddenSchoolUrl = (a: Ability) => (a.ms ? `https://www.madden-school.com/abilities/${a.ms}/` : null);

const TIER_ORDER: TierName[] = ["Bronze", "Silver", "Gold"];

// ---------- archetype ratings ----------
type Formula = { w: Record<string, number>; b: number };
const ARCH = arch as unknown as { positions: Record<string, string>; groups: Record<string, Record<string, Formula>> };

export function archetypeScores(p: Player): Record<string, number> | null {
  if (!p.ratings) return null;
  const g = ARCH.positions[p.pos];
  const formulas = g ? ARCH.groups[g] : null;
  if (!formulas) return null;
  const r = (k: string) => p.ratings![RATING_KEYS.indexOf(k as never)] ?? 0;
  return Object.fromEntries(Object.entries(formulas).map(([name, f]) => [name, Object.entries(f.w).reduce((a, [k, w]) => a + w * r(k), f.b)]));
}

// ---------- slots ----------
/** Ability slots numbered the way the requirements count them: by unlock overall, X-Factor slot apart. */
export function slotInfo(p: Player) {
  const slots = p.slots || [];
  const xf = slots.find((s) => s.ovr === 0);
  const numbered = slots.filter((s) => s.ovr > 0).sort((a, b) => a.ovr - b.ovr).map((s, i) => ({ ...s, n: i + 1 }));
  return { xf, numbered };
}

// ---------- eligibility ----------
export type Shortfall = { label: string; min: number; have: number | null; estimated?: boolean };
export type Eligibility = {
  ability: Ability;
  tier: TierName;               // best tier he qualifies for
  borderline: boolean;          // an estimated archetype rating is within a point of a cutoff
  next: { tier: TierName; missing: Shortfall[] } | null;
  has: string | null;           // tier he has it at now, if he has it
};

function checkTier(t: Tier, p: Player, scores: Record<string, number> | null, slotOk: (s: number[] | null) => boolean) {
  const missing: Shortfall[] = [];
  let borderline = false;
  for (const [type, key, min] of t.reqs) {
    if (type === "ovr") { if (p.ovr < min) missing.push({ label: "Overall", min, have: p.ovr }); continue; }
    if (type === "rating") {
      const have = p.ratings?.[RATING_KEYS.indexOf(key as never)] ?? null;
      if (have == null || have < min) missing.push({ label: RATING_LABEL[key] || key, min, have });
      continue;
    }
    const s = scores?.[key];
    if (s == null) { missing.push({ label: `${key} rating`, min, have: null, estimated: true }); continue; }
    if (Math.abs(s - min) < 1) borderline = true;
    if (Math.round(s) < min) missing.push({ label: `${key} rating`, min, have: Math.round(s), estimated: true });
  }
  if (!slotOk(t.slots)) missing.push({ label: t.slots ? `Ability slot ${t.slots.join(" or ")}` : "X-Factor slot", min: 0, have: null });
  return { ok: missing.length === 0, missing, borderline };
}

/** Every ability the player meets the requirements for (and the ones he already has). */
export function eligibleAbilities(p: Player): Eligibility[] {
  if (!p.ratings || !p.slots) return [];
  const scores = archetypeScores(p);
  const { xf, numbered } = slotInfo(p);
  const open = new Set(numbered.filter((s) => !s.locked).map((s) => s.n));
  const held = new Map((p.slots || []).filter((s) => s.title).map((s) => [abilityKey(s.title), s.tier]));
  const out: Eligibility[] = [];
  for (const a of Object.values(ABILITIES)) {
    const tiers = a.tiers.filter((t) => t.pos.includes(p.pos));
    if (!tiers.length) continue;
    const xfactor = a.kind === "X-Factor";
    if (xfactor && (p.dev !== 3 || !xf)) continue;
    const slotOk = (s: number[] | null) => (xfactor ? Boolean(xf) : (s || []).some((n) => open.has(n)));
    const ladder = xfactor ? tiers : TIER_ORDER.map((n) => tiers.find((t) => t.tier === n)).filter(Boolean) as Tier[];
    let best: TierName | null = null, borderline = false, next: Eligibility["next"] = null;
    for (const t of ladder) {
      const r = checkTier(t, p, scores, slotOk);
      if (r.ok) { best = t.tier; borderline = borderline || r.borderline; }
      else { if (best) next = { tier: t.tier, missing: r.missing }; break; }
    }
    if (!best) continue;
    out.push({ ability: a, tier: best, borderline, next, has: held.get(a.key) ?? null });
  }
  const rank = (t: TierName) => (t === "Single" ? 4 : TIER_ORDER.indexOf(t) + 1);
  return out.sort((x, y) => rank(y.tier) - rank(x.tier) || x.ability.title.localeCompare(y.ability.title));
}

// ---------- mechanics in plain words ----------
const FAMILY: Record<string, string> = {
  Running: "Ball carrying", Blocking: "Blocking", BlockingDef: "Pass rush / block shedding", Catching: "Catching",
  CatchingDef: "Coverage", Passing: "Passing", Tackle: "Tackling", Preplay: "Pre-snap", Defense: "Defense",
  General: "General", AIHint: "AI behavior", Composure: "Composure", GameModifierAbilities: "Game modifier",
};
const WORD: Record<string, string> = {
  Def: "defensive", Off: "offensive", Eng: "engaged", NonEng: "non-engaged", Dbl: "double", Mp: "contested", Acc: "accuracy",
  DefWin: "(defense wins)", OffWin: "(offense wins)", Pct: "%", Qb: "QB", Ol: "OL", Dl: "DL", Yac: "YAC", Rac: "RAC",
};
function words(s: string) {
  return s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").split(/\s+/)
    .map((w) => WORD[w] ?? w.toLowerCase()).join(" ");
}
/** e.g. "BlockingDef_PassDisengageAngle" -> { group: "Pass rush / block shedding", text: "pass disengage angle" } */
export function mechanic(id: string) {
  const [fam, ...rest] = id.split("_");
  if (!rest.length) return { group: "", text: words(fam) };
  const tail = rest.map((r) => (WORD[r] ? WORD[r] : words(r))).join(", ").replace(", (", " (");
  return { group: FAMILY[fam] || words(fam), text: tail };
}

// ---------- league-wide ----------
const cache = new WeakMap<object, Map<number, Eligibility[]>>();
/** Eligibility for every active rostered or free-agent player, computed once per loaded league. */
export function leagueEligibility(d: { players: Player[] }): Map<number, Eligibility[]> {
  let m = cache.get(d);
  if (!m) {
    m = new Map(d.players.filter((p) => !p.gone && p.ratings && p.slots?.length).map((p) => [p.id, eligibleAbilities(p)]));
    cache.set(d, m);
  }
  return m;
}

/** Positions an ability is open to, as labels. */
export function abilityPositions(a: Ability): string[] {
  const set = new Set(a.tiers.flatMap((t) => t.pos));
  const pairs: [string[], string][] = [[["LEDG", "REDG"], "EDGE"], [["LT", "RT"], "OT"], [["LG", "RG"], "OG"], [["WILL", "SAM"], "OLB"], [["FS", "SS"], "S"]];
  const out: string[] = [];
  for (const [ps, label] of pairs) if (ps.every((x) => set.has(x))) { out.push(label); ps.forEach((x) => set.delete(x)); }
  return [...out, ...set].sort();
}
