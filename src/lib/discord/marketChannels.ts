// Discord "Markets" category (Nick, 2026-11-13): the bot keeps one channel per game
// this week. Each channel opens with a header, then one message per bet line (who
// wins, every player prop) with Yes / No buttons showing the price; tapping one bets
// right from Discord (src/lib/discord/marketButtons.ts). Every bet is posted in the
// game's channel as it happens and that line's buttons update to the new price.
// Bets on season markets (Super Bowl, awards…) go to a #market-feed channel that stays.
// On each advance the old game channels are deleted and the new week's are created.
//
// Runs on the site (needs DISCORD_BOT_TOKEN): after each sync (the worker calls
// POST /api/leagues/<slug>/markets/discord), after each bet, after /kickoff, and
// from the /marketchannels command. The bot needs Manage Channels in the server.
import { createHash } from "node:crypto";
import { getLeagueData } from "@/lib/league/load";
import { marketBook } from "@/lib/league/markets";
import { chanceText, prices, type Market } from "@/lib/league/marketTypes";
import { supabaseAdmin } from "@/lib/supabase/server";
import { fmtET, marketsForDiscord, settleFinished } from "@/lib/marketStore";
import { bookKey, ticketsConfig } from "@/lib/tickets";
import { postPayoutReport, type PayoutState } from "./payouts";
import { discordOf, leagueBySlug } from "./links";
import { BRAND, clip, hexColor, type Embed } from "./api";
import { dc, sleep } from "./rest";
import type { Game, LeagueData, Team } from "@/lib/league/types";
import { weekTitle } from "@/lib/league/derive";

const APP_URL = (process.env.APP_URL || "https://cfm-manager-delta.vercel.app").replace(/\/$/, "");

type Entry = { messageId: string; sig: string };
type GameChannel = { channelId: string; messageId: string | null; entries?: Record<string, Entry> };
export type MarketChannels = {
  categoryId: string;
  feedChannelId?: string;
  feedMessageId?: string | null;
  weekKey: string;
  chartsWeek?: string;   // week the odds charts were last posted in #market-feed
  payouts?: PayoutState; // #previous-week-payouts (Tickets leagues)
  futuresChannelId?: string;           // #futures: Super Bowl, divisions, awards (bet buttons)
  futures?: Record<string, Entry>;
  txChannelId?: string;                // #transactions (bottom): every bet and cancel this week
  txWeek?: string;
  games: Record<string, GameChannel>;
};

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

type Component = Record<string, unknown>;
type EntryMsg = { key: string; content: string; components: Component[] };
const btn = (label: string, style: number, custom_id: string, disabled = false): Component => ({ type: 2, style, label: clip(label, 80), custom_id, disabled });
const GREEN = 3, RED = 4, GREY = 2;

