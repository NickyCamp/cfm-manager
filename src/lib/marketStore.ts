// Shared play-money trading for the Markets tab (tables from supabase/migrations/0003_markets.sql).
// Server only: everything goes through the service role after checking who the user is.
import { currentUser, supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { getLeagueRow } from "@/lib/league/load";
import { liveWeekCached, refreshLiveWeek, weekMoved } from "@/lib/eaLive";
import { ladderGroup, pricedP, pricerFor, quoteBuyP, quoteSellP, type Market, type MarketBook, type PriceIndex } from "@/lib/league/marketTypes";
import { after } from "next/server";
import { bookKey, discordOfUser, ticketBalance, ticketsConfig, TICKETS_PER_CONTRACT, type TicketsConfig } from "@/lib/tickets";
import { propResult } from "@/lib/league/props";
import { isAwardMarket, withAwardPlayers } from "@/lib/league/markets";
import type { LeagueData } from "@/lib/league/types";

export const START_CASH = 1000;
const poolKey = (m: string, o: string) => `${m}|${o}`;
/** [market, outcome] for every pool (outcome ids never contain "|"; market keys don't either). */
const poolPairs = (pools: Map<string, unknown>) => [...pools.keys()].map((k) => { const i = k.lastIndexOf("|"); return [k.slice(0, i), k.slice(i + 1)] as [string, string]; });

let available: { at: number; ok: boolean; why: string } | null = null;
/** True once the markets migration has been run in Supabase. */
export async function marketsShared(): Promise<boolean> {
  return (await marketsStatus()).ok;
}
/** Same, with the reason when it's off (for the diagnostics GET; no secrets). */
export async function marketsStatus(): Promise<{ ok: boolean; why: string }> {
  if (process.env.LOCAL_LEAGUE_DATA) return { ok: false, why: "LOCAL_LEAGUE_DATA is set" };
  if (!supabaseConfigured()) return { ok: false, why: "Supabase URL / anon key not set" };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, why: "SUPABASE_SERVICE_ROLE_KEY not set" };
  if (available && (available.ok || Date.now() - available.at < 60_000)) return available;
  const { error } = await supabaseAdmin().from("market_pools").select("net").limit(1);
  available = { at: Date.now(), ok: !error, why: error ? `${error.code ?? ""} ${error.message}`.trim() : "" };
  if (error) console.warn("markets not shared yet:", available.why);
  return available;
}

/** The signed-in viewer and whether they're in this league (owner or member). */
export async function viewer(slug: string) {
  const row = await getLeagueRow(slug);
  const user = await currentUser().catch(() => null);
  if (!row || !user) return { leagueId: row?.id ?? null, userId: null as string | null, member: false };
  const admin = supabaseAdmin();
  const { data: lg } = await admin.from("leagues").select("id, owner_id").eq("id", row.id).maybeSingle();
  const member = Boolean(lg && (lg.owner_id === user.id || (await admin.from("league_members").select("user_id").eq("league_id", row.id).eq("user_id", user.id).maybeSingle()).data));
  return { leagueId: row.id, userId: user.id, member };
}

/** Is this user the league's owner or a member? */
export async function isMember(leagueId: string, userId: string) {
  const admin = supabaseAdmin();
  const { data: lg } = await admin.from("leagues").select("owner_id").eq("id", leagueId).maybeSingle();
  if (lg?.owner_id === userId) return true;
  const { data } = await admin.from("league_members").select("user_id").eq("league_id", leagueId).eq("user_id", userId).maybeSingle();
  return Boolean(data);
}

export async function loadPools(leagueId: string, season: number) {
  const { data } = await supabaseAdmin().from("market_pools").select("market_key, outcome_id, net, volume").eq("league_id", leagueId).eq("season", season);
  const pools = new Map<string, { net: number; volume: number }>();
  for (const r of data || []) pools.set(poolKey(r.market_key, r.outcome_id), { net: Number(r.net), volume: Number(r.volume) });
  return pools;
}

/** The book with crowd prices. Bets move related prices too: in one-winner markets every
 *  outcome (they always add up to 100¢), in prop ladders the player's other lines. */
export function withCrowd(book: MarketBook, pools: Map<string, { net: number; volume: number }>): MarketBook {
  if (!pools.size) return book;
  const markets: Market[] = book.markets.map((m) => {
    const nets = new Map<string, number>();
    for (const o of m.outcomes) { const pool = pools.get(poolKey(m.key, o.id)); if (pool?.net) nets.set(o.id, pool.net); }
    if (!nets.size && !m.outcomes.some((o) => pools.has(poolKey(m.key, o.id)))) return m;
    return {
      ...m,
      outcomes: m.outcomes.map((o) => {
        if (o.state !== "open") return o;
        const pool = pools.get(poolKey(m.key, o.id));
        const net = pool?.net || 0;
        const pr = pricerFor(m, o.id, nets);
        const p = pricedP(pr, net);
        // model/net drive the in-browser trade preview (a close approximation; the server quotes exactly)
        const preview = pr.kind === "binary" ? { model: pr.model, net } : { model: p, net: 0 };
        return { ...o, ...preview, volume: pool?.volume || 0, p };
      }),
    };
  });
  return { ...book, markets };
}

