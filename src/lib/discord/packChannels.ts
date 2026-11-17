// /packchannels (Nick, 2026-11-17): a "Packs" category so /pack and /packs don't spam the rest of the server.
// Once it exists, /pack and /packs only work in channels (or threads) inside that category in the
// league's linked server. DMs, group DMs and other servers are unchanged.
// State: leagues.settings.packChannels = { categoryId, channelId }.
import { updateLeagueSettings } from "@/lib/leagueSettings";
import { discordOf, leagueBySlug, type LinkedLeague } from "./links";
import { dc } from "./rest";

export type PackChannelsState = { categoryId: string; channelId: string };
export const PACK_CATEGORY = "Packs";
const OPENING = { name: "pack-opening", topic: "Open packs with /pack · leaderboard with /packs. Packs only work in this category." };

export const packStateOf = (lg: LinkedLeague | null | undefined) =>
  (lg?.settings?.packChannels as PackChannelsState | undefined) || null;

/** The channel a command ran in, as Discord sends it with the interaction. */
export type InteractionChannel = { id: string; type: number; parent_id?: string | null };
const THREAD_TYPES = new Set([10, 11, 12]);

/**
 * Whether /pack may run here. null = yes; otherwise the (private) reason to show.
 * Only limits the league's own linked server, and only once /packchannels has been run there.
 */
export function packChannelProblem(lg: LinkedLeague | null, guildId: string | undefined, ch: InteractionChannel | undefined): string | null {
  if (!guildId || !lg || discordOf(lg)?.guildId !== guildId) return null;
  const st = packStateOf(lg);
  if (!st || !ch) return null;
  const inCategory = ch.id === st.categoryId || ch.parent_id === st.categoryId
    // A thread's parent is its channel: allow threads under #pack-opening (or any channel we made).
    || (THREAD_TYPES.has(ch.type) && ch.parent_id === st.channelId);
  return inCategory ? null : `🎴 Packs live in the **${PACK_CATEGORY}** category: head to <#${st.channelId}> and run it there.`;
}

/** Makes (or finds again) the Packs category and #pack-opening. */
async function ensurePackChannels(lg: LinkedLeague): Promise<PackChannelsState | string> {
  const guildId = discordOf(lg)?.guildId;
  if (!guildId) return "This league isn't linked to a Discord server yet (an admin runs /link there).";
  const list = await dc("GET", `/guilds/${guildId}/channels`);
  if (!list.ok) return `Discord said ${list.status} listing the server's channels.`;
  const chans = (Array.isArray(list.data) ? list.data : []) as unknown as { id: string; name: string; type: number; parent_id?: string }[];
  const old = packStateOf(lg);
  let cat = (old?.categoryId && chans.find((c) => c.id === old.categoryId && c.type === 4)?.id)
    || chans.find((c) => c.type === 4 && c.name.toLowerCase() === PACK_CATEGORY.toLowerCase())?.id;
  if (!cat) {
    const r = await dc("POST", `/guilds/${guildId}/channels`, { name: PACK_CATEGORY, type: 4 });
    if (!r.ok) return r.status === 403 ? "The bot needs the Manage Channels permission to make the Packs category." : `Discord said ${r.status}: ${String(r.data.message || "")}`;
    cat = String(r.data.id);
  }
  let chan = (old?.channelId && chans.find((c) => c.id === old.channelId)?.id)
    || chans.find((c) => c.type === 0 && c.parent_id === cat && c.name === OPENING.name)?.id;
  if (chan) {
    await dc("PATCH", `/channels/${chan}`, { parent_id: cat, topic: OPENING.topic });
  } else {
    const r = await dc("POST", `/guilds/${guildId}/channels`, { name: OPENING.name, type: 0, parent_id: cat, topic: OPENING.topic });
    if (!r.ok) return r.status === 403 ? `The bot couldn't make #${OPENING.name}: it needs Manage Channels.` : `Discord said ${r.status} making #${OPENING.name}.`;
    chan = String(r.data.id);
  }
  const state: PackChannelsState = { categoryId: cat, channelId: chan };
  await updateLeagueSettings(lg.id, (s) => { s.packChannels = state; return s; });
  return state;
}

/** /packchannels: make or repair the category; Remove deletes it and lets packs run anywhere again. */
export async function packChannelsCmd(slug: string, remove: boolean): Promise<string> {
  const lg = await leagueBySlug(slug);
  if (!lg) return "This league isn't linked to a Discord server (/link).";
  if (remove) {
    const st = packStateOf(lg);
    if (!st) return "There's no Packs category to remove.";
    for (const id of [st.channelId, st.categoryId]) if (id) await dc("DELETE", `/channels/${id}`);
    await updateLeagueSettings(lg.id, (s) => { delete s.packChannels; return s; });
    return "Packs category removed. /pack works in any channel again until you run /packchannels.";
  }
  const st = await ensurePackChannels(lg);
  if (typeof st === "string") return st;
  return [
    `Packs category ready: <#${st.channelId}>.`,
    "From now on /pack and /packs only work in channels inside the **Packs** category (and threads under them) in this server.",
    "Run them anywhere else and the bot answers privately with a pointer here. Add more channels to the category any time; they count too.",
  ].join("\n");
}
