// Shared play-money trading for the Markets tab (tables from supabase/migrations/0003_markets.sql).
// Server only: everything goes through the service role after checking who the user is.
import { currentUser, supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";
import { getLeagueRow } from "@/lib/league/load";
import { liveWeekCached, refreshLiveWeek, weekMoved } from "@/lib/eaLive";
import { crowdP, quoteBuy, quoteSell, type Market, type MarketBook, type PriceIndex } from "@/lib/league/marketTypes";

export const START_CASH = 1000;
const poolKey = (m: string, o: string) => `${m}|${o}`;

let available: { at: number; ok: boolean } | null = null;
/** True once the markets migration has been run in Supabase. */
export async function marketsShared(): Promise<boolean> {
  if (process.env.LOCAL_LEAGUE_DATA || !supabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return false;
  if (available && (available.ok || Date.now() - available.at < 60_000)) return available.ok;
  const { error } = await supabaseAdmin().from("market_pools").select("net").limit(1);
  available = { at: Date.now(), ok: !error };
  if (error) console.warn("markets not shared yet:", error.message);
  return available.ok;
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

export async function loadPools(leagueId: string, season: number) {
  const { data } = await supabaseAdmin().from("market_pools").select("market_key, outcome_id, net, volume").eq("league_id", leagueId).eq("season", season);
  const pools = new Map<string, { net: number; volume: number }>();
  for (const r of data || []) pools.set(poolKey(r.market_key, r.outcome_id), { net: Number(r.net), volume: Number(r.volume) });
  return pools;
}

/** The book with crowd prices: each open outcome's chance moved by what members bought. */
export function withCrowd(book: MarketBook, pools: Map<string, { net: number; volume: number }>): MarketBook {
  if (!pools.size) return book;
  const markets: Market[] = book.markets.map((m) => ({
    ...m,
    outcomes: m.outcomes.map((o) => {
      const pool = pools.get(poolKey(m.key, o.id));
      if (!pool || o.state !== "open") return o;
      const p = crowdP(o.p, pool.net);
      return { ...o, model: o.p, net: pool.net, volume: pool.volume, p };
    }),
  }));
  return { ...book, markets };
}

/** Pay out positions on outcomes that have finished. Cheap when there's nothing to do. */
export async function settleFinished(leagueId: string, season: number, book: MarketBook) {
  const admin = supabaseAdmin();
  const { data } = await admin.from("market_positions").select("market_key, outcome_id").eq("league_id", leagueId).eq("season", season);
  const open = new Set((data || []).map((r) => poolKey(r.market_key, r.outcome_id)));
  if (!open.size) return;
  for (const m of book.markets) for (const o of m.outcomes) {
    if (o.state === "open" || !open.has(poolKey(m.key, o.id))) continue;
    const { error } = await admin.rpc("market_settle", { p_league: leagueId, p_season: season, p_market: m.key, p_outcome: o.id, p_winner: o.state === "won" ? "yes" : "no" });
    if (error) console.error("market settle", m.key, o.id, error.message);
  }
}

export type SharedFill = { at: number; m: string; o: string; side: "yes" | "no"; qty: number; price: number; kind: "buy" | "sell" | "settle"; amount: number };
export type SharedState = {
  member: boolean;
  signedIn: boolean;
  cash: number;
  positions: { m: string; o: string; side: "yes" | "no"; qty: number; cost: number }[];
  fills: SharedFill[];
  leaderboard: { name: string; team: string; total: number; you: boolean }[];
};

/** Viewer's wallet and positions plus the league leaderboard (cash + positions at current prices). */
export async function sharedState(leagueId: string, season: number, userId: string | null, member: boolean, index: PriceIndex): Promise<SharedState> {
  const admin = supabaseAdmin();
  const [w, pos, mem] = await Promise.all([
    admin.from("market_wallets").select("user_id, cash").eq("league_id", leagueId).eq("season", season),
    admin.from("market_positions").select("user_id, market_key, outcome_id, side, qty, cost").eq("league_id", leagueId).eq("season", season),
    admin.from("league_members").select("user_id, team_abbr").eq("league_id", leagueId),
  ]);
  const price = (m: string, o: string, side: string) => {
    const x = index[m]?.o[o];
    if (!x) return 0;
    const yes = x[1] === "won" ? 1 : x[1] === "lost" ? 0 : x[0];
    return side === "yes" ? yes : 1 - yes;
  };
  const users = new Set<string>([...(w.data || []).map((r) => r.user_id)]);
  const cash = new Map((w.data || []).map((r) => [r.user_id, Number(r.cash)]));
  const held = new Map<string, number>();
  for (const r of pos.data || []) held.set(r.user_id, (held.get(r.user_id) || 0) + Number(r.qty) * price(r.market_key, r.outcome_id, r.side));
  const ids = [...users];
  const names = await memberNames(ids);
  const team = new Map((mem.data || []).map((r) => [r.user_id, r.team_abbr || ""]));
  const leaderboard = ids
    .map((id) => ({ name: names.get(id) || "Member", team: team.get(id) || "", total: Math.round(((cash.get(id) ?? START_CASH) + (held.get(id) || 0)) * 100) / 100, you: id === userId }))
    .sort((a, b) => b.total - a.total);

  let fills: SharedFill[] = [];
  if (userId) {
    const { data: tr } = await admin.from("market_trades").select("market_key, outcome_id, side, kind, qty, amount, created_at")
      .eq("league_id", leagueId).eq("season", season).eq("user_id", userId).order("created_at", { ascending: false }).limit(30);
    fills = (tr || []).map((t) => ({
      at: Date.parse(t.created_at), m: t.market_key, o: t.outcome_id, side: t.side, qty: Number(t.qty), kind: t.kind, amount: Number(t.amount),
      price: Number(t.qty) ? Math.round((Number(t.amount) / Number(t.qty)) * 100) : 0,
    }));
  }
  return {
    member,
    signedIn: Boolean(userId),
    cash: userId ? (cash.get(userId) ?? START_CASH) : START_CASH,
    positions: (pos.data || []).filter((r) => r.user_id === userId).map((r) => ({ m: r.market_key, o: r.outcome_id, side: r.side, qty: Number(r.qty), cost: Number(r.cost) })),
    fills,
    leaderboard,
  };
}

/** One buy (dollars) or sell (contracts) at the crowd price, retried if someone traded in between. */
export async function placeTrade(args: {
  leagueId: string; season: number; userId: string; market: string; outcome: string; side: "yes" | "no"; kind: "buy" | "sell";
  model: number; dollars?: number; qty?: number;
}): Promise<{ ok: true; qty: number; amount: number; after: number } | { ok: false; error: string }> {
  const admin = supabaseAdmin();
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: pool } = await admin.from("market_pools").select("net").eq("league_id", args.leagueId).eq("season", args.season)
      .eq("market_key", args.market).eq("outcome_id", args.outcome).maybeSingle();
    const net = pool ? Number(pool.net) : 0;
    const q = args.kind === "buy" ? quoteBuy(args.model, net, args.side, args.dollars || 0) : quoteSell(args.model, net, args.side, Math.floor(args.qty || 0));
    if (q.qty < 1) return { ok: false, error: args.kind === "buy" ? "That's not enough for one contract." : "Nothing to sell." };
    const { data, error } = await admin.rpc("market_trade", {
      p_league: args.leagueId, p_season: args.season, p_user: args.userId, p_market: args.market, p_outcome: args.outcome,
      p_side: args.side, p_kind: args.kind, p_qty: q.qty, p_amount: q.amount, p_expected_net: net, p_new_net: q.newNet,
      p_price_before: Math.round(q.before * 10000) / 10000, p_price_after: Math.round(q.after * 10000) / 10000,
    });
    if (error) return { ok: false, error: error.message };
    if (data === "ok") return { ok: true, qty: q.qty, amount: q.amount, after: q.after };
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
  if (!(await marketsShared())) return { book, shared: null as SharedState | null, leagueId: null as string | null };
  try {
    const v = await viewer(slug);
    if (!v.leagueId) return { book, shared: null, leagueId: null };
    await settleFinished(v.leagueId, season, book);
    // EA's live "played" flags: use what's cached, refresh in the background (never slows the page)
    const live = liveWeekCached(slug);
    refreshLiveWeek(slug);
    const closes = await closeTimes(v.leagueId, season);
    const closed = applyCloses(book, closes, live?.played ?? null, Boolean(live && dataWeek && weekMoved(live, dataWeek)));
    const crowd = withCrowd(closed, await loadPools(v.leagueId, season));
    const shared = await sharedState(v.leagueId, season, v.userId, v.member, index(crowd));
    return { book: crowd, shared, leagueId: v.leagueId };
  } catch (e) {
    console.error("markets shared state", slug, e);
    return { book, shared: null, leagueId: null };
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