/** Everyone's nets in one market (for linked pricing). */
async function marketNets(leagueId: string, book: number, market: string) {
  const { data } = await supabaseAdmin().from("market_pools").select("outcome_id, net").eq("league_id", leagueId).eq("season", book).eq("market_key", market);
  const nets = new Map<string, number>();
  for (const r of data || []) nets.set(r.outcome_id, Number(r.net));
  return nets;
}

/** Every row of a query, 1,000 at a time (the API returns at most 1,000 per request). */
export async function allRows<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, max = 100_000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export type Result = "won" | "lost" | "void";
/** How one outcome finished, or null while it's still open. Game and prop markets are read
 *  straight from the schedule and box scores, so they settle even after the league has
 *  advanced past their week (when they're no longer in the book). A tied game is void. */
export function outcomeResult(d: LeagueData, book: MarketBook, marketKey: string, outcomeId: string): Result | null {
  const gm = /^game-(\d+)$/.exec(marketKey);
  if (gm) {
    const g = d.games.find((x) => x.id === Number(gm[1]));
    if (!g?.final) return null;
    if (g.hs === g.as) return "void";
    return String(g.hs > g.as ? g.home : g.away) === outcomeId ? "won" : "lost";
  }
  const pm = /^props-(\d+)-/.exec(marketKey);
  if (pm) return propResult(d, Number(pm[1]), outcomeId);
  const mk = book.markets.find((m) => m.key === marketKey);
  const o = mk?.outcomes.find((x) => x.id === outcomeId);
  // a player bet on for an award who wasn't among the listed contenders loses when the award settles
  if (!o && mk?.settled && isAwardMarket(marketKey)) return "lost";
  return o?.state === "won" ? "won" : o?.state === "lost" ? "lost" : null;
}

/** Settles every open position whose outcome has finished. Cheap when there's nothing to do. */
export async function settleFinished(leagueId: string, book: number, d: LeagueData, mb: MarketBook, tickets = false) {
  const admin = supabaseAdmin();
  const { data } = await admin.from("market_positions").select("market_key, outcome_id").eq("league_id", leagueId).eq("season", book);
  const open = new Map<string, { m: string; o: string }>();
  for (const r of data || []) open.set(poolKey(r.market_key, r.outcome_id), { m: r.market_key, o: r.outcome_id });
  let n = 0;
  for (const { m, o } of open.values()) {
    const res = outcomeResult(d, mb, m, o);
    if (!res) continue;
    const winner = res === "void" ? "void" : res === "won" ? "yes" : "no";
    const title = mb.markets.find((x) => x.key === m);
    const label = title?.outcomes.find((x) => x.id === o)?.label || o;
    const { error } = await admin.rpc("market_settle2", {
      p_league: leagueId, p_book: book, p_market: m, p_outcome: o, p_winner: winner,
      p_per_contract: tickets ? TICKETS_PER_CONTRACT : 1, p_tickets: tickets, p_note: `${label}${title ? `, ${title.title}` : ""}`.slice(0, 200),
    });
    if (error) console.error("market settle", m, o, error.message); else n++;
  }
  return n;
}

export type SharedFill = { at: number; m: string; o: string; side: "yes" | "no"; qty: number; price: number; kind: "buy" | "sell" | "settle"; amount: number };
export type SharedState = {
  member: boolean;
  signedIn: boolean;
  currency: "usd" | "tickets";
  unit: number;                 // what one winning contract pays: $1, or 100 Tickets
  linked?: boolean;             // Tickets: the viewer's Discord account is linked (/connect)
  balanceError?: string;        // Tickets: UnbelievaBoat couldn't be read
  cash: number;                 // what the viewer can bet now (Tickets: UnbelievaBoat - open stakes + results not applied yet)
  ticketsBreakdown?: { ub: number; open: number; pending: number };
  positions: { m: string; o: string; side: "yes" | "no"; qty: number; cost: number }[];
  fills: SharedFill[];
  leaderboard: { name: string; team: string; total: number; you: boolean }[];
};

/** Viewer's wallet and positions plus the league leaderboard.
 *  Play money: cash + open positions at cost. Tickets: net Tickets won or lost in the markets
 *  (the real balance lives in UnbelievaBoat; the viewer's own balance is read from there). */