/** One message per bet line for a game: who wins (both teams as buttons), then each player prop with Yes/No. */
export function gameEntries(g: Game, markets: Market[], closed: boolean): EntryMsg[] {
  const out: EntryMsg[] = [];
  const main = markets.find((m) => m.key === `game-${g.id}`);
  if (main) {
    const shut = closed || main.closed || main.settled;
    out.push({
      key: `${main.key}|*`,
      content: `**Who wins?** ${main.outcomes.map((o) => `${o.label} ${o.state === "won" ? "✅" : o.state === "lost" ? "❌" : `**${chanceText(o.p)}**`}`).join(" · ")}`,
      // once betting closes, say so in words: a greyed-out button does nothing when tapped
      components: [{ type: 1, components: shut && main.outcomes.every((o) => o.state === "open")
        ? [btn("🔒 Betting closed at kickoff", GREY, `mkx|${main.key}|closed`, true)]
        : main.outcomes.map((o, i) => o.state !== "open" ? btn(`${o.label}: ${o.state === "won" ? "won" : "lost"}`, GREY, `mkx|${main.key}|${o.id}|${i}`, true)
        : btn(`${o.label} ${prices(o).yes}%`, i === 0 ? GREEN : RED, `mk|${main.key}|${o.id}|yes|${o.label.split(" ").pop()}`.slice(0, 100), shut)) }],
    });
  }
  for (const m of markets.filter((x) => x.key.startsWith(`props-${g.id}-`))) {
    const shut = closed || m.closed || m.settled;
    for (const o of m.outcomes) {
      const pr = prices(o);
      const result = o.state === "won" ? " ✅" : o.state === "lost" ? " ❌" : "";
      out.push({
        key: `${m.key}|${o.id}`,
        content: `**${o.label}**${result}${o.state === "open" ? ` · ${chanceText(o.p)}` : ""}${o.sub ? `\n-# ${o.sub}` : ""}`,
        components: [{ type: 1, components: o.state !== "open"
          ? [btn(o.state === "won" ? "Yes won" : "No won", GREY, `mkx|${m.key}|${o.id}`, true)]
          : shut ? [btn(`🔒 Closed at kickoff · Yes ${pr.yes}%`, GREY, `mkx|${m.key}|${o.id}|closed`, true)]
          : [btn(`Yes ${pr.yes}%`, GREEN, `mk|${m.key}|${o.id}|yes`), btn(`No ${pr.no}%`, RED, `mk|${m.key}|${o.id}|no`)] }],
      });
    }
  }
  return out;
}
// Short fingerprint of a message's text + buttons, so unchanged lines aren't re-sent (and the saved state stays small).
/** The text actually sent: the line plus when its odds last changed (left out of the fingerprint, so
 *  messages are only edited when the odds or buttons change). */
const stamped = (e: EntryMsg) => `${e.content}\n-# odds updated ${new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })} ET`;
const sigOf = (e: EntryMsg) => createHash("sha1").update(JSON.stringify([e.content, e.components])).digest("base64url").slice(0, 12);

export function gameEmbed(slug: string, d: LeagueData, g: Game, markets: Market[], tickets: boolean): Embed {
  const teams = new Map(d.teams.map((t) => [t.id, t]));
  const h = teams.get(g.home) as Team, a = teams.get(g.away) as Team;
  const main = markets.find((m) => m.key === `game-${g.id}`);
  const props = markets.filter((m) => m.key.startsWith(`props-${g.id}-`));
  const unit = tickets ? "100 Tickets" : "$1";
  void prices;
  void props;
  const status = main?.status || "";
  return {
    title: `${a.city} ${a.name} at ${h.city} ${h.name}`,
    url: `${APP_URL}/l/${slug}/markets/game-${g.id}`,
    color: hexColor(h.primary) || BRAND,
    description: `${d.season.title} · ${status}\nEvery line below is a bet: tap **Yes** or **No**, enter how much, done. The price is the chance and moves with every bet. Each contract pays ${unit} if right. Link your Discord once with /connect.`,
    footer: { text: `${a.abbr} @ ${h.abbr} · updated ${fmtET(new Date())}` },
  };
}

// ---------------------------------------------------------------- #futures (Nick, 2026-11-14)
// Under #market-feed: one message per futures market with bet controls. Super Bowl: a team picker
// per conference (select menus, 16 teams each). Divisions: a button per team. Player awards: a
// picker with the top contenders plus "Any other player…", which asks for a name, since any
// eligible player can be bet on (src/lib/league/markets.ts withAwardPlayers).
const FUTURE_AWARDS = ["award-mvp", "award-opoy", "award-dpoy", "award-oroy", "award-droy"];
const pctOf = (p: number) => `${p > 0 && p < 0.01 ? "<1" : Math.round(p * 100)}%`;

