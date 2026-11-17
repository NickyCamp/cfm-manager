// Trade proposals in Discord (Nick, 2026-11-17): a "Trades" category with a #trade-proposals
// channel. Two managers agree on a trade, one of them enters it in the site's Trade Tool and
// hits Submit; the bot posts it there with a picture of who gets what, each team's cap and
// starters before → after, and the trade score (tradeImage.tsx).
//
// The category is made by /tradechannels (admins), or on the first submit if it's missing.
// State: leagues.settings.tradeChannels = { categoryId, channelId, recent: { [trade key]: ISO time } }.
import { updateLeagueSettings } from "@/lib/leagueSettings";
import { getLeagueData } from "@/lib/league/load";
import { buildTradeData, parseTrade } from "@/lib/league/tradeData";
import { ROUND, scoreTrade } from "@/lib/league/tradeMath";
import { money } from "@/lib/league/format";
import { discordOf, leagueBySlug, type LinkedLeague } from "./links";
import { hexColor } from "./api";
import { channelGone, dc } from "./rest";
import { renderTrade } from "./tradeImage";
import { teamRoles } from "./gameChannels";

const API = "https://discord.com/api/v10";
const APP_URL = (process.env.APP_URL || "https://cfm-manager-delta.vercel.app").replace(/\/$/, "");
export type TradeChannels = { categoryId: string; channelId: string; recent?: Record<string, string> };

const stateOf = (lg: LinkedLeague) => (lg.settings?.tradeChannels as TradeChannels | undefined) || null;
async function saveState(leagueId: string, state: TradeChannels | null) {
  await updateLeagueSettings(leagueId, (settings) => {
    if (state) settings.tradeChannels = state; else delete settings.tradeChannels;
    return settings;
  });
}

/** Makes (or finds again) the Trades category and #trade-proposals. Returns the state or an error. */
export async function ensureTradeChannels(lg: LinkedLeague): Promise<TradeChannels | string> {
  const guildId = discordOf(lg)?.guildId;
  if (!guildId) return "This league isn't linked to a Discord server yet (an admin runs /link there).";
  let state = stateOf(lg);
  if (state && !(await channelGone(state.channelId)) && !(await channelGone(state.categoryId))) return state;
  // Re-use a category the server already has named "Trades".
  const list = await dc("GET", `/guilds/${guildId}/channels`);
  const chans = (Array.isArray(list.data) ? list.data : []) as unknown as { id: string; name: string; type: number; parent_id?: string }[];
  let cat = chans.find((c) => c.type === 4 && c.name.toLowerCase() === "trades")?.id;
  if (!cat) {
    const r = await dc("POST", `/guilds/${guildId}/channels`, { name: "Trades", type: 4 });
    if (!r.ok) return r.status === 403 ? "The bot needs the Manage Channels permission in the server to make the Trades category." : `Discord said ${r.status}: ${String(r.data.message || "")}`;
    cat = String(r.data.id);
  }
  let ch = chans.find((c) => c.type === 0 && c.parent_id === cat && c.name === "trade-proposals")?.id;
  if (!ch) {
    const r = await dc("POST", `/guilds/${guildId}/channels`, {
      name: "trade-proposals", type: 0, parent_id: cat,
      topic: "Agreed trades, submitted from the CFM Manager Trade Tool: who gets what, cap impact and the trade score.",
    });
    if (!r.ok) return r.status === 403 ? "The bot needs the Manage Channels permission in the server." : `Discord said ${r.status} making #trade-proposals.`;
    ch = String(r.data.id);
  }
  state = { categoryId: cat, channelId: ch, recent: state?.recent };
  await saveState(lg.id, state);
  return state;
}

/** /tradechannels: make the category; action remove deletes it. */
export async function tradeChannelsCmd(slug: string, remove: boolean): Promise<string> {
  const lg = await leagueBySlug(slug);
  if (!lg) return "This league isn't linked to a Discord server (/link).";
  if (remove) {
    const st = stateOf(lg);
    if (!st) return "There's no Trades category to remove.";
    await dc("DELETE", `/channels/${st.channelId}`);
    await dc("DELETE", `/channels/${st.categoryId}`);
    await saveState(lg.id, null);
    return "Trades category removed. Run /tradechannels again any time to bring it back.";
  }
  const st = await ensureTradeChannels(lg);
  if (typeof st === "string") return st;
  return `Trades category ready: <#${st.channelId}>. When two managers agree on a trade, either one enters it in the Trade Tool (${APP_URL}/l/${slug}/trades) and hits **Submit to Discord**; it posts there with the cap impact and trade score.`;
}

/**
 * Posts a trade from the Trade Tool (query: a, b, pa, pb, ka, kb as in the tool's URL).
 * `by`: who submitted it (Discord id if linked, else their name). Returns a message, or throws with
 * a user-facing reason.
 */