export async function sharedState(leagueId: string, season: number, userId: string | null, member: boolean, index: PriceIndex, tickets?: TicketsConfig | null): Promise<SharedState> {
  const admin = supabaseAdmin();
  const unit = tickets ? TICKETS_PER_CONTRACT : 1;
  const [w, pos, mem, tr] = await Promise.all([
    tickets ? Promise.resolve({ data: [] as { user_id: string; cash: number }[] }) : admin.from("market_wallets").select("user_id, cash").eq("league_id", leagueId).eq("season", season),
    admin.from("market_positions").select("user_id, market_key, outcome_id, side, qty, cost").eq("league_id", leagueId).eq("season", season),
    admin.from("league_members").select("user_id, team_abbr").eq("league_id", leagueId),
    tickets
      ? allRows<{ id: number; user_id: string; kind: string; amount: number }>((f, t) => admin.from("market_trades").select("id, user_id, kind, amount").eq("league_id", leagueId).eq("season", season).order("id").range(f, t)).then((data) => ({ data }))
      : Promise.resolve({ data: [] as { id: number; user_id: string; kind: string; amount: number }[] }),
  ]);
  const voids = tickets ? await voidDeltas(leagueId) : new Map<number, number>();
  const price = (m: string, o: string, side: string) => {
    const x = index[m]?.o[o];
    if (!x) return 0;
    const yes = x[1] === "won" ? 1 : x[1] === "lost" ? 0 : x[0];
    return side === "yes" ? yes : 1 - yes;
  };
  const users = new Set<string>([...(w.data || []).map((r) => r.user_id), ...(tr.data || []).map((r) => r.user_id)]);
  const cash = new Map((w.data || []).map((r) => [r.user_id, Number(r.cash)]));
  const flow = new Map<string, number>();   // Tickets: paid back minus paid in
  for (const r of tr.data || []) flow.set(r.user_id, (flow.get(r.user_id) || 0) + (r.kind === "buy" ? -1 : 1) * Number(r.amount) + (voids.get(Number(r.id)) || 0));
  const held = new Map<string, number>();
  // Open bets count at what they cost (they can be cancelled for exactly that until kickoff/settlement),
  // so a big bet that moves the price can't show a paper profit. Finished outcomes count at their payout.
  for (const r of pos.data || []) {
    const x = index[r.market_key]?.o[r.outcome_id];
    const v = !x || x[1] === "open" ? Number(r.cost) : Number(r.qty) * price(r.market_key, r.outcome_id, r.side) * unit;
    held.set(r.user_id, (held.get(r.user_id) || 0) + v);
  }
  const ids = [...users];
  const names = await memberNames(ids);
  const team = new Map((mem.data || []).map((r) => [r.user_id, r.team_abbr || ""]));
  const leaderboard = ids
    .map((id) => ({
      name: names.get(id) || "Member", team: team.get(id) || "", you: id === userId,
      total: Math.round((tickets ? (flow.get(id) || 0) + (held.get(id) || 0) : (cash.get(id) ?? START_CASH) + (held.get(id) || 0)) * 100) / 100,
    }))
    .sort((a, b) => b.total - a.total);

  let fills: SharedFill[] = [];
  if (userId) {
    const { data: mine } = await admin.from("market_trades").select("market_key, outcome_id, side, kind, qty, amount, created_at")
      .eq("league_id", leagueId).eq("season", season).eq("user_id", userId).order("created_at", { ascending: false }).limit(30);
    fills = (mine || []).map((t) => ({
      at: Date.parse(t.created_at), m: t.market_key, o: t.outcome_id, side: t.side, qty: Number(t.qty), kind: t.kind, amount: Number(t.amount),
      price: Number(t.qty) ? Math.round((Number(t.amount) / Number(t.qty) / unit) * 100) : 0,
    }));
  }

  let viewerCash = userId ? (cash.get(userId) ?? START_CASH) : START_CASH;
  let linked: boolean | undefined;
  let balanceError: string | undefined;
  let ticketsBreakdown: SharedState["ticketsBreakdown"];
  if (tickets) {
    viewerCash = 0;
    if (userId) {
      const d = await discordOfUser(userId).catch(() => null);
      linked = Boolean(d);
      if (d) {
        try {
          const b = await ticketsAvailable(leagueId, userId, tickets, d.id);
          viewerCash = b.available; ticketsBreakdown = { ub: b.ub, open: b.open, pending: b.pending };
        } catch (e) { balanceError = "Couldn't read your Tickets from UnbelievaBoat right now."; console.error("ub balance", (e as Error).message); }
      }
    }
  }
  return {
    member,
    signedIn: Boolean(userId),
    currency: tickets ? "tickets" : "usd",
    unit,
    linked,
    balanceError,
    cash: viewerCash,
    ticketsBreakdown,
    positions: (pos.data || []).filter((r) => r.user_id === userId).map((r) => ({ m: r.market_key, o: r.outcome_id, side: r.side, qty: Number(r.qty), cost: Number(r.cost) })),
    fills,
    leaderboard,
  };
}

/** Void deltas by trade id (Tickets leaderboard). */
async function voidDeltas(leagueId: string) {
  const { data } = await supabaseAdmin().from("market_trade_voids").select("trade_id, delta").eq("league_id", leagueId);
  return new Map((data || []).map((r) => [Number(r.trade_id), Number(r.delta)]));
}

/** What a member can bet in Tickets: UnbelievaBoat balance - open stakes + results admins haven't applied yet. */
export async function ticketsAvailable(leagueId: string, userId: string, cfg: TicketsConfig, discordId: string) {
  const admin = supabaseAdmin();
  const [ub, pos, led] = await Promise.all([
    ticketBalance(cfg, discordId),
    admin.from("market_positions").select("season, cost").eq("league_id", leagueId).eq("user_id", userId),
    admin.from("market_ledger").select("amount").eq("league_id", leagueId).eq("user_id", userId).is("applied_at", null),
  ]);
  const open = (pos.data || []).filter((r) => Number(r.season) % 10 === 1).reduce((a, r) => a + Number(r.cost), 0);
  const pending = (led.data || []).reduce((a, r) => a + Number(r.amount), 0);
  return { ub, open, pending, available: Math.floor(ub - open + pending) };
}