export function futuresEntries(d: LeagueData, markets: Market[], tickets: boolean): EntryMsg[] {
  const out: EntryMsg[] = [];
  const conf = new Map(d.teams.map((t) => [t.id, t.conference]));
  const abbr = new Map(d.teams.map((t) => [t.id, t.abbr]));
  const shut = (m: Market) => m.settled || Boolean(m.closed);
  const pays = tickets ? "100 Tickets" : "$1";
  const open = (m: Market) => m.outcomes.filter((o) => o.state === "open").sort((a, b) => b.p - a.p);
  const head = (m: Market) => (m.settled ? `**${m.title}** · settled: ${m.outcomes.find((o) => o.state === "won")?.label ?? "—"}` : `**${m.title}**`);

  const sb = markets.find((m) => m.key === "sb");
  if (sb) {
    const top = open(sb).slice(0, 6).map((o) => `${o.label} ${pctOf(o.p)}`).join(" · ");
    const rows = ["AFC", "NFC"].map((cf) => {
      const opts = open(sb).filter((o) => conf.get(o.team ?? 0) === cf).slice(0, 25);
      return { type: 1, components: [{ type: 3, custom_id: `mksel|sb|${cf.toLowerCase()}`, placeholder: `Bet on an ${cf} team…`, disabled: shut(sb) || !opts.length,
        options: (opts.length ? opts : [{ id: "none", label: "—", p: 0 }]).map((o) => ({ label: clip(o.label, 100), value: o.id, description: `${pctOf(o.p)} · pays ${pays} if they win it all` })) }] };
    });
    out.push({ key: "sb", content: clip(`${head(sb)}\n${top}`, 2000), components: rows });
  }
  for (const m of markets.filter((x) => x.cat === "division").sort((a, b) => a.title.localeCompare(b.title))) {
    const os = open(m);
    out.push({
      key: m.key, content: clip(`${head(m)}\n${os.map((o) => `${o.label} ${pctOf(o.p)}`).join(" · ")}`, 2000),
      components: os.length ? [{ type: 1, components: os.slice(0, 5).map((o, i) => btn(`${abbr.get(o.team ?? 0) ?? o.label} ${pctOf(o.p)}`, i === 0 ? GREEN : GREY, `mk|${m.key}|${o.id}|yes|${o.label.split(" ").pop()}`.slice(0, 100), shut(m))) }] : [],
    });
  }
  for (const key of FUTURE_AWARDS) {
    const m = markets.find((x) => x.key === key);
    if (!m) continue;
    const os = open(m);
    const top = os.slice(0, 5).map((o) => `${o.label} ${pctOf(o.p)}`).join(" · ");
    out.push({
      key: m.key, content: clip(`${head(m)}\n${top}${os.length ? "\nAny eligible player can be bet on: pick one below or tap **Any other player**." : ""}`, 2000),
      components: shut(m) ? [] : [
        { type: 1, components: [{ type: 3, custom_id: `mksel|${m.key}`, placeholder: "Bet on a contender…", disabled: !os.length,
          options: (os.length ? os : [{ id: "none", label: "—", p: 0, sub: "" }]).slice(0, 25).map((o) => ({ label: clip(o.label, 100), value: o.id, description: clip(`${pctOf(o.p)}${o.sub ? ` · ${o.sub.split(" · ").slice(0, 2).join(" · ")}` : ""}`, 100) })) }] },
        { type: 1, components: [btn("Any other player…", GREY, `mkany|${m.key}`)] },
      ],
    });
  }
  return out;
}

/** Posts or edits the #futures messages (only the ones that changed). */
async function fillFutures(d: LeagueData, markets: Market[], tickets: boolean, state: MarketChannels): Promise<number> {
  if (!state.futuresChannelId) return 0;
  state.futures ||= {};
  let n = 0;
  for (const e of futuresEntries(d, markets, tickets)) {
    const sig = sigOf(e);
    const have = state.futures[e.key];
    if (have?.sig === sig) continue;
    const body = { content: stamped(e), components: e.components, allowed_mentions: { parse: [] } };
    const r = have ? await dc("PATCH", `/channels/${state.futuresChannelId}/messages/${have.messageId}`, body) : null;
    if (r?.ok) { have!.sig = sig; n++; continue; }
    const p = await dc("POST", `/channels/${state.futuresChannelId}/messages`, body);
    if (p.ok) { state.futures[e.key] = { messageId: String(p.data.id), sig }; n++; }
    await sleep(200);
  }
  return n;
}

