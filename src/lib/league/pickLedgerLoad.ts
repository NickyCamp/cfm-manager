// Server side: a league's pick ownership (picks.ts) from its data, transaction log and settings.
import { getLeagueData, getLeagueHistory } from "./load";
import { leagueBySlug } from "@/lib/discord/links";
import { buildPickLedger, type PickLedger, type PickMove } from "./picks";
import type { TradePicks } from "./history";
import type { LeagueData } from "./types";

export async function loadPickLedger(slug: string, d?: LeagueData | null, settings?: Record<string, unknown> | null): Promise<PickLedger | null> {
  const [data, hist, lg] = await Promise.all([
    d === undefined ? getLeagueData(slug) : Promise.resolve(d),
    getLeagueHistory(slug).catch(() => null),
    settings === undefined ? leagueBySlug(slug).catch(() => null) : Promise.resolve(null),
  ]);
  if (!data) return null;
  const s = settings ?? lg?.settings ?? {};
  return buildPickLedger({
    d: data,
    events: hist?.events || [],
    tradePicks: (s.tradePicks as TradePicks | undefined) || {},
    moves: (s.pickMoves as PickMove[] | undefined) || [],
  });
}

/** Each team's held picks for the Trade Tool: team id → [{ y, r, o }]. */
export function ownedPicks(l: PickLedger | null) {
  if (!l) return null;
  const out = new Map<number, { y: number; r: number; o: number; n?: number }[]>();
  for (const p of l.picks.values()) {
    if (!l.years.includes(p.y)) continue;
    out.set(p.owner, [...(out.get(p.owner) || []), { y: p.y, r: p.r, o: p.o, n: p.n }]);
  }
  for (const list of out.values()) list.sort((a, b) => a.y - b.y || a.r - b.r);
  return out;
}
