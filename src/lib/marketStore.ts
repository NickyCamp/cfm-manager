// Shared play-money trading for the Markets tab (tables from supabase/migrations/0003_markets.sql).
// Server only: everything goes through the service role after checking who the user is.
import { currentUser, supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { getLeagueRow } from "@/lib/league/load";
import { liveWeekCached, refreshLiveWeek, weekMoved } from "@/lib/eaLive";
import { pricedP, pricerFor, quoteBuyP, quoteSellP, type Market, type MarketBook, type PriceIndex } from "@/lib/league/marketTypes";
import { after } from "next/server";
import { bookKey, discordOfUser, moveTickets, sendPendingTickets, ticketBalance, ticketsConfig, TICKETS_PER_CONTRACT, type TicketsConfig } from "@/lib/tickets";

export const START_CASH = 1000;
const poolKey = (m: string, o: string) => `${m}|${o}`;

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

/** Pay out positions on outcomes that have finished. Cheap when there's nothing to do. */
export async function settleFinished(leagueId: string, season: number, book: MarketBook, tickets = false) {
  const admin = supabaseAdmin();
  const { data } = await admin.from("market_positions").select("market_key, outcome_id").eq("league_id", leagueId).eq("season", season);
  const open = new Set((data || []).map((r) => poolKey(r.market_key, r.outcome_id)));
  if (!open.size) return;
  for (const m of book.markets) for (const o of m.outcomes) {
    if (o.state === "open" || !open.has(poolKey(m.key, o.id))) continue;
    const winner = o.state === "won" ? "yes" : "no";
    const { error } = tickets
      ? await admin.rpc("market_settle_tickets", { p_league: leagueId, p_book: season, p_market: m.key, p_outcome: o.id, p_winner: winner, p_per_contract: TICKETS_PER_CONTRACT, p_reason: `CFM Markets: won on ${o.label} (${m.title})` })
      : await admin.rpc("market_settle", { p_league: leagueId, p_season: season, p_market: m.key, p_outcome: o.id, p_winner: winner });
    if (error) console.error("market settle", m.key, o.id, error.message);
  }
}

export type SharedFill = { at: number; m: string; o: string; side: "yes" | "no"; qty: number; price: number; kind: "buy" | "sell" | "settle"; amount: number };
export type SharedState = {
  member: boolean;
  signedIn: boolean;
  currency: "usd" | "tickets";
  unit: number;                 // what one winning contract pays: $1, or 100 Tickets
  linked?: boolean;             // Tickets: the viewer's Discord account is linked (/connect)
  balanceError?: string;        // Tickets: UnbelievaBoat couldn't be read
  cash: number;
  positions: { m: string; o: string; side: "yes" | "no"; qty: number; cost: number }[];
  fills: SharedFill[];
  leaderboard: { name: string; team: string; total: number; you: boolean }[];
};

/** Viewer's wallet and positions plus the league leaderboard.
 *  Play money: cash + positions at current prices. Tickets: net Tickets won or lost in the markets
 *  (the real balance lives in UnbelievaBoat; the viewer's own balance is read from there). */
export async function sharedState(leagueId: string, season: number, userId: string | null, member: boolean, index: PriceIndex, tickets?: TicketsConfig | null): Promise<SharedState> {
  const admin = supabaseAdmin();
  const unit = tickets ? TICKETS_PER_CONTRACT : 1;
  const [w, pos, mem, tr] = await Promise.all([
    tickets ? Promise.resolve({ data: [] as { user_id: string; cash: number }[] }) : admin.from("market_wallets").select("user_id, cash").eq("league_id", leagueId).eq("season", season),
    admin.from("market_positions").select("user_id, market_key, outcome_id, side, qty, cost").eq("league_id", leagueId).eq("season", season),
    admin.from("league_members").select("user_id, team_abbr").eq("league_id", leagueId),
    tickets ? admin.from("market_trades").select("user_id, kind, amount").eq("league_id", leagueId).eq("season", season).limit(20000) : Promise.resolve({ data: [] as { user_id: string; kind: string; amount: number }[] }),
  ]);
  const price = (m: string, o: string, side: string) => {
    const x = index[m]?.o[o];
    if (!x) return 0;
    const yes = x[1] === "won" ? 1 : x[1] === "lost" ? 0 : x[0];
    return side === "yes" ? yes : 1 - yes;
  };
  const users = new Set<string>([...(w.data || []).map((r) => r.user_id), ...(tr.data || []).map((r) => r.user_id)]);
  const cash = new Map((w.data || []).map((r) => [r.user_id, Number(r.cash)]));
  const flow = new Map<string, number>();   // Tickets: paid back minus paid in
  for (const r of tr.data || []) flow.set(r.user_id, (flow.get(r.user_id) || 0) + (r.kind === "buy" ? -1 : 1) * Number(r.amount));
  const held = new Map<string, number>();
  for (const r of pos.data || []) held.set(r.user_id, (held.get(r.user_id) || 0) + Number(r.qty) * price(r.market_key, r.outcome_id, r.side) * unit);
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
  if (tickets) {
    viewerCash = 0;
    if (userId) {
      const d = await discordOfUser(userId).catch(() => null);
      linked = Boolean(d);
      if (d) {
        try { viewerCash = await ticketBalance(tickets, d.id); }
        catch (e) { balanceError = "Couldn't read your Tickets from UnbelievaBoat right now."; console.error("ub balance", (e as Error).message); }
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
    positions: (pos.data || []).filter((r) => r.user_id === userId).map((r) => ({ m: r.market_key, o: r.outcome_id, side: r.side, qty: Number(r.qty), cost: Number(r.cost) })),
    fills,
    leaderboard,
  };
}

/** One Tickets buy (spend up to `tickets`) or sell (contracts), through UnbelievaBoat. */
export async function placeTicketsTrade(args: {
  leagueId: string; book: number; userId: string; market: string; marketTitle: string; outcome: string; outcomeLabel: string;
  side: "yes" | "no"; kind: "buy" | "sell"; priced: Market; tickets?: number; qty?: number; cfg: TicketsConfig;
}): Promise<{ ok: true; qty: number; amount: number; before: number; after: number } | { ok: false; error: string }> {
  const admin = supabaseAdmin();
  const d = await discordOfUser(args.userId);
  if (!d) return { ok: false, error: "Link your Discord first: run /connect in the league's Discord and open the link." };
  const sideName = args.side === "yes" ? "Yes" : "No";
  for (let attempt = 0; attempt < 5; attempt++) {
    const nets = await marketNets(args.leagueId, args.book, args.market);
    const net = nets.get(args.outcome) || 0;
    const pr = pricerFor(args.priced, args.outcome, nets);
    const q = args.kind === "buy"
      ? quoteBuyP(pr, net, args.side, (args.tickets || 0) / TICKETS_PER_CONTRACT)
      : quoteSellP(pr, net, args.side, Math.floor(args.qty || 0));
    if (q.qty < 1) return { ok: false, error: args.kind === "buy" ? "That's not enough for one contract." : "Nothing to sell." };
    // whole Tickets: buyers round up, sellers round down
    const amount = args.kind === "buy" ? Math.ceil(q.amount * TICKETS_PER_CONTRACT - 1e-6) : Math.floor(q.amount * TICKETS_PER_CONTRACT + 1e-6);
    const reason = `CFM Markets: ${args.kind === "buy" ? "bet" : "sold"} ${q.qty} ${sideName} on ${args.outcomeLabel} (${args.marketTitle})`;
    if (args.kind === "buy") {
      let bal: number;
      try { bal = await ticketBalance(args.cfg, d.id); } catch { return { ok: false, error: "Couldn't reach UnbelievaBoat. Try again in a minute." }; }
      if (bal < amount) return { ok: false, error: `You have ${bal.toLocaleString()} Tickets; that bet costs ${amount.toLocaleString()}.` };
      try { await moveTickets(args.cfg, d.id, -amount, reason); } catch { return { ok: false, error: "UnbelievaBoat didn't take the Tickets, so no bet was placed. Try again." }; }
    }
    const { data, error } = await admin.rpc("market_trade_tickets", {
      p_league: args.leagueId, p_book: args.book, p_user: args.userId, p_market: args.market, p_outcome: args.outcome,
      p_side: args.side, p_kind: args.kind, p_qty: q.qty, p_amount: amount, p_expected_net: net, p_new_net: q.newNet,
      p_price_before: Math.round(q.before * 10000) / 10000, p_price_after: Math.round(q.after * 10000) / 10000, p_reason: reason,
    });
    if (data === "ok" && !error) {
      if (args.kind === "sell") after(() => sendPendingTickets(args.leagueId, args.cfg).then(() => {}, () => {}));
      return { ok: true, qty: q.qty, amount, before: q.before, after: q.after };
    }
    if (args.kind === "buy") {
      // The Tickets were taken but the bet didn't go in: give them straight back.
      try { await moveTickets(args.cfg, d.id, amount, `CFM Markets: refund, bet not placed (${args.outcomeLabel})`); }
      catch {
        await admin.from("market_ticket_moves").insert({ league_id: args.leagueId, book: args.book, user_id: args.userId, amount, kind: "refund", reason: `CFM Markets: refund, bet not placed (${args.outcomeLabel})` });
      }
    }
    if (error) return { ok: false, error: error.message };
    if (data === "qty") return { ok: false, error: "You don't hold that many contracts." };
    if (data !== "stale") return { ok: false, error: "Trade refused." };
  }
  return { ok: false, error: "Prices are moving fast. Try again." };
}

/** One buy (dollars) or sell (contracts) at the crowd price, retried if someone traded in between. */
export async function placeTrade(args: {
  leagueId: string; season: number; userId: string; market: string; outcome: string; side: "yes" | "no"; kind: "buy" | "sell";
  priced: Market; dollars?: number; qty?: number;
}): Promise<{ ok: true; qty: number; amount: number; before: number; after: number } | { ok: false; error: string }> {
  const admin = supabaseAdmin();
  for (let attempt = 0; attempt < 5; attempt++) {
    const nets = await marketNets(args.leagueId, args.season, args.market);
    const net = nets.get(args.outcome) || 0;
    const pr = pricerFor(args.priced, args.outcome, nets);
    const q = args.kind === "buy" ? quoteBuyP(pr, net, args.side, args.dollars || 0) : quoteSellP(pr, net, args.side, Math.floor(args.qty || 0));
    if (q.qty < 1) return { ok: false, error: args.kind === "buy" ? "That's not enough for one contract." : "Nothing to sell." };
    const { data, error } = await admin.rpc("market_trade", {
      p_league: args.leagueId, p_season: args.season, p_user: args.userId, p_market: args.market, p_outcome: args.outcome,
      p_side: args.side, p_kind: args.kind, p_qty: q.qty, p_amount: q.amount, p_expected_net: net, p_new_net: q.newNet,
      p_price_before: Math.round(q.before * 10000) / 10000, p_price_after: Math.round(q.after * 10000) / 10000,
    });
    if (error) return { ok: false, error: error.message };
    if (data === "ok") return { ok: true, qty: q.qty, amount: q.amount, before: q.before, after: q.after };
    if (data === "cash") return { ok: false, error: "Not enough cash." };
    if (data === "qty") return { ok: false, error: "You don't hold that many contracts." };
    if (data !== "stale") return { ok: false, error: "Trade refused." };
  }
  return { ok: false, error: "Prices are moving fast. Try again." };
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
  const names = await memberNames([...new Set((data || []).map((r) => r.user_id))]);
  return (data || []).map((r): AuditRow => ({
    id: Number(r.id), at: r.created_at, user: names.get(r.user_id) || "Member", userId: r.user_id, market: r.market_key, outcome: r.outcome_id,
    side: r.side, kind: r.kind, qty: Number(r.qty), amount: Number(r.amount),
    before: r.price_before == null ? null : Number(r.price_before), after: r.price_after == null ? null : Number(r.price_after),
  }));
}

/** What a markets page needs: the book (with crowd prices once shared trading is on),
 *  the viewer's wallet/leaderboard, and the league id. Settles finished outcomes first. */
export async function marketsForPage(slug: string, book: MarketBook, season: number, index: (b: MarketBook) => PriceIndex, dataWeek?: { stage: number; week: number }) {
  const none = { book, shared: null as SharedState | null, leagueId: null as string | null, bookKey: season, tickets: null as TicketsConfig | null };
  if (!(await marketsShared())) return none;
  try {
    const v = await viewer(slug);
    if (!v.leagueId) return none;
    const tickets = await ticketsConfig(slug).catch(() => null);
    const key = bookKey(season, Boolean(tickets));
    await settleFinished(v.leagueId, key, book, Boolean(tickets));
    if (tickets) { const lid = v.leagueId; after(() => sendPendingTickets(lid, tickets).then(() => {}, () => {})); }
    // EA's live "played" flags: use what's cached, refresh in the background (never slows the page)
    const live = liveWeekCached(slug);
    refreshLiveWeek(slug);
    const closes = await closeTimes(v.leagueId, season);
    const closed = applyCloses(book, closes, live?.played ?? null, Boolean(live && dataWeek && weekMoved(live, dataWeek)));
    const crowd = withCrowd(closed, await loadPools(v.leagueId, key));
    const shared = await sharedState(v.leagueId, key, v.userId, v.member, index(crowd), tickets);
    { const lid = v.leagueId; after(() => recordPrices(lid, key, crowd).then(() => {}, () => {})); }
    return { book: crowd, shared, leagueId: v.leagueId, bookKey: key, tickets };
  } catch (e) {
    console.error("markets shared state", slug, e);
    return none;
  }
}

// ---------------------------------------------------------------- kickoff / close times

export type CloseRow = { id: number; gameId: number; closeAt: string; by: string; kind: "site" | "discord"; at: string };

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

export type MoveRow = { id: number; at: string; user: string; amount: number; kind: string; reason: string; status: string; error: string | null };
/** Every Ticket movement the site made or owes (Tickets leagues), newest first. */
export async function ticketMoves(leagueId: string, book: number, limit = 200): Promise<MoveRow[]> {
  const { data, error } = await supabaseAdmin().from("market_ticket_moves").select("id, user_id, amount, kind, reason, status, error, created_at")
    .eq("league_id", leagueId).eq("book", book).order("id", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  const names = await memberNames([...new Set((data || []).map((r) => r.user_id))]);
  return (data || []).map((r) => ({ id: Number(r.id), at: r.created_at, user: names.get(r.user_id) || "Member", amount: Number(r.amount), kind: r.kind, reason: r.reason, status: r.status, error: r.error }));
}

/** The book as everyone sees it right now (kickoff closes + crowd prices), with no viewer. For Discord posts. */
export async function marketsForDiscord(slug: string, book: MarketBook, season: number, dataWeek: { stage: number; week: number }) {
  if (!(await marketsShared())) return null;
  const row = await getLeagueRow(slug);
  if (!row) return null;
  const tickets = await ticketsConfig(slug).catch(() => null);
  const key = bookKey(season, Boolean(tickets));
  const live = liveWeekCached(slug);
  const closes = await closeTimes(row.id, season);
  const closed = applyCloses(book, closes, live?.played ?? null, Boolean(live && weekMoved(live, dataWeek)));
  return { book: withCrowd(closed, await loadPools(row.id, key)), leagueId: row.id, tickets: Boolean(tickets) };
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
