// /transactionchannels (Nick, 2026-11-17): the "Transactions" category, one bot-only channel per kind
// of league move (TX_CHANNELS in txPosts.ts). The sync worker posts into them after every sync.
// State: leagues.settings.txChannels = { categoryId, channels: { scores: id, dev: id, … } }.
import { updateLeagueSettings } from "@/lib/leagueSettings";
import { discordOf, leagueBySlug, type LinkedLeague } from "./links";
import { dc } from "./rest";
import { botOnly } from "./tradeChannels";
import { TX_CHANNELS, type TxChannelsState } from "./txPosts";
import { MANUAL_COOLDOWN_MS, requestSync } from "@/lib/sync";

const stateOf = (lg: LinkedLeague) => (lg.settings?.txChannels as TxChannelsState | undefined) || null;

/** Makes (or finds again, and locks) the Transactions category and its channels. Returns the state or an error. */
export async function ensureTxChannels(lg: LinkedLeague): Promise<TxChannelsState | string> {
  const guildId = discordOf(lg)?.guildId;
  if (!guildId) return "This league isn't linked to a Discord server yet (an admin runs /link there).";
  const list = await dc("GET", `/guilds/${guildId}/channels`);
  if (!list.ok) return `Discord said ${list.status} listing the server's channels.`;
  const chans = (Array.isArray(list.data) ? list.data : []) as unknown as { id: string; name: string; type: number; parent_id?: string }[];
  const old = stateOf(lg);
  let cat = (old?.categoryId && chans.find((c) => c.id === old.categoryId && c.type === 4)?.id)
    || chans.find((c) => c.type === 4 && c.name.toLowerCase() === "transactions")?.id;
  if (!cat) {
    const r = await dc("POST", `/guilds/${guildId}/channels`, { name: "Transactions", type: 4 });
    if (!r.ok) return r.status === 403 ? "The bot needs the Manage Channels permission to make the Transactions category." : `Discord said ${r.status}: ${String(r.data.message || "")}`;
    cat = String(r.data.id);
  }
  const locked = await botOnly(guildId);
  const state: TxChannelsState = { categoryId: cat, channels: {}, historyPostedAt: old?.historyPostedAt };
  for (const w of TX_CHANNELS) {
    const known = old?.channels?.[w.key];
    const found = (known && chans.find((c) => c.id === known)?.id) || chans.find((c) => c.type === 0 && c.parent_id === cat && c.name === w.name)?.id;
    if (found) {
      // Lock it again every run, in case someone opened it up (needs Manage Roles).
      const r = await dc("PATCH", `/channels/${found}`, { permission_overwrites: locked, topic: w.topic, parent_id: cat });
      if (!r.ok && r.status === 403) return `I couldn't make #${w.name} bot-only. Give the bot the Manage Roles permission, then run /transactionchannels again.`;
      state.channels[w.key] = found;
      continue;
    }
    const r = await dc("POST", `/guilds/${guildId}/channels`, { name: w.name, type: 0, parent_id: cat, topic: w.topic, permission_overwrites: locked });
    if (!r.ok) return r.status === 403 ? `The bot couldn't make #${w.name}: it needs Manage Channels and Manage Roles.` : `Discord said ${r.status} making #${w.name}.`;
    state.channels[w.key] = String(r.data.id);
  }
  await updateLeagueSettings(lg.id, (s) => { s.txChannels = state; return s; });
  return state;
}

/** /transactionchannels: make or repair the category; Remove deletes it; Repost history posts the saved log again. */
export async function txChannelsCmd(slug: string, action: "remove" | "history" | null, by: string): Promise<string> {
  const remove = action === "remove";
  const lg = await leagueBySlug(slug);
  if (!lg) return "This league isn't linked to a Discord server (/link).";
  if (remove) {
    const st = stateOf(lg);
    if (!st) return "There's no Transactions category to remove.";
    for (const id of [...Object.values(st.channels), st.categoryId]) if (id) await dc("DELETE", `/channels/${id}`);
    await updateLeagueSettings(lg.id, (s) => { delete s.txChannels; return s; });
    return "Transactions category removed. Run /transactionchannels again any time to bring it back.";
  }
  const st = await ensureTxChannels(lg);
  if (typeof st === "string") return st;
  if (action === "history" && st.historyPostedAt) {
    await updateLeagueSettings(lg.id, (s) => { const t = s.txChannels as TxChannelsState | undefined; if (!t) return null; delete t.historyPostedAt; return s; });
    st.historyPostedAt = undefined;
  }
  let when = "";
  if (!st.historyPostedAt) {
    // The history goes out with the next sync, so start one now.
    const r = await requestSync(slug, { minGapMs: MANUAL_COOLDOWN_MS, mode: "full", by });
    when = r.started
      ? "A sync just started: when it finishes, the bot posts everything already saved on the site (oldest first), then this sync's new moves. After that, each sync posts only what's new."
      : "The next sync posts everything already saved on the site (oldest first), then that sync's new moves. After that, each sync posts only what's new.";
  }
  return [
    "Transactions category ready. Only the bot can post in these:",
    ...TX_CHANNELS.map((c) => `• <#${st.channels[c.key]}>: ${c.title.replace(/^\S+\s/, "").toLowerCase()}`),
    when || "Each sync posts what's new. (Use action: Repost history to post the saved history again.)",
  ].join("\n");
}