/** Futures (season-long markets) cash out at the market price; game and prop bets cancel (Nick, 2026-11-14). */
export const isFutures = (marketKey: string) => !/^(game|props)-/.test(marketKey);

/** Positions a new bet may not sit beside (each is [outcome, side]): the other side of the same line;
 *  in a two-team game, the other team; in a prop ladder, the opposite direction on the player's other lines.
 *  Holding both sides is how a cancel could be turned into a sure profit. */
export function conflictsFor(m: Market, outcome: string, side: "yes" | "no"): [string, string][] {
  const other = side === "yes" ? "no" : "yes";
  const out: [string, string][] = [[outcome, other]];
  if (m.kind === "exclusive" && m.gameId && m.outcomes.length === 2) {
    const o2 = m.outcomes.find((x) => x.id !== outcome);
    if (o2) out.push([o2.id, side]);
  }
  const g = ladderGroup(m.key, outcome);
  if (g) for (const x of m.outcomes) if (x.id !== outcome && ladderGroup(m.key, x.id) === g) out.push([x.id, other]);
  return out;
}

/** One buy (spend up to `amount`: dollars or Tickets) or cancel (`qty` contracts) at the crowd price.
 *  Tickets: nothing moves in UnbelievaBoat; the stake is held against the member's balance on the site,
 *  and results go to the weekly payouts report. Selling: a game/prop bet cancels for what it cost, or what
 *  it's worth now if that's less; a futures bet cashes out at what it's worth now (more or less than the
 *  stake). Retried if someone traded in between. */
export async function placeTrade(args: {
  leagueId: string; book: number; userId: string; market: string; outcome: string; side: "yes" | "no"; kind: "buy" | "sell";
  priced: Market; amount?: number; qty?: number; tickets?: TicketsConfig | null;
  /** The market again with these outcome ids included (award markets: players others have bet on). */
  extend?: (outcomeIds: string[]) => Market | undefined;
}): Promise<{ ok: true; qty: number; amount: number; before: number; after: number; cashout: boolean } | { ok: false; error: string }> {
  const cashout = args.kind === "sell" && isFutures(args.market);
  const admin = supabaseAdmin();
  const T = Boolean(args.tickets);
  const unit = T ? TICKETS_PER_CONTRACT : 1;
  let balance = 0;
  if (T && args.kind === "buy") {
    const d = await discordOfUser(args.userId);
    if (!d) return { ok: false, error: "Link your Discord first: run /connect in the league's Discord and open the link." };
    try { balance = await ticketBalance(args.tickets!, d.id); } catch { return { ok: false, error: "Couldn't read your Tickets from UnbelievaBoat. Try again in a minute." }; }
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const nets = await marketNets(args.leagueId, args.book, args.market);
    const net = nets.get(args.outcome) || 0;
    const priced = (args.extend && args.extend([...nets.keys(), args.outcome])) || args.priced;
    const pr = pricerFor(priced, args.outcome, nets);
    const q = args.kind === "buy"
      ? quoteBuyP(pr, net, args.side, (args.amount || 0) / unit)
      : quoteSellP(pr, net, args.side, Math.floor(args.qty || 0));
    if (q.qty < 1) return { ok: false, error: args.kind === "buy" ? "That's not enough for one contract." : "Nothing to cancel." };
    // whole Tickets: a stake rounds up, a cancel's market value rounds down
    const amount = T
      ? (args.kind === "buy" ? Math.ceil(q.amount * unit - 1e-6) : Math.floor(q.amount * unit + 1e-6))
      : q.amount;
    const { data, error } = await admin.rpc("market_trade2", {
      p_league: args.leagueId, p_book: args.book, p_user: args.userId, p_market: args.market, p_outcome: args.outcome,
      p_side: args.side, p_kind: args.kind, p_qty: q.qty, p_amount: amount,
      p_expected: Object.fromEntries(nets), p_new_net: q.newNet,
      p_price_before: Math.round(q.before * 10000) / 10000, p_price_after: Math.round(q.after * 10000) / 10000,
      p_tickets: T, p_balance: balance, p_conflicts: args.kind === "buy" ? conflictsFor(priced, args.outcome, args.side) : null,
      ...(cashout ? { p_cashout: true } : {}),
    });
    if (error) return { ok: false, error: error.message };
    const r = data as { r: string; amount?: number };
    if (r.r === "ok") return { ok: true, qty: q.qty, amount: Number(r.amount ?? amount), before: q.before, after: q.after, cashout };
    if (r.r === "cash") return { ok: false, error: T ? `You have ${Math.max(0, Number(r.amount || 0)).toLocaleString("en-US")} Tickets free to bet (your UnbelievaBoat balance minus open bets, plus results not added yet); that bet costs ${amount.toLocaleString("en-US")}.` : "Not enough cash." };
    if (r.r === "qty") return { ok: false, error: "You don't hold that many contracts." };
    if (r.r === "conflict") return { ok: false, error: "You already have a bet on the other side of this. Cancel it first if you've changed your mind." };
    if (r.r !== "stale") return { ok: false, error: "Trade refused." };
  }
  return { ok: false, error: "Prices are moving fast. Try again." };
}

