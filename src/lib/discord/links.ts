// Which league a Discord server is linked to. Kept in leagues.settings.discord:
//   { guildId, channelId?, linkedBy, linkedAt }
// One league per server and one server per league; linking a server moves it.
import { supabaseAdmin } from "@/lib/supabase/server";
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
  const db = supabaseAdmin();
  const { data } = await db.from("leagues").select("settings").eq("id", leagueId).single();
  const settings = { ...((data?.settings as Record<string, unknown>) || {}) };
  if (discord) settings.discord = discord;
  else delete settings.discord;
  const { error } = await db.from("leagues").update({ settings }).eq("id", leagueId);
  if (error) throw new Error(error.message);
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
    const { data } = await db.from("leagues").select("settings").eq("id", id).single();
    const settings = { ...((data?.settings as Record<string, unknown>) || {}) };
    const users = new Set(((settings.discordUsers as string[]) || []).filter((u) => u !== userId));
    if (id === leagueId) users.add(userId);
    if (users.size) settings.discordUsers = [...users];
    else delete settings.discordUsers;
    const { error } = await db.from("leagues").update({ settings }).eq("id", id);
    if (error) throw new Error(error.message);
  }
}

/** Downloads a saved alert video (/alertvideo) so it can go along with a reply. */
export async function loadAlertVideo(v: AlertVideo) {
  const { data } = await supabaseAdmin().storage.from("league-data").download(v.path);
  return data ? { data: Buffer.from(await data.arrayBuffer()), filename: v.filename, contentType: v.contentType } : undefined;
}
