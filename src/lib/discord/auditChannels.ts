// The "Audits" category (Nick, 2026-11-18: "everyone should be able to see the results … if anyone runs
// an audit command it'll post in the corresponding text channel"). One bot-only channel per audit;
// /audit makes the category the first time it's run and posts its results in the matching channel.
// State: leagues.settings.auditChannels = { categoryId, channels: { abilities: id, games: id, players: id } }.
import { updateLeagueSettings } from "@/lib/leagueSettings";
import { discordOf, leagueBySlug, type LinkedLeague } from "./links";
import { dc } from "./rest";
import { botOnly, makeChannel } from "./tradeChannels";
import { postToChannel, type Message } from "./api";
import type { AuditKind } from "./audit";

export const AUDIT_CHANNELS: { key: AuditKind; name: string; topic: string }[] = [
  { key: "abilities", name: "ability-audits", topic: "Results of /audit abilities: banned abilities and limited-ability duplicates. Posted by the bot." },
  { key: "games", name: "game-audits", topic: "Results of /audit games: catch shares and the passing/rushing TD split in user games. Posted by the bot." },
  { key: "players", name: "player-audits", topic: "Results of /audit players: position changes. Posted by the bot." },
];
export type AuditChannelsState = { categoryId: string; channels: Partial<Record<AuditKind, string>> };

type Chan = { id: string; name: string; type: number; parent_id?: string };

/** Finds or makes the Audits category and its channels (bot-only). Returns the state, or an error to show.
 *  repair: also lock existing channels again and reset their topics (/auditchannels). */
export async function ensureAuditChannels(lg: LinkedLeague, repair = false): Promise<AuditChannelsState | string> {
  const guildId = discordOf(lg)?.guildId;
  if (!guildId) return "This league isn't linked to a Discord server yet (an admin runs /link there).";
  const old = (lg.settings?.auditChannels as AuditChannelsState | undefined) || null;
  const list = await dc("GET", `/guilds/${guildId}/channels`);
  if (!list.ok) return `Discord said ${list.status} listing the server's channels.`;
  const chans = (Array.isArray(list.data) ? list.data : []) as unknown as Chan[];
  // Everything already in place: nothing to do (the usual case).
  if (!repair && old && chans.some((c) => c.id === old.categoryId) && AUDIT_CHANNELS.every((w) => chans.some((c) => c.id === old.channels[w.key]))) return old;

  let cat = (old?.categoryId && chans.find((c) => c.id === old.categoryId && c.type === 4)?.id)
    || chans.find((c) => c.type === 4 && c.name.toLowerCase() === "audits")?.id;
  if (!cat) {
    const r = await dc("POST", `/guilds/${guildId}/channels`, { name: "Audits", type: 4 });
    if (!r.ok) return r.status === 403 ? "The bot needs the Manage Channels permission to make the Audits category." : `Discord said ${r.status}: ${String(r.data.message || "")}`;
    cat = String(r.data.id);
  }
  const locked = await botOnly(guildId);
  const state: AuditChannelsState = { categoryId: cat, channels: {} };
  for (const w of AUDIT_CHANNELS) {
    const known = old?.channels?.[w.key];
    const found = (known && chans.find((c) => c.id === known)?.id) || chans.find((c) => c.type === 0 && c.parent_id === cat && c.name === w.name)?.id;
    if (found) {
      if (repair) {
        const r = await dc("PATCH", `/channels/${found}`, { permission_overwrites: locked, topic: w.topic, parent_id: cat });
        if (!r.ok && r.status === 403) return `I couldn't make #${w.name} bot-only. Give the bot the Manage Roles permission, then run /auditchannels again.`;
      }
      state.channels[w.key] = found;
      continue;
    }
    const r = await makeChannel(guildId, { name: w.name, type: 0, parent_id: cat, topic: w.topic }, locked);
    if (!r.ok) return r.status === 403 ? `The bot couldn't make #${w.name}: it needs Manage Channels.` : `Discord said ${r.status} making #${w.name}.`;
    state.channels[w.key] = String(r.data.id);
  }
  await updateLeagueSettings(lg.id, (s) => { s.auditChannels = state; return s; });
  return state;
}

/** Posts an audit's results in its channel. Returns the channel id, or an error to show. */
export async function postAudit(lg: LinkedLeague, kind: AuditKind, msg: Message, by: string): Promise<{ channelId: string } | { error: string }> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return { error: "The bot token isn't set on the site." };
  let st = await ensureAuditChannels(lg);
  if (typeof st === "string") return { error: st };
  const out: Message = { ...msg, content: `Run by ${by}`, allowed_mentions: { parse: [] } };
  let err = await postToChannel(token, st.channels[kind]!, out);
  if (err && /no longer exists/.test(err)) {
    // Someone deleted the channel since: make it again and retry once.
    await updateLeagueSettings(lg.id, (s) => { delete s.auditChannels; return s; });
    st = await ensureAuditChannels({ ...lg, settings: { ...(lg.settings || {}), auditChannels: undefined } });
    if (typeof st === "string") return { error: st };
    err = await postToChannel(token, st.channels[kind]!, out);
  }
  return err ? { error: err } : { channelId: st.channels[kind]! };
}

/** /auditchannels (admins, like /transactionchannels): make or repair the Audits category; Remove deletes it. */
export async function auditChannelsCmd(slug: string, remove: boolean): Promise<string> {
  const lg = await leagueBySlug(slug);
  if (!lg) return "This league isn't linked to a Discord server (/link).";
  if (remove) {
    const st = lg.settings?.auditChannels as AuditChannelsState | undefined;
    if (!st) return "There's no Audits category to remove.";
    for (const id of [...Object.values(st.channels), st.categoryId]) if (id) await dc("DELETE", `/channels/${id}`);
    await updateLeagueSettings(lg.id, (s) => { delete s.auditChannels; return s; });
    return "Audits category removed. /audit makes it again the next time someone runs it (or run /auditchannels).";
  }
  const st = await ensureAuditChannels(lg, true);
  if (typeof st === "string") return st;
  return [
    "Audits category ready. Only the bot can post in these; anyone can run /audit and the results land here:",
    ...AUDIT_CHANNELS.map((c) => `• <#${st.channels[c.key]}>: /audit ${c.key}`),
    "Rules are edited on the site: Admin → Rule audits.",
  ].join("\n");
}
