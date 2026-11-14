// One trade, from the site or from a Discord button: every check (membership, market open,
// kickoff, EA's live "played" flag), then play money or Tickets, then the Discord post.
import { after } from "next/server";
import { getLeagueData } from "@/lib/league/load";
import { isAwardMarket, marketBook, withAwardPlayers } from "@/lib/league/markets";
import { closeTimes, fmtET, isMember, marketsShared, memberNames, placeTrade, recordAfterTrade } from "@/lib/marketStore";
import { postBet } from "@/lib/discord/marketChannels";
import { bookKey, ticketsConfig } from "@/lib/tickets";
import { liveWeek, weekMoved } from "@/lib/eaLive";
import { requestSync } from "@/lib/sync";

export type TradeArgs = {
  slug: string; leagueId: string; userId: string; market: string; outcome: string;
  side: "yes" | "no"; kind: "buy" | "sell"; amount?: number; qty?: number;
};
export type TradeResult =
  | { ok: true; qty: number; amount: number; before: number; after: number; outcomeLabel: string; marketTitle: string; tickets: boolean; cashout: boolean }
  | { ok: false; status: number; error: string };

export async function executeTrade(a: TradeArgs): Promise<TradeResult> {
  if (!(await marketsShared())) return { ok: false, status: 503, error: "Shared trading isn't set up yet." };
  if (!(await isMember(a.leagueId, a.userId))) return { ok: false, status: 403, error: "Only members of this league can trade." };
  const amount = Number(a.amount), qty = Number(a.qty);
  if (a.kind === "buy" && !(amount > 0 && amount <= 100_000_000)) return { ok: false, status: 400, error: "Enter an amount." };
  if (a.kind === "sell" && !(qty >= 1)) return { ok: false, status: 400, error: "Nothing to sell." };

  const d = await getLeagueData(a.slug);
  if (!d) return { ok: false, status: 404, error: "No league data yet." };
  // award markets: any eligible player can be bet on, listed or not
  const m = withAwardPlayers(marketBook(d), d, [[a.market, a.outcome]]).markets.find((x) => x.key === a.market);
  const o = m?.outcomes.find((x) => x.id === a.outcome);
  if (!m || !o) return { ok: false, status: 404, error: isAwardMarket(a.market) ? "That player can't win this award (wrong side of the ball, not a rookie, or not on a team)." : "That market doesn't exist any more." };
  if (m.settled || m.closed || o.state !== "open") return { ok: false, status: 409, error: "That market has closed." };

  // Game and player-prop markets: closed at the scheduled kickoff, and the moment EA says the game was played.
  if (m.gameId) {
    const c = (await closeTimes(a.leagueId, d.season.year)).get(m.gameId);
    if (c && Date.parse(c.closeAt) <= Date.now()) return { ok: false, status: 409, error: `Betting on this game closed at kickoff (${fmtET(c.closeAt)}).` };
    const live = await liveWeek(a.slug, { fresh: true });
    if (live && (live.played.has(m.gameId) || weekMoved(live, d.season))) {
      after(() => requestSync(a.slug, { minGapMs: 10 * 60_000, mode: "auto", by: "market-close" }).then(() => {}, () => {}));
      return { ok: false, status: 409, error: "EA says this game has been played, so betting is closed. It settles at the next sync." };
    }
    if (!live && !(c && Date.parse(c.closeAt) > Date.now())) {
      return { ok: false, status: 503, error: "Couldn't check with EA that this game hasn't been played yet. Set a kickoff time for it (/kickoff) and betting stays open until then." };
    }
  }

  const tickets = await ticketsConfig(a.slug).catch(() => null);
  if (!tickets && a.kind === "buy" && amount > 100000) return { ok: false, status: 400, error: "Too much." };
  const extend = isAwardMarket(a.market) ? (ids: string[]) => withAwardPlayers(marketBook(d), d, ids.map((id) => [a.market, id] as [string, string])).markets.find((x) => x.key === a.market) : undefined;
  const r = await placeTrade({ leagueId: a.leagueId, book: bookKey(d.season.year, Boolean(tickets)), userId: a.userId, market: a.market, outcome: a.outcome, side: a.side, kind: a.kind, priced: m, amount, qty, tickets, extend });
  if (!r.ok) return { ok: false, status: 409, error: r.error };

  // Post it in the league's Discord Markets channels (if set up) and refresh the prices there.
  const uid = a.userId;
  const bk = tickets ? bookKey(d.season.year, true) : d.season.year;
  after(() => recordAfterTrade(a.leagueId, bk, m).then(() => {}, (e) => console.error("price history", (e as Error).message)));
  after(async () => {
    const who = (await memberNames([uid]).catch(() => new Map<string, string>())).get(uid) || "Someone";
    await postBet(a.slug, { who, marketKey: a.market, outcomeId: a.outcome, outcomeLabel: o.label, side: a.side, kind: a.kind, qty: r.qty, amount: r.amount, before: r.before, after: r.after })
      .catch((e) => console.error("discord bet post", (e as Error).message));
  });
  return { ok: true, qty: r.qty, amount: r.amount, before: r.before, after: r.after, outcomeLabel: o.label, marketTitle: m.title, tickets: Boolean(tickets), cashout: r.cashout };
}
