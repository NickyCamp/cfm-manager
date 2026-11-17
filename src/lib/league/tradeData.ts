// Builds the Trade Tool's data from a league (server side): every rostered player's cap
// numbers by season plus his trade grade, and every team's cap rows. Used by the Trade Tool
// page and by the Discord trade proposal, so both show the same numbers.
import type { LeagueData, Player } from "./types";
import { capSeason, committedByTeam, nextDraftYear, PROJECTION_YEARS } from "./derive";
import { isCapSet, leagueCap, MAX_BONUS_PRORATION_YEARS, projectedLeagueCap } from "./cap";
import { projectPlayer } from "./projection";
import { RATING_KEYS } from "./ratings";
import { playerValue, PHYSICAL, TRAIT_WEIGHTS, tradeGroup, type TradePlayer, type TradeTeam } from "./tradeMath";

const IDX = new Map<string, number>(RATING_KEYS.map((k, i) => [k, i]));
const trait = (p: Player, key: string) => (key === "height" ? p.height : key === "weight" ? p.weight : p.ratings?.[IDX.get(key) ?? -1] ?? 0);

/** Percentile (0-100, ties share the middle rank) of v among sorted values. */
function pctOf(sorted: number[], v: number) {
  if (sorted.length <= 1) return 50;
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m; }
  let top = lo;
  while (top < sorted.length && sorted[top] === v) top++;
  return (((lo + top - 1) / 2) / (sorted.length - 1)) * 100;
}

/**
 * Each player's user rating (UR, 1-99): his percentile among the league's players at his
 * position group on the group's weighted traits (TRAIT_WEIGHTS), each trait itself scored as a
 * percentile. Players without ratings (older data) fall back to OVR.
 */
export function gradePlayers(players: Player[]) {
  const out = new Map<number, { g: string; ur: number; phys: number }>();
  const byGroup = new Map<string, Player[]>();
  for (const p of players) {
    const g = tradeGroup(p.pos);
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push(p);
  }
  for (const [g, ps] of byGroup) {
    const weights = Object.entries(TRAIT_WEIGHTS[g] || { ovr: 1 });
    const rated = ps.every((p) => p.ratings?.length);
    const keys = rated ? weights : [["ovr", 1] as [string, number]];
    const sorted = new Map(keys.map(([k]) => [k, ps.map((p) => (k === "ovr" ? p.ovr : trait(p, k))).sort((x, y) => x - y)]));
    const total = keys.reduce((s, [, w]) => s + w, 0);
    const comp = ps.map((p) => {
      let s = 0, phys = 0, physW = 0;
      for (const [k, w] of keys) {
        const pc = pctOf(sorted.get(k)!, k === "ovr" ? p.ovr : trait(p, k));
        s += w * pc;
        if (PHYSICAL.has(k)) { phys += w * pc; physW += w; }
      }
      return { p, c: s / total, phys: physW ? phys / physW : 0 };
    });
    const cs = comp.map((x) => x.c).sort((x, y) => x - y);
    for (const x of comp) out.set(x.p.id, { g, ur: Math.max(1, Math.min(99, Math.round(pctOf(cs, x.c)))), phys: Math.round(x.phys) });
  }
  return out;
}

const RATING = (k: string) => IDX.get(k) ?? -1;

