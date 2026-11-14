// Discord "Markets" category (Nick, 2026-11-13): the bot keeps one channel per game
// this week, each opening with that game's odds (game line + player props), and
// posts every bet in the game's channel as it happens, updating the odds message.
// Bets on season markets (Super Bowl, awards…) go to a #market-feed channel that stays.
// On each advance the old game channels are deleted and the new week's are created.
//
// Runs on the site (needs DISCORD_BOT_TOKEN): after each sync (the worker calls
// POST /api/leagues/<slug>/markets/discord), after each bet, after /kickoff, and
// from the /marketchannels command. The bot needs Manage Channels in the server.
import { getLeagueData } from "@/lib/league/load";
import { marketBook } from "@/lib/league/markets";
import { chanceText, prices, type Market } from "@/lib/league/marketTypes";
import { supabaseAdmin } from "@/lib/supabase/server";
import { fmtET, marketsForDiscord } from "@/lib/marketStore";
import { discordOf, leagueBySlug } from "./links";
import { BRAND, clip, hexColor, type Embed } from "./api";
import type { Game, LeagueData, Team } from "@/lib/league/types";

const API = "https://discord.com/api/v10";
const APP_URL = (process.env.APP_URL || "https://cfm-manager-delta.vercel.app").replace(/\/$/, "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type GameChannel = { channelId: string; messageId: string | null };
export type MarketChannels = {
  categoryId: string;
  feedChannelId?: string;
  feedMessageId?: string | null;
  weekKey: string;
  games: Record<string, GameChannel>;
};

async function dc(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error("DISCORD_BOT_TOKEN isn't set on the site.");
  for (let i = 0; i < 4; i++) {
    const res = await fetch(`${API}${path}`, {
      method, headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data: Record<string, unknown> = {};
    try { data = text ? JSON.parse(text) : {}; } catch { /* empty */ }
    if (res.status === 429) { await sleep(Math.ceil(Number(data.retry_after || 1) * 1000) + 100); continue; }
    return { ok: res.ok, status: res.status, data };
  }
  return { ok: false, status: 429, data: { message: "rate limited" } };
}

async function saveState(leagueId: string, state: MarketChannels | null) {
  const db = supabaseAdmin();
  const { data } = await db.from("leagues").select("settings").eq("id", leagueId).single();
  const settings = { ...((data?.settings as Record<string, unknown>) || {}) };
  if (state) settings.marketChannels = state; else delete settings.marketChannels;
  await db.from("leagues").update({ settings }).eq("id", leagueId);
}

const weekKeyOf = (d: LeagueData) => `${d.season.year}:${d.season.stage}:${d.season.week}`;
const thisWeek = (d: LeagueData) => d.games.filter((g) => g.stage === d.season.stage && g.week === d.season.week && g.home && g.away);
const slugName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 90);

export function gameEmbed(slug: string, d: LeagueData, g: Game, markets: Market[], tickets: boolean): Embed {
  const teams = new Map(d.teams.map((t) => [t.id, t]));
  const h = teams.get(g.home) as Team, a = teams.get(g.away) as Team;
  const main = markets.find((m) => m.key === `game-${g.id}`);
  const props = markets.filter((m) => m.key.startsWith(`props-${g.id}-`));
  const unit = tickets ? "100 Tickets" : "$1";
  // Yes price = chance, so one number per line keeps it short; long lists split across fields (1024 chars each).
  const line = (label: string, p: number, state: Parameters<typeof prices>[0]["state"]) =>
    state === "open" ? `${label} · **${prices({ p, state }).yes}¢**` : `${label} · ${state === "won" ? "✅" : "❌"}`;
  const fields: Embed["fields"] = [];
  const addField = (name: string, lines: string[]) => {
    let chunk: string[] = [];
    let first = true;
    const flush = () => { if (chunk.length) fields.push({ name: first ? name : `${name} (cont.)`, value: chunk.join("\n") }); first = false; chunk = []; };
    for (const l of lines) { if ([...chunk, l].join("\n").length > 1000) flush(); chunk.push(clip(l, 200)); }
    flush();
  };
  if (main) addField("Who wins", main.outcomes.map((o) => line(o.label, o.p, o.state)));
  for (const m of props) addField(m.title.split(": ")[1]?.replace(/^./, (c) => c.toUpperCase()) || m.title, m.outcomes.map((o) => line(o.label, o.p, o.state)));
  const status = main?.status || "";
  return {
    title: `${a.city} ${a.name} at ${h.city} ${h.name}`,
    url: `${APP_URL}/l/${slug}/markets/game-${g.id}`,
    color: hexColor(h.primary) || BRAND,
    description: `${d.season.title} · ${status}\nPrices are the Yes price (= chance) and move with every bet. Each contract pays ${unit} if right. Bet on the site; every bet is posted below.`,
    fields: fields.slice(0, 25),
    footer: { text: `${a.abbr} @ ${h.abbr} · updated ${fmtET(new Date())}` },
  };
}

function feedEmbed(slug: string, markets: Market[], tickets: boolean): Embed {
  const pick = ["sb", "conf-afc", "conf-nfc", "award-mvp"];
  const fields = pick.map((k) => markets.find((m) => m.key === k)).filter((m): m is Market => Boolean(m)).map((m) => ({
    name: m.title,
    value: m.settled ? `Settled: ${m.outcomes.find((o) => o.state === "won")?.label ?? "—"}` : m.outcomes.filter((o) => o.state === "open").slice(0, 5).map((o) => `${o.label} · **${chanceText(o.p)}**`).join("\n") || "—",
    inline: true,
  }));
  return {
    title: "League markets",
    url: `${APP_URL}/l/${slug}/markets`,
    color: BRAND,
    description: `Season markets: Super Bowl, conferences, divisions, awards, stat leaders and win totals. Bets on them are posted here; game bets go in each game's channel.${tickets ? " Contracts pay 100 Tickets." : ""}`,
    fields,
    footer: { text: `Updated ${fmtET(new Date())}` },
  };
}

async function loadAll(slug: string) {
  const d = await getLeagueData(slug);
  if (!d) return null;
  const view = await marketsForDiscord(slug, marketBook(d), d.season.year, d.season);
  if (!view) return null;
  return { d, markets: view.book.markets, leagueId: view.leagueId, tickets: view.tickets };
}

/** Creates/refreshes the Markets category: rolls game channels on an advance, updates every odds message. */
export async function syncMarketChannels(slug: string): Promise<string> {
  const lg = await leagueBySlug(slug);
  const guildId = lg ? discordOf(lg)?.guildId : null;
  if (!lg || !guildId) return "This league isn't linked to a Discord server (/link).";
  const all = await loadAll(slug);
  if (!all) return "Markets aren't set up for this league yet.";
  const { d, markets, tickets } = all;
  let state = (lg.settings?.marketChannels as MarketChannels | undefined) || null;

  // category
  if (state?.categoryId) {
    const c = await dc("GET", `/channels/${state.categoryId}`);
    if (!c.ok) state = null;
  }
  if (!state) {
    const cat = await dc("POST", `/guilds/${guildId}/channels`, { name: "Markets", type: 4 });
    if (!cat.ok) return cat.status === 403 ? "The bot needs the Manage Channels permission in this server to run the Markets category." : `Discord said ${cat.status}: ${String(cat.data.message || "")}`;
    state = { categoryId: String(cat.data.id), weekKey: "", games: {} };
  }

  // the feed channel for season-long markets
  if (state.feedChannelId && !(await dc("GET", `/channels/${state.feedChannelId}`)).ok) { state.feedChannelId = undefined; state.feedMessageId = null; }
  if (!state.feedChannelId) {
    const ch = await dc("POST", `/guilds/${guildId}/channels`, { name: "market-feed", type: 0, parent_id: state.categoryId, topic: `Season markets and every bet on them · ${APP_URL}/l/${slug}/markets` });
    if (ch.ok) { state.feedChannelId = String(ch.data.id); state.feedMessageId = null; }
  }
  if (state.feedChannelId) {
    const embed = feedEmbed(slug, markets, tickets);
    const ed = state.feedMessageId ? await dc("PATCH", `/channels/${state.feedChannelId}/messages/${state.feedMessageId}`, { embeds: [embed] }) : null;
    if (!ed?.ok) { const m = await dc("POST", `/channels/${state.feedChannelId}/messages`, { embeds: [embed], allowed_mentions: { parse: [] } }); state.feedMessageId = m.ok ? String(m.data.id) : null; }
  }

  // game channels: roll over on a new week
  const key = weekKeyOf(d);
  const games = thisWeek(d);
  let created = 0, removed = 0;
  if (state.weekKey !== key) {
    for (const g of Object.values(state.games)) { const r = await dc("DELETE", `/channels/${g.channelId}`); if (r.ok) removed++; await sleep(250); }
    state.games = {};
    state.weekKey = key;
  }
  const teams = new Map(d.teams.map((t) => [t.id, t]));
  for (const g of games) {
    let gc = state.games[String(g.id)];
    if (gc && !(await dc("GET", `/channels/${gc.channelId}`)).ok) gc = undefined as unknown as GameChannel;
    if (!gc) {
      const a = teams.get(g.away), h = teams.get(g.home);
      const ch = await dc("POST", `/guilds/${guildId}/channels`, {
        name: slugName(`${a?.name ?? "away"}-at-${h?.name ?? "home"}`), type: 0, parent_id: state.categoryId,
        topic: `${d.season.title} odds and bets · ${APP_URL}/l/${slug}/markets/game-${g.id}`,
      });
      if (!ch.ok) return ch.status === 403 ? "The bot needs the Manage Channels permission in this server." : `Discord said ${ch.status} creating a game channel.`;
      gc = { channelId: String(ch.data.id), messageId: null };
      state.games[String(g.id)] = gc;
      created++;
      await sleep(300);
    }
    const embed = gameEmbed(slug, d, g, markets, tickets);
    const ed = gc.messageId ? await dc("PATCH", `/channels/${gc.channelId}/messages/${gc.messageId}`, { embeds: [embed] }) : null;
    if (!ed?.ok) { const m = await dc("POST", `/channels/${gc.channelId}/messages`, { embeds: [embed], allowed_mentions: { parse: [] } }); gc.messageId = m.ok ? String(m.data.id) : null; }
  }
  await saveState(lg.id, state);
  return `Markets category up to date: ${games.length} game channel${games.length === 1 ? "" : "s"} for ${d.season.title}${created ? ` (${created} new)` : ""}${removed ? `, ${removed} old removed` : ""}, plus #market-feed.`;
}

/** Posts one bet in its game's channel (or #market-feed) and refreshes that odds message. */
export async function postBet(slug: string, bet: { who: string; marketKey: string; outcomeLabel: string; side: "yes" | "no"; kind: "buy" | "sell"; qty: number; amount: number; before: number; after: number }) {
  const lg = await leagueBySlug(slug);
  const state = lg?.settings?.marketChannels as MarketChannels | undefined;
  if (!lg || !state || !process.env.DISCORD_BOT_TOKEN) return;
  const all = await loadAll(slug);
  if (!all) return;
  const m = all.markets.find((x) => x.key === bet.marketKey);
  const gameId = m?.gameId;
  const gc = gameId ? state.games[String(gameId)] : undefined;
  const channel = gc?.channelId || state.feedChannelId;
  if (!channel) return;
  const money = all.tickets ? `${Math.round(bet.amount).toLocaleString("en-US")} Tickets` : `$${bet.amount.toFixed(2)}`;
  const yesBefore = Math.round(bet.before * 100), yesAfter = Math.round(bet.after * 100);
  const text = `🎟️ **${bet.who}** ${bet.kind === "buy" ? "bet" : "sold"} ${bet.qty} **${bet.side === "yes" ? "Yes" : "No"}** · ${bet.outcomeLabel}${gc ? "" : ` (${m?.title ?? bet.marketKey})`} for **${money}** · Yes ${yesBefore}¢ → ${yesAfter}¢`;
  await dc("POST", `/channels/${channel}/messages`, { content: clip(text, 2000), allowed_mentions: { parse: [] } });
  if (gc?.messageId && gameId) {
    const g = all.d.games.find((x) => x.id === gameId);
    if (g) await dc("PATCH", `/channels/${gc.channelId}/messages/${gc.messageId}`, { embeds: [gameEmbed(slug, all.d, g, all.markets, all.tickets)] });
  } else if (state.feedChannelId && state.feedMessageId) {
    await dc("PATCH", `/channels/${state.feedChannelId}/messages/${state.feedMessageId}`, { embeds: [feedEmbed(slug, all.markets, all.tickets)] });
  }
}

/** Refreshes one game's odds message (after /kickoff). */
export async function refreshGame(slug: string, gameId: number) {
  const lg = await leagueBySlug(slug);
  const state = lg?.settings?.marketChannels as MarketChannels | undefined;
  const gc = state?.games[String(gameId)];
  if (!gc?.messageId || !process.env.DISCORD_BOT_TOKEN) return;
  const all = await loadAll(slug);
  const g = all?.d.games.find((x) => x.id === gameId);
  if (all && g) await dc("PATCH", `/channels/${gc.channelId}/messages/${gc.messageId}`, { embeds: [gameEmbed(slug, all.d, g, all.markets, all.tickets)] });
}