/** What selling a whole position gives back right now: futures cash out at market value; game/prop bets
 *  cancel for what they cost, or their market value if that's less. */
export async function cancelValue(leagueId: string, book: number, m: Market, outcome: string, side: "yes" | "no", pos: { qty: number; cost: number }, tickets: boolean, extend?: (ids: string[]) => Market | undefined) {
  const nets = await marketNets(leagueId, book, m.key);
  const priced = (extend && extend([...nets.keys(), outcome])) || m;
  const q = quoteSellP(pricerFor(priced, outcome, nets), nets.get(outcome) || 0, side, Math.floor(pos.qty));
  const value = tickets ? Math.floor(q.amount * TICKETS_PER_CONTRACT + 1e-6) : q.amount;
  return isFutures(m.key) ? value : Math.min(pos.cost, value);
}

/** Display names: the member's EA name, else their profile name. */
export async function memberNames(ids: string[]) {
  const names = new Map<string, string>();
  if (!ids.length) return names;
  const admin = supabaseAdmin();
  const [eas, profs] = await Promise.all([
    admin.from("ea_connections").select("user_id, persona_name").in("user_id", ids),
    admin.from("profiles").select("id, display_name").in("id", ids),
  ]);
  for (const p of profs.data || []) if (p.display_name) names.set(p.id, p.display_name);
  for (const e of eas.data || []) names.set(e.user_id, e.persona_name);
  return names;
}

export type AuditRow = {
  id: number; at: string; user: string; userId: string; market: string; outcome: string; side: "yes" | "no";
  kind: "buy" | "sell" | "settle"; qty: number; amount: number; before: number | null; after: number | null;
  voided?: string;    // why it was voided (placed after the real kickoff)
};
/** The public trade log, newest first. Every trade by every member, never edited (see the migration's trigger). */
export async function auditTrades(leagueId: string, season: number, opts: { market?: string; user?: string; before?: number; limit?: number } = {}) {
  let q = supabaseAdmin().from("market_trades").select("id, user_id, market_key, outcome_id, side, kind, qty, amount, price_before, price_after, created_at")
    .eq("league_id", leagueId).eq("season", season).order("id", { ascending: false }).limit(opts.limit ?? 200);
  if (opts.market) q = q.eq("market_key", opts.market);
  if (opts.user) q = q.eq("user_id", opts.user);
  if (opts.before) q = q.lt("id", opts.before);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const ids = (data || []).map((r) => Number(r.id));
  const [names, vd] = await Promise.all([
    memberNames([...new Set((data || []).map((r) => r.user_id))]),
    ids.length ? supabaseAdmin().from("market_trade_voids").select("trade_id, reason").in("trade_id", ids) : Promise.resolve({ data: [] as { trade_id: number; reason: string }[] }),
  ]);
  const voided = new Map((vd.data || []).map((r) => [Number(r.trade_id), r.reason as string]));
  return (data || []).map((r): AuditRow => ({
    id: Number(r.id), at: r.created_at, user: names.get(r.user_id) || "Member", userId: r.user_id, market: r.market_key, outcome: r.outcome_id,
    side: r.side, kind: r.kind, qty: Number(r.qty), amount: Number(r.amount),
    before: r.price_before == null ? null : Number(r.price_before), after: r.price_after == null ? null : Number(r.price_after),
    voided: voided.get(Number(r.id)),
  }));
}

/** What a markets page needs: the book (with crowd prices once shared trading is on),
 *  the viewer's wallet/leaderboard, and the league id. Settles finished outcomes first. */
export async function marketsForPage(slug: string, book: MarketBook, season: number, index: (b: MarketBook) => PriceIndex, dataWeek?: { stage: number; week: number }, d?: LeagueData, want: [string, string][] = []) {
  const none = { book, shared: null as SharedState | null, leagueId: null as string | null, bookKey: season, tickets: null as TicketsConfig | null };
  if (!(await marketsShared())) return none;
  try {
    const v = await viewer(slug);
    if (!v.leagueId) return none;
    const tickets = await ticketsConfig(slug).catch(() => null);
    const key = bookKey(season, Boolean(tickets));
    if (d) await settleFinished(v.leagueId, key, d, book, Boolean(tickets));
    // EA's live "played" flags: use what's cached, refresh in the background (never slows the page)
    const live = liveWeekCached(slug);
    refreshLiveWeek(slug);
    const closes = await closeTimes(v.leagueId, season);
    const closed = applyCloses(book, closes, live?.played ?? null, Boolean(live && dataWeek && weekMoved(live, dataWeek)));
    const pools = await loadPools(v.leagueId, key);
    const crowd = withCrowd(d ? withAwardPlayers(closed, d, [...poolPairs(pools), ...want]) : closed, pools);
    const shared = await sharedState(v.leagueId, key, v.userId, v.member, index(crowd), tickets);
    { const lid = v.leagueId; after(() => recordPrices(lid, key, crowd).then(() => {}, () => {})); }
    return { book: crowd, shared, leagueId: v.leagueId, bookKey: key, tickets };
  } catch (e) {
    console.error("markets shared state", slug, e);
    return none;
  }
}

// ---------------------------------------------------------------- kickoff / close times

