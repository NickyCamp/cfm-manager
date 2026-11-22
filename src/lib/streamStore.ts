// Saving and reading each team's stream link (see streams.ts). Server only.
import { currentUser, supabaseAdmin } from "@/lib/supabase/server";
import { getLeagueData } from "@/lib/league/load";
import { isCommissioner } from "@/lib/marketStore";
import { updateLeagueSettings } from "@/lib/leagueSettings";
import { activeLinks, clearLiveCache, parseStreamUrl, youtubeChannelId, type StreamLink } from "@/lib/streams";
import type { LeagueData } from "@/lib/league/types";

const norm = (s: string) => s.trim().toLowerCase();

export async function leagueSettingsBySlug(slug: string): Promise<{ id: string; settings: Record<string, unknown> } | null> {
  const { data } = await supabaseAdmin().from("leagues").select("id, settings").eq("slug", slug).maybeSingle();
  return data ? { id: data.id as string, settings: (data.settings || {}) as Record<string, unknown> } : null;
}

/** Every team's current stream link (teamId → link). */
export async function leagueStreamLinks(slug: string, d?: LeagueData | null): Promise<Map<number, StreamLink>> {
  const [row, data] = await Promise.all([leagueSettingsBySlug(slug).catch(() => null), d ?? getLeagueData(slug).catch(() => null)]);
  return row && data ? activeLinks(row.settings, data.teams) : new Map();
}

/** Which teams the signed-in visitor may set a stream link for: the team they run (matched by the EA name
 *  they connected, like card art and nicknames), or every user-run team for a commissioner / Madden admin. */
export async function editableStreamTeams(slug: string, d?: LeagueData | null): Promise<{ teams: Set<number>; admin: boolean }> {
  const none = { teams: new Set<number>(), admin: false };
  const user = await currentUser().catch(() => null);
  if (!user) return none;
  const db = supabaseAdmin();
  const { data: lg } = await db.from("leagues").select("id").eq("slug", slug).maybeSingle();
  if (!lg) return none;
  const [data, conns, commish] = await Promise.all([
    d ?? getLeagueData(slug).catch(() => null),
    db.from("ea_connections").select("persona_name").eq("user_id", user.id).then((r) => r.data || []),
    isCommissioner(lg.id as string, user.id).catch(() => false),
  ]);
  if (!data) return none;
  const userTeams = data.teams.filter((t) => t.user);
  if (commish) return { teams: new Set(userTeams.map((t) => t.id)), admin: true };
  const mine = new Set(conns.map((c) => norm(c.persona_name || "")).filter(Boolean));
  return { teams: new Set(userTeams.filter((t) => mine.has(norm(t.user))).map((t) => t.id)), admin: false };
}

/** Saves (or with "" removes) a team's stream link. Returns the saved link, or an error to show. */
export async function saveStreamLink(slug: string, teamId: number, url: string): Promise<{ link?: StreamLink | null; error?: string; status?: number }> {
  const d = await getLeagueData(slug).catch(() => null);
  const team = d?.teams.find((t) => t.id === teamId);
  if (!d || !team) return { error: "Team not found.", status: 404 };
  if (!team.user) return { error: "That's a CPU team, so there's no one to stream it.", status: 400 };
  const { teams } = await editableStreamTeams(slug, d);
  if (!teams.has(teamId)) return { error: "Only the person running this team (or a league admin) can set its stream.", status: 403 };

  let link: StreamLink | null = null;
  if (url.trim()) {
    const p = parseStreamUrl(url);
    if (!p) return { error: "Paste the channel link, like twitch.tv/yourname, kick.com/yourname or youtube.com/@yourhandle.", status: 400 };
    link = { ...p, user: team.user, setAt: new Date().toISOString() };
    if (p.platform === "youtube") {
      const id = await youtubeChannelId(p.channel).catch(() => null);
      if (id) link.ytId = id;
      else if (process.env.YOUTUBE_API_KEY) return { error: "Couldn't find that YouTube channel. Check the @handle.", status: 400 };
    }
  }
  const row = await leagueSettingsBySlug(slug);
  if (!row) return { error: "League not found.", status: 404 };
  const res = await updateLeagueSettings(row.id, (s) => {
    const streams = { ...((s.streams || {}) as Record<string, StreamLink>) };
    if (link) streams[String(teamId)] = link; else delete streams[String(teamId)];
    return { ...s, streams };
  });
  if (!res.ok) return { error: res.error || "Couldn't save. Try again.", status: 502 };
  clearLiveCache(slug);
  return { link };
}