/** Keeps the category in order: #market-feed, #futures, #previous-week-payouts, game channels, #transactions last. */
export async function orderMarketChannels(guildId: string, state: MarketChannels) {
  const r = await dc("GET", `/guilds/${guildId}/channels`);
  if (!r.ok || !Array.isArray(r.data)) return;
  const kids = (r.data as { id: string; parent_id?: string; position: number }[]).filter((c) => c.parent_id === state.categoryId).sort((a, b) => a.position - b.position);
  const ids = new Set(kids.map((c) => c.id));
  const head = [state.feedChannelId, state.futuresChannelId, state.payouts?.channelId].filter((x): x is string => Boolean(x && ids.has(x)));
  const tail = state.txChannelId && ids.has(state.txChannelId) ? [state.txChannelId] : [];
  const middle = kids.map((c) => c.id).filter((id) => !head.includes(id) && !tail.includes(id));
  const want = [...head, ...middle, ...tail];
  if (want.every((id, i) => kids[i]?.id === id)) return;
  const base = kids[0]?.position ?? 0;
  await dc("PATCH", `/guilds/${guildId}/channels`, want.map((id, i) => ({ id, position: base + i })));
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
  const view = await marketsForDiscord(slug, marketBook(d), d.season.year, d.season, d);
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

  // category (if it's gone, start a new one but keep the payouts channel and its Applied buttons)
  let keepPayouts: PayoutState | undefined;
  if (state?.categoryId) {
    const c = await dc("GET", `/channels/${state.categoryId}`);
    if (!c.ok) { keepPayouts = state.payouts; state = null; }
  } else if (state) { keepPayouts = state.payouts; state = null; }
  if (!state) {
    const cat = await dc("POST", `/guilds/${guildId}/channels`, { name: "Markets", type: 4 });
    if (!cat.ok) return cat.status === 403 ? "The bot needs the Manage Channels permission in this server to run the Markets category." : `Discord said ${cat.status}: ${String(cat.data.message || "")}`;
    state = { categoryId: String(cat.data.id), weekKey: "", games: {} };
    if (keepPayouts?.channelId && (await dc("PATCH", `/channels/${keepPayouts.channelId}`, { parent_id: state.categoryId })).ok) state.payouts = keepPayouts;
    else if (keepPayouts) state.payouts = { since: keepPayouts.since };
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

  // #futures right under the feed
  if (state.futuresChannelId && !(await dc("GET", `/channels/${state.futuresChannelId}`)).ok) { state.futuresChannelId = undefined; state.futures = {}; }
  if (!state.futuresChannelId) {
    const ch = await dc("POST", `/guilds/${guildId}/channels`, { name: "futures", type: 0, parent_id: state.categoryId, topic: `Super Bowl, division and award bets: pick and bet · ${APP_URL}/l/${slug}/markets` });
    if (ch.ok) {
      state.futuresChannelId = String(ch.data.id); state.futures = {};
      await dc("POST", `/channels/${state.futuresChannelId}/messages`, { allowed_mentions: { parse: [] }, embeds: [{ title: "Futures", url: `${APP_URL}/l/${slug}/markets`, color: BRAND,
        description: `Season-long bets: the Super Bowl, every division and the player awards. Pick a team or player below, enter how much, done. Prices are chances and move with every bet and every sync; they settle at the end of the season.${tickets ? " Contracts pay 100 Tickets." : ""} Link your Discord once with /connect.` }] });
    }
  }
  const futuresEdits = await fillFutures(d, markets, tickets, state);

  // weekly odds charts in #market-feed (once per week, after the advance)
  const key = weekKeyOf(d);
  let charts = 0;
  if (state.feedChannelId && state.chartsWeek !== key) {
    charts = await postOddsCharts(slug, d, markets, state.feedChannelId, key);
    if (charts) state.chartsWeek = key;
  }

  // settle everything that has finished (last week's games included, even after the advance)
  const cfg = tickets ? await ticketsConfig(slug).catch(() => null) : null;
  await settleFinished(lg.id, bookKey(d.season.year, Boolean(cfg)), d, marketBook(d), Boolean(cfg)).catch((e) => console.error("settle", (e as Error).message));

  // after an advance: the payouts report for the week that just ended (Tickets leagues)
  let report = "";
  if (cfg && state.weekKey && state.weekKey !== key) {
    const r = await postPayoutReport({ slug, leagueId: lg.id, guildId, categoryId: state.categoryId, d, book: marketBook(d), tickets: cfg, prev: state.payouts, title: titleOfWeek(d, state.weekKey) })
      .catch((e) => ({ state: state!.payouts || {}, text: `Payouts report failed: ${(e as Error).message}` }));
    state.payouts = r.state; report = ` ${r.text}`;
  }

  // game channels: roll over on a new week
  const games = thisWeek(d);
  let created = 0, removed = 0;
  if (state.weekKey !== key) {
    for (const g of Object.values(state.games)) { const r = await dc("DELETE", `/channels/${g.channelId}`); if (r.ok) removed++; await sleep(250); }
    state.games = {};
    state.weekKey = key;
  }
  const teams = new Map(d.teams.map((t) => [t.id, t]));
  // create missing channels one at a time (Discord limits channel creation), then fill them in parallel
  for (const g of games) {
    let gc = state.games[String(g.id)];
    if (gc && !(await dc("GET", `/channels/${gc.channelId}`)).ok) gc = undefined as unknown as GameChannel;
    if (!gc) {
      const a = teams.get(g.away), h = teams.get(g.home);
      const ch = await dc("POST", `/guilds/${guildId}/channels`, {
        name: slugName(`${a?.name ?? "away"}-at-${h?.name ?? "home"}`), type: 0, parent_id: state.categoryId,
        topic: `${d.season.title}: tap Yes/No on any line to bet · ${APP_URL}/l/${slug}/markets/game-${g.id}`,
      });
      if (!ch.ok) return ch.status === 403 ? "The bot needs the Manage Channels permission in this server." : `Discord said ${ch.status} creating a game channel.`;
      state.games[String(g.id)] = { channelId: String(ch.data.id), messageId: null, entries: {} };
      created++;
      await sleep(300);
    }
  }
  // #transactions at the bottom: every bet and cancel, a fresh channel each week
  if (state.txChannelId && (state.txWeek !== key || !(await dc("GET", `/channels/${state.txChannelId}`)).ok)) {
    if (state.txWeek !== key) await dc("DELETE", `/channels/${state.txChannelId}`);
    state.txChannelId = undefined;
  }
  if (!state.txChannelId) {
    const ch = await dc("POST", `/guilds/${guildId}/channels`, { name: "transactions", type: 0, parent_id: state.categoryId, topic: `Every bet and cancel this week · full log: ${APP_URL}/l/${slug}/markets/activity` });
    if (ch.ok) {
      state.txChannelId = String(ch.data.id); state.txWeek = key;
      await dc("POST", `/channels/${state.txChannelId}/messages`, { content: `**${d.season.year} ${d.season.title}: transactions.** Every bet and cancel this week lands here. The full log, every week, is on the site: ${APP_URL}/l/${slug}/markets/activity`, allowed_mentions: { parse: [] } });
    }
  }

  let edits = 0;
  const queue = [...games];
  await Promise.all(Array.from({ length: 8 }, async () => {
    for (let g = queue.shift(); g; g = queue.shift()) edits += await fillGameChannel(slug, d, g, markets, tickets, state!.games[String(g.id)]);
  }));
  await orderMarketChannels(guildId, state).catch(() => {});
  await saveState(lg.id, state);
  return `Markets category up to date: ${games.length} game channel${games.length === 1 ? "" : "s"} for ${d.season.title}${created ? ` (${created} new)` : ""}${removed ? `, ${removed} old removed` : ""}, ${edits} bet line${edits === 1 ? "" : "s"} posted or updated, plus #market-feed${charts ? ` (${charts} odds charts posted)` : ""}, #futures${futuresEdits ? ` (${futuresEdits} updated)` : ""} and #transactions.${report}`;
}

/** /marketchannels (Nick, 2026-11-14): deletes the Markets category and every channel in it, then builds
 *  it again from scratch. #previous-week-payouts is kept (moved into the new category) so admins don't
 *  lose Applied buttons they haven't tapped; anything not applied still carries into the next report. */
export async function rebuildMarketChannels(slug: string): Promise<string> {
  const lg = await leagueBySlug(slug);
  const guildId = lg ? discordOf(lg)?.guildId : null;
  if (!lg || !guildId) return "This league isn't linked to a Discord server (/link).";
  const old = lg.settings?.marketChannels as MarketChannels | undefined;
  let removed = 0;
  if (old?.categoryId) {
    const keep = old.payouts?.channelId;
    const r = await dc("GET", `/guilds/${guildId}/channels`);
    const kids = r.ok && Array.isArray(r.data) ? (r.data as { id: string; parent_id?: string }[]).filter((c) => c.parent_id === old.categoryId).map((c) => c.id) : [];
    const known = [old.feedChannelId, old.futuresChannelId, old.txChannelId, ...Object.values(old.games || {}).map((g) => g.channelId)].filter((x): x is string => Boolean(x));
    for (const id of new Set([...kids, ...known])) {
      if (id === keep) continue;
      if ((await dc("DELETE", `/channels/${id}`)).ok) removed++;
      await sleep(250);
    }
    if (keep) await dc("PATCH", `/channels/${keep}`, { parent_id: null });
    await dc("DELETE", `/channels/${old.categoryId}`);
  }
  // keep only what must survive: the payouts report (and the week, so no report is posted early)
  await saveState(lg.id, old ? { categoryId: "", weekKey: "", games: {}, payouts: old.payouts } : null);
  const text = await syncMarketChannels(slug);
  return `${old?.categoryId ? `Deleted the old Markets category (${removed} channel${removed === 1 ? "" : "s"}${old.payouts?.channelId ? "; #previous-week-payouts kept" : ""}) and rebuilt it. ` : ""}${text}`;
}

/** "Week 13" for a saved week key ("2027:1:12"). */
function titleOfWeek(d: LeagueData, weekKey: string) {
  const [, stage, week] = weekKey.split(":").map(Number);
  return weekTitle(d, stage, week);
}

/** /payouts: settle what's finished and post the payouts report now (replacing the last one). */
export async function postPayoutsNow(slug: string): Promise<string> {
  const lg = await leagueBySlug(slug);
  const guildId = lg ? discordOf(lg)?.guildId : null;
  if (!lg || !guildId) return "This league isn't linked to a Discord server (/link).";
  const cfg = await ticketsConfig(slug).catch(() => null);
  if (!cfg) return "This league doesn't bet Tickets, so there's nothing to pay out.";
  const state = lg.settings?.marketChannels as MarketChannels | undefined;
  if (!state?.categoryId) return "Set up the Markets category first with /marketchannels.";
  const d = await getLeagueData(slug);
  if (!d) return "No league data yet.";
  const book = marketBook(d);
  await settleFinished(lg.id, bookKey(d.season.year, true), d, book, true);
  const r = await postPayoutReport({ slug, leagueId: lg.id, guildId, categoryId: state.categoryId, d, book, tickets: cfg, prev: state.payouts, title: `${d.season.title} (so far)` });
  const db = supabaseAdmin();
  const { data } = await db.from("leagues").select("settings").eq("id", lg.id).single();
  const settings = { ...((data?.settings as Record<string, unknown>) || {}) };
  const st = settings.marketChannels as MarketChannels | undefined;
  if (st) { st.payouts = r.state; await db.from("leagues").update({ settings }).eq("id", lg.id); await orderMarketChannels(guildId, st).catch(() => {}); }
  return r.text;
}

/** The week's odds charts: Super Bowl + conferences (+ #1 seeds), then the 8 divisions. Returns charts posted. */
async function postOddsCharts(slug: string, d: LeagueData, markets: Market[], channel: string, week: string): Promise<number> {
  const embedOf = (m: Market): Embed => {
    const top = m.outcomes.filter((o) => o.state !== "lost").sort((a, b) => b.p - a.p).slice(0, 4);
    return {
      title: m.title,
      url: `${APP_URL}/l/${slug}/markets/${m.key}`,
      color: BRAND,
      description: m.settled ? `Settled: **${m.outcomes.find((o) => o.state === "won")?.label ?? "—"}**` : top.map((o) => `${o.label} **${chanceText(o.p)}**`).join(" · "),
      image: { url: `${APP_URL}/api/leagues/${encodeURIComponent(slug)}/markets/chart/${encodeURIComponent(m.key)}?w=${encodeURIComponent(week)}&t=${Date.now().toString(36)}` },
    };
  };
  const pick = (keys: string[]) => keys.map((k) => markets.find((m) => m.key === k)).filter((m): m is Market => Boolean(m));
  const groups = [
    { head: `📈 **Odds after the advance: ${d.season.title}**\nThe title races, from the market price (moves with every bet).`, list: pick(["sb", "conf-afc", "conf-nfc", "seed1-afc", "seed1-nfc"]) },
    { head: "📈 **Division races**", list: markets.filter((m) => m.cat === "division") },
  ];
  let n = 0;
  for (const g of groups) {
    if (!g.list.length) continue;
    const r = await dc("POST", `/channels/${channel}/messages`, { content: g.head, embeds: g.list.slice(0, 10).map(embedOf), allowed_mentions: { parse: [] } });
    if (r.ok) n += g.list.length;
  }
  return n;
}

/** Header + one message per bet line; only lines whose text or price changed are touched. Returns messages written. */
async function fillGameChannel(slug: string, d: LeagueData, g: Game, markets: Market[], tickets: boolean, gc: GameChannel): Promise<number> {
  let n = 0;
  const embed = gameEmbed(slug, d, g, markets, tickets);
  const ed = gc.messageId ? await dc("PATCH", `/channels/${gc.channelId}/messages/${gc.messageId}`, { embeds: [embed] }) : null;
  if (!ed?.ok) { const m = await dc("POST", `/channels/${gc.channelId}/messages`, { embeds: [embed], allowed_mentions: { parse: [] } }); gc.messageId = m.ok ? String(m.data.id) : null; n++; }
  gc.entries ||= {};
  const main = markets.find((m) => m.key === `game-${g.id}`);
  for (const e of gameEntries(g, markets, Boolean(main?.closed))) {
    const sig = sigOf(e);
    const have = gc.entries[e.key];
    if (have?.sig === sig) continue;
    const body = { content: stamped(e), components: e.components, allowed_mentions: { parse: [] } };
    const r = have ? await dc("PATCH", `/channels/${gc.channelId}/messages/${have.messageId}`, body) : null;
    if (r?.ok) { have!.sig = sig; n++; continue; }
    const p = await dc("POST", `/channels/${gc.channelId}/messages`, body);
    if (p.ok) { gc.entries[e.key] = { messageId: String(p.data.id), sig }; n++; }
  }
  return n;
}

/** Posts one bet in its game's channel (or #market-feed) and refreshes that odds message. */
export async function postBet(slug: string, bet: { who: string; marketKey: string; outcomeId?: string; outcomeLabel: string; side: "yes" | "no"; kind: "buy" | "sell"; qty: number; amount: number; before: number; after: number }) {
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
  const text = `🎟️ **${bet.who}** ${bet.kind === "buy" ? "bet" : /^(game|props)-/.test(bet.marketKey) ? "cancelled" : "cashed out"} ${bet.qty} **${bet.side === "yes" ? "Yes" : "No"}** · ${bet.outcomeLabel}${gc ? "" : ` (${m?.title ?? bet.marketKey})`} ${bet.kind === "buy" ? "for" : "and got back"} **${money}** · Yes ${yesBefore}% → ${yesAfter}%`;
  await dc("POST", `/channels/${channel}/messages`, { content: clip(text, 2000), allowed_mentions: { parse: [] } });
  if (state.txChannelId) {
    const full = gc ? text.replace(`· ${bet.outcomeLabel}`, `· ${bet.outcomeLabel} (${m?.title ?? bet.marketKey})`) : text;
    await dc("POST", `/channels/${state.txChannelId}/messages`, { content: clip(full, 2000), allowed_mentions: { parse: [] } });
  }
  if (gc && gameId) {
    // update every line whose price moved (linked prices move the other side and the player's other lines too)
    await refreshGameSettled(slug, lg.id, gameId, gc, all);
  } else {
    if (state.feedChannelId && state.feedMessageId) await dc("PATCH", `/channels/${state.feedChannelId}/messages/${state.feedMessageId}`, { embeds: [feedEmbed(slug, all.markets, all.tickets)] });
    if (state.futuresChannelId && futuresEntries(all.d, all.markets, all.tickets).some((e) => e.key === bet.marketKey)) await refreshForMarket(slug, bet.marketKey);
  }
}

/** Refreshes one game's channel (after /kickoff, or when its betting closes). */
export async function refreshGame(slug: string, gameId: number) {
  const lg = await leagueBySlug(slug);
  const state = lg?.settings?.marketChannels as MarketChannels | undefined;
  const gc = state?.games[String(gameId)];
  if (!lg || !gc || !process.env.DISCORD_BOT_TOKEN) return;
  const all = await loadAll(slug);
  if (!all) return;
  await refreshGameSettled(slug, lg.id, gameId, gc, all);
}

/** Refreshes a game channel, then checks again: if another bet moved the odds while this refresh was
 *  running (two bets close together each start one), it goes round again, so the last edit always
 *  shows the newest odds. At most 3 rounds. */
async function refreshGameSettled(slug: string, leagueId: string, gameId: number, gc: GameChannel, first: NonNullable<Awaited<ReturnType<typeof loadAll>>>) {
  let all = first;
  for (let round = 0; round < 3; round++) {
    const g = all.d.games.find((x) => x.id === gameId);
    if (!g) return;
    await fillGameChannel(slug, all.d, g, all.markets, all.tickets, gc);
    await saveEntrySigs(leagueId, gameId, gc);
    const next = await loadAll(slug);
    if (!next) return;
    const main = next.markets.find((x) => x.key === `game-${g.id}`);
    const fresh = gameEntries(g, next.markets, Boolean(main?.closed));
    if (fresh.every((e) => !gc.entries?.[e.key] || gc.entries[e.key].sig === sigOf(e))) return;
    all = next;
  }
}

/** Brings the message(s) for one market up to date (a bet button was tapped): its game channel, or #futures and the feed. */
export async function refreshForMarket(slug: string, marketKey: string) {
  const gm = /^(?:game|props)-(\d+)/.exec(marketKey);
  if (gm) return refreshGame(slug, Number(gm[1]));
  const lg = await leagueBySlug(slug);
  const state = lg?.settings?.marketChannels as MarketChannels | undefined;
  if (!lg || !state || !process.env.DISCORD_BOT_TOKEN) return;
  let all = await loadAll(slug);
  for (let round = 0; all && round < 3; round++) {
    const changed = await fillFutures(all.d, all.markets, all.tickets, state);
    if (state.feedChannelId && state.feedMessageId && round === 0) await dc("PATCH", `/channels/${state.feedChannelId}/messages/${state.feedMessageId}`, { embeds: [feedEmbed(slug, all.markets, all.tickets)] });
    if (changed) await saveFutures(lg.id, state);
    const next = await loadAll(slug);
    if (!next || futuresEntries(next.d, next.markets, next.tickets).every((e) => !state.futures?.[e.key] || state.futures[e.key].sig === sigOf(e))) return;
    all = next;
  }
}

/** Saves one game's message ids/signatures without clobbering the rest of the state. */
async function saveEntrySigs(leagueId: string, gameId: number, gc: GameChannel) {
  const db = supabaseAdmin();
  const { data } = await db.from("leagues").select("settings").eq("id", leagueId).single();
  const settings = { ...((data?.settings as Record<string, unknown>) || {}) };
  const st = settings.marketChannels as MarketChannels | undefined;
  if (!st?.games[String(gameId)]) return;
  st.games[String(gameId)] = gc;
  await db.from("leagues").update({ settings }).eq("id", leagueId);
}

/** Saves the #futures message ids/signatures without clobbering the rest of the state. */
async function saveFutures(leagueId: string, st: MarketChannels) {
  const db = supabaseAdmin();
  const { data } = await db.from("leagues").select("settings").eq("id", leagueId).single();
  const settings = { ...((data?.settings as Record<string, unknown>) || {}) };
  const cur = settings.marketChannels as MarketChannels | undefined;
  if (!cur || cur.futuresChannelId !== st.futuresChannelId) return;
  cur.futures = st.futures;
  await db.from("leagues").update({ settings }).eq("id", leagueId);
}
