import type { LeagueData } from "./types";
import type { LeagueHistory, TxEvent } from "./history";

/** EA sometimes renumbers every team id (NCL, 2027 offseason: 776994850 → 776732706, a shift of 2^18).
 *  Old id → new id, matched by abbreviation (then nickname), only for teams whose id changed. */
export function teamIdMap(prev: LeagueData | null, next: LeagueData): Map<number, number> {
  const m = new Map<number, number>();
  if (!prev) return m;
  const byAbbr = new Map(next.teams.filter((t) => t.abbr).map((t) => [t.abbr.toLowerCase(), t.id]));
  const byName = new Map(next.teams.filter((t) => t.name).map((t) => [t.name.toLowerCase(), t.id]));
  const now = new Set(next.teams.map((t) => t.id));
  for (const t of prev.teams) {
    if (now.has(t.id)) continue;
    const id = byAbbr.get((t.abbr || "").toLowerCase()) ?? byName.get((t.name || "").toLowerCase());
    if (id) m.set(t.id, id);
  }
  return m;
}

const re = (m: Map<number, number>) => (id: number) => m.get(id) ?? id;

/** A copy of the league with old team ids swapped for new ones everywhere it stores them. */
export function remapLeagueTeams(d: LeagueData, m: Map<number, number>): LeagueData {
  if (!m.size) return d;
  const r = re(m);
  return {
    ...d,
    teams: d.teams.map((t) => ({ ...t, id: r(t.id) })),
    players: d.players.map((p) => (p.team ? { ...p, team: r(p.team) } : p)),
    games: d.games.map((g) => ({ ...g, home: r(g.home), away: r(g.away) })),
    lines: d.lines.map((l) => ({ ...l, t: r(l.t) })),
    teamGames: d.teamGames.map((t) => ({ ...t, t: r(t.t) })),
  };
}

export function remapEvent(e: TxEvent, m: Map<number, number>): TxEvent {
  const r = re(m);
  const out: TxEvent = { ...e };
  if (e.from) out.from = r(e.from);
  if (e.to) out.to = r(e.to);
  if (e.deal) out.deal = { teams: [r(e.deal.teams[0]), r(e.deal.teams[1])], got: Object.fromEntries(Object.entries(e.deal.got).map(([k, v]) => [String(r(Number(k))), v])) };
  return out;
}

/** Repairs a log that already went through a renumbering without remapping: that sync logged nearly every
 *  rostered player as traded from his team's old id to its new id. Those fake trades give the old → new map;
 *  they are dropped and every older event's ids are rewritten. Safe to run on every sync (no-op when clean). */
export function healRenumberedLog(h: LeagueHistory, d: LeagueData): { hist: LeagueHistory; fixed: number; dropped: number } {
  const now = new Set(d.teams.map((t) => t.id));
  const bySync = new Map<string, TxEvent[]>();
  for (const e of h.events) {
    if (e.kind === "trade" && !e.deal && e.from && e.to && !now.has(e.from) && now.has(e.to)) bySync.set(e.at || "", [...(bySync.get(e.at || "") || []), e]);
  }
  const m = new Map<number, number>();
  const fake = new Set<TxEvent>();
  for (const evs of bySync.values()) {
    if (evs.length < 50) continue; // a real trade deadline never moves this many players at once
    const votes = new Map<number, Map<number, number>>();
    for (const e of evs) {
      const v = votes.get(e.from!) || new Map<number, number>();
      v.set(e.to!, (v.get(e.to!) || 0) + 1);
      votes.set(e.from!, v);
    }
    for (const [from, v] of votes) {
      const [to, n] = [...v].sort((a, b) => b[1] - a[1])[0];
      if (n >= 0.9 * [...v.values()].reduce((a, b) => a + b, 0)) m.set(from, to);
    }
    for (const e of evs) if (m.get(e.from!) === e.to) fake.add(e);
  }
  if (!m.size) return { hist: h, fixed: 0, dropped: 0 };
  let fixed = 0;
  const events = h.events.filter((e) => !fake.has(e)).map((e) => {
    const n = remapEvent(e, m);
    if (n.from !== e.from || n.to !== e.to || n.deal !== e.deal) fixed++;
    return n;
  });
  return { hist: { ...h, events }, fixed, dropped: fake.size };
}