export type CloseRow = { id: number; gameId: number; closeAt: string; by: string; kind: "site" | "discord" | "verified"; at: string };

/** Every close time ever set this season, newest first (public log). */
export async function closeLog(leagueId: string, season: number, gameId?: number): Promise<CloseRow[]> {
  let q = supabaseAdmin().from("market_game_close").select("id, game_id, close_at, set_by_kind, set_by_name, created_at")
    .eq("league_id", leagueId).eq("season", season).order("id", { ascending: false }).limit(500);
  if (gameId) q = q.eq("game_id", gameId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data || []).map((r) => ({ id: Number(r.id), gameId: Number(r.game_id), closeAt: r.close_at, by: r.set_by_name, kind: r.set_by_kind, at: r.created_at }));
}
/** The close time in force for each game (latest row wins). */
export async function closeTimes(leagueId: string, season: number) {
  const out = new Map<number, CloseRow>();
  for (const r of await closeLog(leagueId, season).catch(() => [])) if (!out.has(r.gameId)) out.set(r.gameId, r);
  return out;
}
export async function setCloseTime(leagueId: string, season: number, gameId: number, closeAt: Date, by: { kind: "site" | "discord"; id: string; name: string }) {
  const { error } = await supabaseAdmin().from("market_game_close").insert({
    league_id: leagueId, season, game_id: gameId, close_at: closeAt.toISOString(), set_by_kind: by.kind, set_by_id: by.id, set_by_name: by.name.slice(0, 64),
  });
  if (error) throw new Error(error.message);
}

/** Is this site user the league's owner or a commissioner? */
export async function isCommissioner(leagueId: string, userId: string) {
  const admin = supabaseAdmin();
  const { data: lg } = await admin.from("leagues").select("owner_id").eq("id", leagueId).maybeSingle();
  if (lg?.owner_id === userId) return true;
  const { data } = await admin.from("league_members").select("role").eq("league_id", leagueId).eq("user_id", userId).maybeSingle();
  return data?.role === "commissioner";
}
/** The team a site user runs in this league (abbreviation), if any. */
export async function teamOfUser(leagueId: string, userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin().from("league_members").select("team_abbr").eq("league_id", leagueId).eq("user_id", userId).maybeSingle();
  return (data?.team_abbr as string | null) || null;
}
/** Who may set a game's kickoff (Fable's review, 2026-11-14): the two teams' managers or an admin;
 *  once the kickoff in force has passed, only an admin (so nobody can reopen a game that's under way).
 *  Returns "" if allowed, else why not. */
export function kickoffPermission(o: { admin: boolean; userTeam: string | null; homeAbbr: string; awayAbbr: string; current?: CloseRow; now?: number }) {
  if (o.admin) return "";
  if (o.current && Date.parse(o.current.closeAt) <= (o.now ?? Date.now())) return "Betting on this game has already closed. Only an admin can change its kickoff now.";
  const t = (o.userTeam || "").toLowerCase();
  if (t && (t === o.homeAbbr.toLowerCase() || t === o.awayAbbr.toLowerCase())) return "";
  return "Only the two teams' managers (or an admin) can set this game's kickoff.";
}

export const fmtET = (iso: string | Date) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET";

/** Marks game/prop markets closed once their kickoff has passed or EA says the game was played. */
export function applyCloses(book: MarketBook, closes: Map<number, CloseRow>, played: Set<number> | null, weekMovedOn: boolean, now = Date.now()): MarketBook {
  return {
    ...book,
    markets: book.markets.map((m) => {
      if (!m.gameId || m.settled) return m;
      const c = closes.get(m.gameId);
      if (weekMovedOn || played?.has(m.gameId)) return { ...m, closed: true, status: "Closed: game played, settles at the next sync" };
      if (c && Date.parse(c.closeAt) <= now) return { ...m, closed: true, status: `Closed at kickoff (${fmtET(c.closeAt)})` };
      if (c) return { ...m, status: `Closes ${fmtET(c.closeAt)}` };
      return { ...m, status: "Open until played (no kickoff set)" };
    }),
  };
}

export type LedgerRow = {
  id: number; at: string; userId: string; user: string; kind: "result" | "cancel" | "cashout" | "void" | "credit"; market: string | null; outcome: string | null;
  side: string | null; qty: number | null; cost: number | null; payout: number | null; amount: number; note: string;
  reportKey: string | null; appliedAt: string | null; appliedBy: string | null;
};
/** Tickets owed to (+) or by (-) members, newest first: what the weekly payouts reports are built from. */
export async function ledgerRows(leagueId: string, opts: { unapplied?: boolean; user?: string; limit?: number } = {}): Promise<LedgerRow[]> {
  const rows = await allRows<Record<string, unknown>>((f, t) => {
    let q = supabaseAdmin().from("market_ledger").select("id, user_id, kind, market_key, outcome_id, side, qty, cost, payout, amount, note, created_at, report_key, applied_at, applied_by")
      .eq("league_id", leagueId).order("id", { ascending: false });
    if (opts.unapplied) q = q.is("applied_at", null);
    if (opts.user) q = q.eq("user_id", opts.user);
    return q.range(f, t);
  }, opts.limit ?? 5000);
  const names = await memberNames([...new Set(rows.map((r) => String(r.user_id)))]);
  const num = (x: unknown) => (x == null ? null : Number(x));
  return rows.map((r) => ({
    id: Number(r.id), at: String(r.created_at), userId: String(r.user_id), user: names.get(String(r.user_id)) || "Member", kind: r.kind as LedgerRow["kind"],
    market: (r.market_key as string) ?? null, outcome: (r.outcome_id as string) ?? null, side: (r.side as string) ?? null,
    qty: num(r.qty), cost: num(r.cost), payout: num(r.payout), amount: Number(r.amount), note: String(r.note || ""),
    reportKey: (r.report_key as string) ?? null, appliedAt: (r.applied_at as string) ?? null, appliedBy: (r.applied_by as string) ?? null,
  }));
}