export function buildTradeData(d: LeagueData) {
  const year = capSeason(d);
  const baseCap = leagueCap(d.teams);
  const years = Array.from({ length: PROJECTION_YEARS + 1 }, (_, i) => year + i);
  const firstDraft = nextDraftYear(d);
  const draftYears = [0, 1, 2].map((k) => firstDraft + k);

  const rostered = d.players.filter((p) => !p.gone && p.team);
  const grades = gradePlayers(rostered);
  const proj = new Map(rostered.map((p) => [p.id, projectPlayer(p, year)]));
  const committed = committedByTeam(d, years, proj);
  const active = new Map<number, number>();
  const players: TradePlayer[] = [];
  for (const p of rostered) {
    const pr = proj.get(p.id)!;
    const c = p.contract;
    if (!p.ps) active.set(p.team, (active.get(p.team) || 0) + 1);
    // His bonus share in each season he's signed for: the deal's bonus spread
    // over up to 5 seasons, never more than what's left to charge (the penalty
    // also covers void-year bonus after the deal ends).
    const L = Math.floor(c.length), el = L - c.yearsLeft, P = Math.min(L, MAX_BONUS_PRORATION_YEARS);
    const B = P ? c.bonus / P : 0;
    const voidLeft = years.reduce((a, y) => a + (pr.dead[y] || 0), 0);
    let left = Math.max(0, c.releasePenalty - voidLeft);
    const hits = years.map((y) => Math.round(pr.hits[y] || 0));
    const bonus = years.map((y, k) => {
      if (!pr.hits[y] || el + k >= P) return 0;
      const s = Math.min(B, hits[k], left);
      left -= s;
      return Math.round(s);
    });
    const gr = grades.get(p.id)!;
    const base = { g: gr.g, ur: gr.ur, age: p.age, dev: p.dev, yl: c.yearsLeft, ps: p.ps };
    players.push({
      id: p.id, n: `${p.first} ${p.last}`, pos: p.pos, t: p.team, age: p.age, ovr: p.ovr, dev: p.dev, ps: p.ps,
      yl: c.yearsLeft, hits, bonus, dead: years.map((y) => Math.round(pr.dead[y] || 0)), pen: c.releasePenalty,
      g: gr.g, ur: gr.ur, v: Math.round(playerValue(base, hits[0] / baseCap) * 10) / 10,
      spd: p.ratings?.[RATING("speedRating")] ?? 0, acc: p.ratings?.[RATING("accelRating")] ?? 0, h: p.height, w: p.weight,
    });
  }

  // Projected 1st-round slot: worst record picks first (win %, then points for/against).
  const order = [...d.teams].sort((x, y) => x.rec.pct - y.rec.pct || (x.rec.pf - x.rec.pa) - (y.rec.pf - y.rec.pa));
  const slot = new Map(order.map((t, i) => [t.id, i + 1]));
  const teams: TradeTeam[] = [...d.teams].sort((a, b) => a.city.localeCompare(b.city)).map((t) => ({
    id: t.id, abbr: t.abbr, name: `${t.city} ${t.name}`, primary: t.primary, active: active.get(t.id) || 0,
    committed: committed.get(t.id)!, slot: slot.get(t.id) || 16,
    cap: years.map((y, i) => (i === 0 ? t.cap.room : projectedLeagueCap(baseCap, year, y, d.knownCaps))),
  }));

  return { year, years, firstDraft, draftYears, capSet: years.map((y) => isCapSet(year, y, d.knownCaps)), players, teams };
}
export type TradeData = ReturnType<typeof buildTradeData>;

/** Parses the Trade Tool's query (?a=NYJ&b=PIT&pa=1,2&pb=3&ka=2028-1&kb=...) into sides. */
export function parseTrade(td: Pick<TradeData, "teams" | "players">, q: Record<string, string | undefined>) {
  const ids = (s?: string) => (s || "").split(",").map(Number).filter((n) => n > 0);
  const picks = (s?: string) => (s || "").split(",").map((x) => x.split("-").map(Number)).filter(([y, r]) => y > 2000 && r >= 1 && r <= 7).map(([y, r]) => ({ y, r }));
  const a = td.teams.find((t) => t.abbr === q.a)?.id ?? null, b = td.teams.find((t) => t.abbr === q.b)?.id ?? null;
  const team = new Map(td.players.map((p) => [p.id, p.t]));
  return {
    a: { team: a, players: ids(q.pa).filter((id) => team.get(id) === a), picks: picks(q.ka) },
    b: { team: b, players: ids(q.pb).filter((id) => team.get(id) === b), picks: picks(q.kb) },
  };
}
