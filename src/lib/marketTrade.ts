// One trade, from the site or from a Discord button: every check (membership, market open,
// kickoff, EA's live "played" flag), then play money or Tickets, then the Discord post.
import { after } from "next/server";
import { getLeagueData } from "@/lib/league/load";
import { awardWho, isAwardMarket, marketBook, withAwardPlayers } from "@/lib/league/markets";
import { betCaps, closeTimes, economyOf, teamsOfUser, fmtET, isMember, marketsShared, memberNames, placeTrade, recordAfterTrade, betThisWeek, weekStartedAt } from "@/lib/marketStore";
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
  if (!m || !o) return { ok: false, status: 404, error: isAwardMarket(a.market) ? `That player can't win this award (it needs ${awardWho(d, a.market)}).` : "That market doesn't exist any more." };
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
  if (a.kind === "buy") {
    // Integrity (Nick, 2026-11-14): managers can't bet on their own game at all (either team or its props),
    // and can't bet against their own team anywhere else. Backing your own team in futures is fine.
    // The member's team comes from EA (the team their connected EA name controls) or league_members.team_abbr.
    // If it can't be looked up, the bet is refused rather than let through unchecked.
    let abbrs: string[];
    try { abbrs = (await teamsOfUser(a.leagueId, a.userId)).map((x) => x.toLowerCase()); }
    catch (e) { console.error("own-team check", (e as Error).message); return { ok: false, status: 503, error: "Couldn't check which team you run just now, so no bet was placed. Try again in a minute." }; }
    const mine = new Set(d.teams.filter((t) => abbrs.includes(t.abbr.toLowerCase())).map((t) => t.id));
    if (mine.size) {
      const g = m.gameId ? d.games.find((x) => x.id === m.gameId) : undefined;
      if (g && (mine.has(g.home) || mine.has(g.away))) return { ok: false, status: 403, error: "You can't bet on your own game: not either team, and not its player props." };
      if (o.team != null && mine.has(o.team) && a.side === "no") return { ok: false, status: 403, error: "You can't bet against your own team." };
    }
  }
  // the league's caps (/betcap): per bet, and per member per Madden week
  if (a.kind === "buy") {
    const caps = await betCaps(a.leagueId, Boolean(tickets));
    const fmt = (n: number) => (tickets ? `${Math.round(n).toLocaleString("en-US")} Tickets` : `$${n.toLocaleString("en-US")}`);
    if (caps.perBet != null && amount > caps.perBet) return { ok: false, status: 400, error: `The most one bet can be is ${fmt(caps.perBet)}.` };
    if (caps.perUserWeek != null) {
      const since = await weekStartedAt(a.leagueId, `${d.season.year}:${d.season.stage}:${d.season.week}`);
      const used = await betThisWeek(a.leagueId, a.userId, since);
      if (used + amount > caps.perUserWeek) return { ok: false, status: 400, error: `The most anyone can bet in one week is ${fmt(caps.perUserWeek)}. You've bet ${fmt(used)} this week, so you can bet up to ${fmt(Math.max(0, caps.perUserWeek - used))} more until the league advances.` };
    }
  }
  const extend = isAwardMarket(a.market) ? (ids: string[]) => withAwardPlayers(marketBook(d), d, ids.map((id) => [a.market, id] as [string, string])).markets.find((x) => x.key === a.market) : undefined;
  const economy = await economyOf(a.leagueId).catch(() => undefined);
  const r = await placeTrade({ leagueId: a.leagueId, book: bookKey(d.season.year, Boolean(tickets)), userId: a.userId, market: a.market, outcome: a.outcome, side: a.side, kind: a.kind, priced: m, amount, qty, tickets, extend, economy });
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