// ---------------------------------------------------------------- voiding bets placed after the real kickoff

/** An admin's verified kickoff for a finished game: records it, then voids every bet and cancel on the
 *  game's markets placed at or after it. The game must be final (its markets settle first). */
export async function verifyKickoff(a: { leagueId: string; season: number; d: LeagueData; book: MarketBook; gameId: number; kickoff: Date; tickets: boolean; by: { kind: "site" | "discord"; id: string; name: string } }) {
  const g = a.d.games.find((x) => x.id === a.gameId);
  if (!g?.final) return { ok: false as const, error: "That game isn't final yet. Verify the kickoff once it has been played and synced." };
  const admin = supabaseAdmin();
  const key = bookKey(a.season, a.tickets);
  await settleFinished(a.leagueId, key, a.d, a.book, a.tickets);
  const { error: ce } = await admin.from("market_game_close").insert({
    league_id: a.leagueId, season: a.season, game_id: a.gameId, close_at: a.kickoff.toISOString(), set_by_kind: "verified", set_by_id: a.by.id, set_by_name: a.by.name.slice(0, 64),
  });
  if (ce) return { ok: false as const, error: ce.message };
  const late = await allRows<{ id: number; user_id: string; market_key: string; outcome_id: string; side: string; kind: string; qty: number; amount: number; created_at: string }>((f, t) =>
    admin.from("market_trades").select("id, user_id, market_key, outcome_id, side, kind, qty, amount, created_at")
      .eq("league_id", a.leagueId).eq("season", key).in("kind", ["buy", "sell"]).gte("created_at", a.kickoff.toISOString())
      .or(`market_key.eq.game-${a.gameId},market_key.like.props-${a.gameId}-*`).order("id").range(f, t));
  const voided: typeof late = [];
  for (const t of late) {
    const res = outcomeResult(a.d, a.book, t.market_key, t.outcome_id);
    if (!res) continue;
    const mine = res === "void" ? "void" : (res === "won") === (t.side === "yes") ? "won" : "lost";
    const { data, error } = await admin.rpc("market_void_trade", {
      p_trade: t.id, p_result: mine, p_per_contract: a.tickets ? TICKETS_PER_CONTRACT : 1, p_tickets: a.tickets,
      p_by: a.by.name.slice(0, 64), p_reason: `Placed after the verified kickoff (${fmtET(a.kickoff)})`,
    });
    if (error) return { ok: false as const, error: error.message };
    if (data === "ok") voided.push(t);
  }
  return { ok: true as const, voided };
}

/** The book as everyone sees it right now (kickoff closes + crowd prices), with no viewer. For Discord posts. */
export async function marketsForDiscord(slug: string, book: MarketBook, season: number, dataWeek: { stage: number; week: number }, d?: LeagueData) {
  if (!(await marketsShared())) return null;
  const row = await getLeagueRow(slug);
  if (!row) return null;
  const tickets = await ticketsConfig(slug).catch(() => null);
  const key = bookKey(season, Boolean(tickets));
  const live = liveWeekCached(slug);
  const closes = await closeTimes(row.id, season);
  const closed = applyCloses(book, closes, live?.played ?? null, Boolean(live && weekMoved(live, dataWeek)));
  const pools = await loadPools(row.id, key);
  const crowd = withCrowd(d ? withAwardPlayers(closed, d, poolPairs(pools)) : closed, pools);
  await recordPrices(row.id, key, crowd).catch(() => {});
  return { book: crowd, leagueId: row.id, tickets: Boolean(tickets) };
}

// ---------------------------------------------------------------- price history (odds over time)

export type PricePoint = { at: string; prices: Record<string, number>; cause: "sync" | "bet" };
/** Season-long markets get a chart; single-game markets close within days. */
const charted = (m: Market) => !m.gameId;
const pricesOf = (m: Market) => Object.fromEntries(m.outcomes.map((o) => [o.id, Math.round(o.p * 10000) / 10000]));
const moved = (a: Record<string, number>, b: Record<string, number> | undefined) => {
  if (!b) return true;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return true;
  return ka.some((k) => b[k] == null || Math.abs(a[k] - b[k]) >= 0.005);
};
const lastRecorded = new Map<string, number>();

/** Writes the current price of every season-long market that moved since its last row.
 *  Throttled per server instance; called from page loads, so the weekly model moves get caught. */
