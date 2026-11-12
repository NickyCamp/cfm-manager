// Which league a Discord server is linked to. Kept in leagues.settings.discord:
//   { guildId, channelId?, linkedBy, linkedAt }
// One league per server and one server per league; linking a server moves it.
import { supabaseAdmin } from "@/lib/supabase/server";

export type DiscordSettings = { guildId: string; channelId?: string | null; linkedBy?: string; linkedAt?: string };
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
