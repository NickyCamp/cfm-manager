// League transaction log (added 2026-11-16, Nick's request).
//
// EA's export only shows the league as it is right now, so moves are found by
// comparing each sync with the one before it. The worker appends what changed to
// league-data/<slug>/history.json.gz; the Transactions tab reads it, and the cap
// projections use its restructures (a restructure is invisible in EA's totals
// without the deal as it was before).
//
// Caught: signings, releases, extensions/new deals, restructures, trades (one
// event per player; a trade's players share the same sync and team pair), the
// draft class arriving, retirements, dev trait changes and overall changes
// (merged per league week), and position changes (since 2026-11-18). Practice-squad shuffles are left out.

import type { Contract, LeagueData, Player, Restructure } from "./types";

/** length, years left, total salary, total bonus, cap hit */
export type C = [number, number, number, number, number];

export type TxKind =
  | "signed" | "released" | "extended" | "restructured" | "trade"
  | "drafted" | "retired" | "expired" | "dev" | "rating" | "position";

export type TxWeek = { year: number; stage: number; week: number; title: string };

export type TxEvent = {
  id: string;
  kind: TxKind;
  at: string | null;          // the sync that first saw it (null: imported, time unknown)
  wk: TxWeek;                 // league week it happened in
  p: number;                  // EA roster id (0 when an imported player couldn't be matched)
  name: string; pos: string; age: number; ovr: number; dev: number;
  from?: number; to?: number; // team ids, 0 = free agent
  before?: C; after?: C;
  caps?: [number, number];    // seasons the before/after contracts describe (capYear)
  change?: [number, number];  // dev or overall, from → to
  /** Position changes (added 2026-11-18 for the rule audits): from → to, and the player just before the move. */
  move?: [string, string];
  snap?: { wt: number; ht: number; age: number; r?: number[] };
  /** Trades imported from MyMadden's trade log: everything each team received, picks included. */
  deal?: { teams: [number, number]; got: Record<string, { name?: string; pos?: string; pick?: string }[]> };
  src?: "ncl-site";
};

export type LeagueHistory = { version: 1; trackedSince: string; events: TxEvent[] };

/** One synced trade = its players' events from the same sync between the same two teams; this is its id. */
export const tradeKey = (e: Pick<TxEvent, "at" | "from" | "to">) => `${e.at}:${[e.from || 0, e.to || 0].sort((a, b) => a - b).join("-")}`;
/** Draft picks a commissioner added to a synced trade (EA's export has none), by tradeKey, then the
 *  receiving team's id: leagues.settings.tradePicks (Nick, 2026-11-17). */
export type TradePicks = Record<string, Record<string, string[]>>;

const capOf = (d: LeagueData) => d.season.capYear ?? d.season.year;
export const toC = (c: Contract): C => [c.length, c.yearsLeft, c.salary, c.bonus, c.capHit];
export const fromC = (c: C): Contract => ({ length: c[0], yearsLeft: c[1], salary: c[2], bonus: c[3], capHit: c[4], releasePenalty: 0, releaseSavings: 0 });
export const weekKey = (w: TxWeek) => `${w.year}:${w.stage}:${w.week}`;
const weekOf = (d: LeagueData): TxWeek => ({ year: d.season.year, stage: d.season.stage, week: d.season.week, title: d.season.title });

/** Order of league weeks: year, then preseason < season < offseason. */
export const weekOrder = (w: TxWeek) => w.year * 10_000 + w.stage * 100 + w.week;