export async function recordPrices(leagueId: string, book: number, crowd: MarketBook, cause: "sync" | "bet" = "sync", only?: string) {
  const tk = `${leagueId}:${book}`;
  if (!only && Date.now() - (lastRecorded.get(tk) || 0) < 5 * 60_000) return;
  if (!only) lastRecorded.set(tk, Date.now());
  const admin = supabaseAdmin();
  const { data, error } = await admin.rpc("market_price_latest", { p_league: leagueId, p_book: book });
  if (error) return; // table not created yet
  const last = new Map<string, Record<string, number>>((data || []).map((r: { market_key: string; prices: Record<string, number> }) => [r.market_key, r.prices]));
  const rows = crowd.markets.filter((m) => charted(m) && (!only || m.key === only)).map((m) => ({ m, prices: pricesOf(m) }))
    .filter(({ m, prices }) => moved(prices, last.get(m.key)))
    .map(({ m, prices }) => ({ league_id: leagueId, book, market_key: m.key, prices, cause }));
  if (rows.length) await admin.from("market_price_points").insert(rows);
}

/** After a bet: record that market's new prices. */
export async function recordAfterTrade(leagueId: string, book: number, m: Market) {
  if (!charted(m)) return;
  const pools = new Map<string, { net: number; volume: number }>();
  for (const [id, net] of await marketNets(leagueId, book, m.key)) pools.set(poolKey(m.key, id), { net, volume: 0 });
  const crowd = withCrowd({ markets: [m] } as unknown as MarketBook, pools);
  await recordPrices(leagueId, book, crowd, "bet", m.key);
}

/** One market's price history, oldest first. */
export async function priceHistory(leagueId: string, book: number, market: string): Promise<PricePoint[]> {
  const { data, error } = await supabaseAdmin().from("market_price_points").select("prices, cause, created_at")
    .eq("league_id", leagueId).eq("book", book).eq("market_key", market).order("id", { ascending: true }).limit(5000);
  if (error) return [];
  return (data || []).map((r) => ({ at: r.created_at, prices: r.prices as Record<string, number>, cause: r.cause }));
}

// ---------------------------------------------------------------- one team's bets (team page Markets tab)

export type TeamBet = {
  market: string; outcome: string; side: "yes" | "no"; user: string;
  qty: number; cost: number; placed: string;          // first bet in this position
  result?: "won" | "lost" | "cancelled"; payout?: number; closedAt?: string;
};

/** Every bet by the member(s) running this team, rebuilt from the public trade log:
 *  open positions, and finished ones (settled, or fully cancelled) with their result. */
export async function teamBets(leagueId: string, book: number, teamAbbr: string, teamUser?: string): Promise<{ open: TeamBet[]; done: TeamBet[]; members: string[] }> {
  const admin = supabaseAdmin();
  // The team's member: set on the site (team_abbr), or whose EA name is the team's in-game user.
  const [{ data: mem }, { data: traders }] = await Promise.all([
    admin.from("league_members").select("user_id, team_abbr").eq("league_id", leagueId),
    admin.from("market_trades").select("user_id").eq("league_id", leagueId).eq("season", book).limit(20000),
  ]);
  const all = [...new Set([...(mem || []).map((r) => r.user_id), ...(traders || []).map((r) => r.user_id)])];
  const allNames = await memberNames(all);
  const who = (teamUser || "").trim().toLowerCase();
  const ids = all.filter((id) => (mem || []).some((r) => r.user_id === id && (r.team_abbr || "").toLowerCase() === teamAbbr.toLowerCase())
    || (who && (allNames.get(id) || "").trim().toLowerCase() === who));
  if (!ids.length) return { open: [], done: [], members: [] };
  const names = allNames;
  const { data, error } = await admin.from("market_trades").select("user_id, market_key, outcome_id, side, kind, qty, amount, created_at")
    .eq("league_id", leagueId).eq("season", book).in("user_id", ids).order("id", { ascending: true }).limit(10000);
  if (error) throw new Error(error.message);
  const live = new Map<string, TeamBet>();
  const done: TeamBet[] = [];
  for (const r of data || []) {
    const k = `${r.user_id}|${r.market_key}|${r.outcome_id}|${r.side}`;
    const qty = Number(r.qty), amount = Number(r.amount);
    let b = live.get(k);
    if (r.kind === "buy") {
      if (!b) { b = { market: r.market_key, outcome: r.outcome_id, side: r.side, user: names.get(r.user_id) || "Member", qty: 0, cost: 0, placed: r.created_at }; live.set(k, b); }
      b.qty += qty; b.cost += amount;
    } else if (b) {
      if (r.kind === "settle") {
        done.push({ ...b, result: amount > 0 ? "won" : "lost", payout: amount, closedAt: r.created_at });
        live.delete(k);
      } else {
        const share = Math.min(1, qty / b.qty);
        const refunded = { ...b, qty, cost: b.cost * share, result: "cancelled" as const, payout: amount, closedAt: r.created_at };
        b.cost -= b.cost * share; b.qty -= qty;
        done.push(refunded);
        if (b.qty < 0.0001) live.delete(k);
      }
    }
  }
  done.sort((a, b) => Date.parse(b.closedAt!) - Date.parse(a.closedAt!));
  return { open: [...live.values()].sort((a, b) => Date.parse(b.placed) - Date.parse(a.placed)), done, members: ids.map((id) => names.get(id) || "Member") };
}
