// Which league a Discord server is linked to. Kept in leagues.settings.discord:
//   { guildId, channelId?, linkedBy, linkedAt }
// One league per server and one server per league; linking a server moves it.
import { supabaseAdmin } from "@/lib/supabase/server";
import { updateLeagueSettings } from "@/lib/leagueSettings";
import type { AlertEvent, AlertVideo } from "./api";

export type DiscordSettings = { guildId: string; channelId?: string | null; linkedBy?: string; linkedAt?: string; videos?: Partial<Record<AlertEvent, AlertVideo>> };
export type LinkedLeague = { id: string; slug: string; name: string; is_public: boolean; settings: Record<string, unknown> };

export async function leagueForGuild(guildId: string): Promise<LinkedLeague | null> {
  const { data } = await supabaseAdmin()
    .from("leagues")
    .select("id, slug, name, is_public, settings")
    .eq("settings->discord->>guildId", guildId)
    .limit(1)
    .maybeSingle();
  return data as LinkedLeague | null;
}

export async function leagueBySlug(slug: string): Promise<LinkedLeague | null> {
  const { data } = await supabaseAdmin().from("leagues").select("id, slug, name, is_public, settings").eq("slug", slug).maybeSingle();
  return data as LinkedLeague | null;
}

/** Writes (or with null, removes) a league's Discord settings, keeping every other setting. */
export async function setDiscord(leagueId: string, discord: DiscordSettings | null) {
  const r = await updateLeagueSettings(leagueId, (settings) => {
    if (discord) settings.discord = discord;
    else delete settings.discord;
    return settings;
  });
  if (!r.ok) throw new Error(r.error);
}

/** Drops the saved Markets category/channels (the league moved to another server). */
export async function clearMarketChannels(leagueId: string) {
  await updateLeagueSettings(leagueId, (settings) => {
    if (!settings.marketChannels && !settings.gameChannels && !settings.txChannels) return null;
    delete settings.marketChannels;
    delete settings.gameChannels; // the weekly game channels belong to the old server too
    delete settings.txChannels;   // so do the Transactions channels
    return settings;
  });
}

export const discordOf = (lg: LinkedLeague) => (lg.settings?.discord || null) as DiscordSettings | null;

// ---------- personal leagues (user-installed bot: DMs, group DMs, unlinked servers) ----------
// Kept in leagues.settings.discordUsers: Discord user ids that picked this league with /myleague.

export async function leagueForUser(userId: string): Promise<LinkedLeague | null> {
  const { data } = await supabaseAdmin()
    .from("leagues")
    .select("id, slug, name, is_public, settings")
    .contains("settings", { discordUsers: [userId] })
    .limit(1)
    .maybeSingle();
  return data as LinkedLeague | null;
}

/** Makes `leagueId` this user's league (or, with null, clears it), removing them from any other league. */
export async function setUserLeague(userId: string, leagueId: string | null) {
  const db = supabaseAdmin();
  const { data: rows } = await db.from("leagues").select("id, settings").contains("settings", { discordUsers: [userId] });
  const ids = new Set((rows || []).map((r) => r.id as string));
  if (leagueId) ids.add(leagueId);
  for (const id of ids) {
    const r = await updateLeagueSettings(id, (settings) => {
      const users = new Set(((settings.discordUsers as string[]) || []).filter((u) => u !== userId));
      if (id === leagueId) users.add(userId);
      if (users.size) settings.discordUsers = [...users];
      else delete settings.discordUsers;
      return settings;
    });
    if (!r.ok) throw new Error(r.error);
  }
}

/** Downloads a saved alert video (/alertvideo) so it can go along with a reply. */
export async function loadAlertVideo(v: AlertVideo) {
  const { data } = await supabaseAdmin().storage.from("league-data").download(v.path);
  return data ? { data: Buffer.from(await data.arrayBuffer()), filename: v.filename, contentType: v.contentType } : undefined;
}

// ---------- every league a Discord user is in (/league) ----------

export type MyLeague = LinkedLeague & { why: "member" | "server" | "myleague" };

/**
 * The leagues this Discord account can pick with /league: every league their CFM Manager
 * account is a member of (needs /connect), plus their /myleague and this server's
 * linked league. Private leagues are left out (Discord answers are visible to the chat).
 */
export async function leaguesForDiscordUser(discordId: string, guildId?: string): Promise<{ leagues: MyLeague[]; connected: boolean }> {
  const { userForDiscord } = await import("@/lib/tickets");
  const db = supabaseAdmin();
  const out = new Map<string, MyLeague>();
  const add = (lg: LinkedLeague | null | undefined, why: MyLeague["why"]) => {
    if (lg && lg.is_public && !out.has(lg.id)) out.set(lg.id, { ...lg, why });
  };
  if (guildId) add(await leagueForGuild(guildId), "server");
  const userId = await userForDiscord(discordId).catch(() => null);
  if (userId) {
    const { data: m } = await db.from("league_members").select("league_id").eq("user_id", userId);
    const ids = (m || []).map((r) => r.league_id as string);
    const { data: rows } = ids.length ? await db.from("leagues").select("id, slug, name, is_public, settings").in("id", ids) : { data: [] };
    for (const lg of ((rows || []) as LinkedLeague[]).sort((a, b) => a.name.localeCompare(b.name))) add(lg, "member");
  }
  add(await leagueForUser(discordId), "myleague");
  return { leagues: [...out.values()], connected: Boolean(userId) };
}