/** What changed between two builds of a league. */
export function diffLeague(prev: LeagueData | null, next: LeagueData, at: string): TxEvent[] {
  if (!prev || prev.pulledAt === next.pulledAt) return []; // nothing new (a rebuild of the same pull)
  const wk = weekOf(next);
  const before = new Map(prev.players.filter((p) => !p.gone).map((p) => [p.id, p]));
  // Contracts ticked down a season between the two pulls (Madden's offseason rollover)?
  // Checked on the contracts themselves, since an older build may not carry capYear.
  let tick = 0;
  if (capOf(next) > capOf(prev) || prev.season.year < next.season.year) {
    let both = 0, ticked = 0;
    for (const p of next.players) {
      const o = before.get(p.id);
      if (!o || !o.team || o.contract.yearsLeft < 1 || p.gone) continue;
      both++;
      if (p.contract.length === o.contract.length && p.contract.yearsLeft === o.contract.yearsLeft - 1) ticked++;
    }
    tick = both && ticked / both > 0.5 ? 1 : 0;
  }
  const caps: [number, number] = [capOf(next) - tick, capOf(next)];
  const out: TxEvent[] = [];
  const ev = (kind: TxKind, p: Player, extra: Partial<TxEvent> = {}) => out.push({
    id: `${at}:${kind}:${p.id}`, kind, at, wk, p: p.id, name: `${p.first} ${p.last}`, pos: p.pos, age: p.age, ovr: p.ovr, dev: p.dev, ...extra,
  });
  const seen = new Set<number>();

  for (const p of next.players) {
    if (p.gone) continue;
    seen.add(p.id);
    const o = before.get(p.id);
    if (!o) {
      if (p.yearsPro === 0) ev("drafted", p, { to: p.team, after: toC(p.contract) });
      else if (p.team && !p.ps) ev("signed", p, { from: 0, to: p.team, after: toC(p.contract) });
      continue;
    }
    if (o.dev !== p.dev) ev("dev", p, { change: [o.dev, p.dev], to: p.team });
    if (o.ovr !== p.ovr) ev("rating", p, { change: [o.ovr, p.ovr], to: p.team });
    if (o.pos !== p.pos && p.team && o.team) {
      ev("position", p, { move: [o.pos, p.pos], to: p.team, dev: o.dev, snap: { wt: o.weight, ht: o.height, age: o.age, r: o.ratings } });
    }

    const c = p.contract, oc = o.contract;
    const newDeal = c.length !== oc.length || c.yearsLeft > oc.yearsLeft - tick;
    const moved = c.salary !== oc.salary || c.bonus !== oc.bonus;
    const deal = { before: toC(oc), after: toC(c), caps };
    if (o.team !== p.team) {
      if (!p.team) {
        if (o.ps) continue;
        ev(tick && oc.yearsLeft <= tick ? "expired" : "released", p, { from: o.team, to: 0, before: toC(oc) });
      } else if (!o.team) {
        if (!p.ps) ev("signed", p, { from: 0, to: p.team, ...deal });
      } else if (o.ps || p.ps) {
        if (!p.ps) ev("signed", p, { from: o.team, to: p.team, ...deal });
      } else if (newDeal || moved) {
        // A traded player keeps his contract exactly. A different deal on a team-to-team move means
        // he was cut and signed elsewhere between two syncs (Nick, 2026-11-19: those read as trades).
        ev("released", p, { from: o.team, to: 0, before: toC(oc) });
        ev("signed", p, { from: 0, to: p.team, ...deal });
      } else {
        ev("trade", p, { from: o.team, to: p.team, ...deal });
      }
      continue;
    }
    if (!p.team || p.ps || o.ps) continue;
    if (newDeal) { ev("extended", p, { to: p.team, ...deal }); continue; }
    if (moved) {
      const totalSame = Math.abs(c.salary + c.bonus - (oc.salary + oc.bonus)) <= Math.max(50_000, 0.005 * (oc.salary + oc.bonus));
      ev(totalSame && c.bonus > oc.bonus ? "restructured" : "extended", p, { to: p.team, ...deal });
    }
  }
  for (const o of before.values()) {
    if (seen.has(o.id) || !o.team) continue;
    ev("retired", o, { from: o.team, to: 0, before: toC(o.contract) });
  }
  return out;
}

/**
 * Adds a sync's events. Overall and dev changes are kept as one event per player
 * per league week (first value → latest value), so several syncs in a week don't
 * pile up, and a change that reverses itself disappears.
 */