export async function postTradeProposal(slug: string, query: Record<string, string>, by: { discordId?: string; name: string }) {
  const lg = await leagueBySlug(slug);
  if (!lg || !discordOf(lg)?.guildId) throw new Error("This league isn't linked to a Discord server yet. An admin runs /link in the league's server first.");
  const d = await getLeagueData(slug);
  if (!d) throw new Error("No league data yet.");
  const td = buildTradeData(d);
  const { a, b } = parseTrade(td, query);
  if (!a.team || !b.team || a.team === b.team) throw new Error("Pick two different teams.");
  if (!a.players.length && !a.picks.length && !b.players.length && !b.picks.length) throw new Error("Add what each team sends first.");
  const s = scoreTrade({ players: td.players, teams: td.teams, years: td.years, firstDraft: td.firstDraft, a, b });
  if (!s) throw new Error("Couldn't score that trade.");

  // The same trade twice within 10 minutes is a double tap.
  const key = [query.a, query.b, a.players.join(","), b.players.join(","), a.picks.map((k) => `${k.y}-${k.r}`).join(","), b.picks.map((k) => `${k.y}-${k.r}`).join(",")].join("|");
  const prev = stateOf(lg)?.recent?.[key];
  if (prev && Date.now() - Date.parse(prev) < 10 * 60_000) throw new Error("This exact trade was just posted.");

  const st = await ensureTradeChannels(lg);
  if (typeof st === "string") throw new Error(st);

  const ta = d.teams.find((t) => t.id === a.team)!, tb = d.teams.find((t) => t.id === b.team)!;
  const img = await renderTrade(d, s, td.players, lg.name || slug.toUpperCase());
  const png = Buffer.from(await img.arrayBuffer());

  const roles = await teamRoles(discordOf(lg)!.guildId, d.teams).catch(() => new Map<number, string>());
  const tag = (t: typeof ta) => (roles.get(t.id) ? `<@&${roles.get(t.id)}>` : `**${t.name}**`);
  const byId = new Map(td.players.map((p) => [p.id, p]));
  const list = (ids: number[], picks: { y: number; r: number }[]) =>
    [...ids.map((id) => { const p = byId.get(id)!; return `${p.pos} ${p.n} (${p.ovr} OVR, ${p.ur} UR, ${money(p.hits[0])})`; }), ...picks.map((k) => `${k.y} ${ROUND[k.r]} round pick`)].join("\n") || "Nothing";
  const link = `${APP_URL}/l/${slug}/trades?${new URLSearchParams(Object.entries(query).filter(([, v]) => v)).toString()}`;
  const payload = {
    content: `📨 Trade proposal: ${tag(ta)} ⇄ ${tag(tb)}, submitted by ${by.discordId ? `<@${by.discordId}>` : `**${by.name}**`}`,
    embeds: [{
      title: `${ta.abbr} ⇄ ${tb.abbr}: ${s.verdict} (${ta.abbr} ${s.score} · ${100 - s.score} ${tb.abbr})`,
      url: link,
      color: hexColor(s.favored?.primary || ta.primary),
      fields: [
        { name: `${ta.name} get (grade ${s.a.grade})`, value: list(b.players, b.picks).slice(0, 1024), inline: true },
        { name: `${tb.name} get (grade ${s.b.grade})`, value: list(a.players, a.picks).slice(0, 1024), inline: true },
      ],
      image: { url: "attachment://trade.png" },
      footer: { text: `${s.a.capNow.after < 0 || s.b.capNow.after < 0 ? "⚠ A team would be over the cap; Madden won't accept it yet. · " : ""}Open the link to see it in the Trade Tool` },
    }],
    allowed_mentions: { roles: [...roles.values()].filter((r) => r === roles.get(ta.id) || r === roles.get(tb.id)), users: by.discordId ? [by.discordId] : [] },
    attachments: [{ id: 0, filename: "trade.png" }],
  };
  const form = new FormData();
  form.append("payload_json", JSON.stringify(payload));
  form.append("files[0]", new Blob([new Uint8Array(png)], { type: "image/png" }), "trade.png");
  const res = await fetch(`${API}/channels/${st.channelId}/messages`, { method: "POST", headers: { authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` }, body: form });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("trade proposal post", res.status, text);
    throw new Error(res.status === 403 ? "The bot can't post in #trade-proposals. Give it View Channel, Send Messages, Embed Links and Attach Files there." : `Discord said ${res.status}.`);
  }
  // Remember it for the double-tap check (keep the last 30).
  const recent = Object.fromEntries([...Object.entries(st.recent || {}), [key, new Date().toISOString()]].slice(-30));
  await saveState(lg.id, { ...st, recent });
  return `Posted in #trade-proposals: ${s.verdict}.`;
}