export function appendEvents(h: LeagueHistory, events: TxEvent[]): LeagueHistory {
  const merged = [...h.events];
  const idx = new Map<string, number>();
  merged.forEach((e, i) => { if (e.kind === "rating" || e.kind === "dev") idx.set(`${e.kind}:${e.p}:${weekKey(e.wk)}`, i); });
  const drop = new Set<number>();
  for (const e of events) {
    if (e.kind === "rating" || e.kind === "dev") {
      const k = `${e.kind}:${e.p}:${weekKey(e.wk)}`;
      const i = idx.get(k);
      if (i != null && merged[i].change) {
        const first = merged[i].change![0];
        merged[i] = { ...merged[i], ovr: e.ovr, dev: e.dev, age: e.age, to: e.to, change: [first, e.change![1]] };
        if (first === e.change![1]) drop.add(i); else drop.delete(i);
        continue;
      }
      idx.set(k, merged.length);
    }
    merged.push(e);
  }
  return { ...h, events: merged.filter((_, i) => !drop.has(i)) };
}

/**
 * The restructure behind each player's current deal, when the log saw it:
 * the latest restructure whose resulting deal is still his deal.
 */
export function restructures(h: LeagueHistory | null): Map<number, { e: TxEvent }> {
  const out = new Map<number, { e: TxEvent }>();
  if (!h) return out;
  for (const e of h.events) if (e.kind === "restructured" && e.p && e.before && e.after && e.caps) out.set(e.p, { e });
  return out;
}

/** Sets player.restructure for players still on the deal a logged restructure produced. */
export function attachRestructures(d: LeagueData, h: LeagueHistory | null) {
  const map = restructures(h);
  if (!map.size) return;
  const near = (a: number, b: number) => Math.abs(a - b) <= 20_000;
  for (const p of d.players) {
    const r = map.get(p.id);
    if (!r) continue;
    const { e } = r;
    const a = e.after!, c = p.contract;
    const elapsed = capOf(d) - e.caps![1];
    if (a[0] !== c.length || !near(a[2], c.salary) || !near(a[3], c.bonus) || a[1] - elapsed !== c.yearsLeft) continue;
    const x: Restructure = { before: fromC(e.before!), fromYear: e.caps![0], year: e.caps![1] };
    p.restructure = x;
  }
}

// ---------- imported history (NCL, from the old NCL site's logs) ----------

/** A seed event names its player by name + birthday and its teams by abbreviation; mapped on first use. */
export type SeedEvent = Omit<TxEvent, "p" | "from" | "to" | "deal"> & {
  who?: { first: string; last: string; born: string | null };
  fromAbbr?: string; toAbbr?: string;
  deal?: { teams: [string, string]; got: Record<string, { name?: string; pos?: string; pick?: string }[]> };
};

export function seedHistory(seed: { trackedSince: string; events: SeedEvent[] }, d: LeagueData): LeagueHistory {
  const teamId = new Map(d.teams.map((t) => [t.abbr.toUpperCase(), t.id]));
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  const byBorn = new Map<string, Player[]>();
  const byName = new Map<string, Player[]>();
  for (const p of d.players) {
    if (p.born) byBorn.set(p.born, [...(byBorn.get(p.born) || []), p]);
    const k = norm(p.first + p.last);
    byName.set(k, [...(byName.get(k) || []), p]);
  }
  const find = (w: SeedEvent["who"]): number => {
    if (!w) return 0;
    const cands = (w.born && byBorn.get(w.born)) || [];
    const hit = cands.find((p) => norm(p.last) === norm(w.last)) || cands.find((p) => norm(p.first + p.last) === norm(w.first + w.last));
    if (hit) return hit.id;
    const named = byName.get(norm(w.first + w.last)) || [];
    return named.length === 1 ? named[0].id : 0;
  };
  const events: TxEvent[] = seed.events.map((s) => {
    const { who, fromAbbr, toAbbr, deal, ...rest } = s;
    const e: TxEvent = { ...rest, p: find(who), src: "ncl-site" };
    if (fromAbbr != null) e.from = fromAbbr ? teamId.get(fromAbbr) ?? 0 : 0;
    if (toAbbr != null) e.to = toAbbr ? teamId.get(toAbbr) ?? 0 : 0;
    if (deal) {
      const ids = deal.teams.map((a) => teamId.get(a) ?? 0) as [number, number];
      e.deal = { teams: ids, got: Object.fromEntries(Object.entries(deal.got).map(([a, v]) => [String(teamId.get(a) ?? 0), v])) };
    }
    return e;
  });
  return { version: 1, trackedSince: seed.trackedSince, events };
}
