// Live streams (Nick, 2026-11-22): everyone in the league streams their games on Twitch, Kick or YouTube.
// Each team's manager saves their stream link; the Live tab checks which are live right now and embeds them.
//
// Stored in leagues.settings.streams = { "<teamId>": StreamLink }. A link belongs to the person who ran the
// team when it was saved (StreamLink.user = Team.user then), so when a team changes hands the old manager's
// stream stops showing for it.
//
// Live checks (all official APIs, keys in Vercel env vars; a platform without keys is shown as "not checked"):
// - Twitch: Helix Get Streams, up to 100 channels in one call. TWITCH_CLIENT_ID + TWITCH_CLIENT_SECRET.
// - Kick:   public API GET /public/v1/channels?slug=…, up to 50 per call. KICK_CLIENT_ID + KICK_CLIENT_SECRET.
// - YouTube: each channel's RSS feed (free) for its latest video ids, then videos.list (1 quota unit per 50
//   videos) to see which is live now. search.list is avoided: it has its own 100-calls-a-day limit. YOUTUBE_API_KEY.
// Results are cached for a minute per server instance, so page views don't each hit the APIs.

export type Platform = "twitch" | "kick" | "youtube";
export type StreamLink = {
  platform: Platform;
  channel: string;   // twitch login, kick slug, or youtube "@handle" / "UC…" channel id
  ytId?: string;     // youtube channel id once known
  user: string;      // Team.user (PSN/Xbox name) when it was saved
  setAt: string;
};
export type LiveInfo = {
  live: boolean;
  checked: boolean;  // false = the platform has no keys yet, or the check failed
  title?: string;
  viewers?: number;
  startedAt?: string;
  videoId?: string;  // youtube: the live video to embed
};

export const PLATFORM_NAME: Record<Platform, string> = { twitch: "Twitch", kick: "Kick", youtube: "YouTube" };

/** Turns a pasted link (or "twitch.tv/name" without https) into a platform + channel. Null if it isn't one. */
export function parseStreamUrl(raw: string): { platform: Platform; channel: string } | null {
  let s = String(raw || "").trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.)/, "");
  const parts = u.pathname.split("/").filter(Boolean);
  if (host === "twitch.tv") {
    const login = (parts[0] || "").toLowerCase();
    return /^[a-z0-9_]{3,25}$/.test(login) && !["videos", "directory", "p", "settings"].includes(login) ? { platform: "twitch", channel: login } : null;
  }
  if (host === "kick.com") {
    const slug = (parts[0] || "").toLowerCase();
    return /^[a-z0-9_-]{1,25}$/.test(slug) && !["categories", "browse", "video", "following"].includes(slug) ? { platform: "kick", channel: slug } : null;
  }
  if (host === "youtube.com") {
    const first = decodeURIComponent(parts[0] || "");
    if (/^@[\w.-]{3,30}$/.test(first)) return { platform: "youtube", channel: first.toLowerCase() };
    if (first === "channel" && /^UC[\w-]{22}$/.test(parts[1] || "")) return { platform: "youtube", channel: parts[1] };
    return null; // /c/ and /user/ links can't be looked up reliably; the reply asks for the @handle link
  }
  return null;
}

export function streamUrl(l: Pick<StreamLink, "platform" | "channel">) {
  if (l.platform === "twitch") return `https://twitch.tv/${l.channel}`;
  if (l.platform === "kick") return `https://kick.com/${l.channel}`;
  return l.channel.startsWith("@") ? `https://youtube.com/${l.channel}` : `https://youtube.com/channel/${l.channel}`;
}

export const platformReady = (p: Platform) =>
  p === "twitch" ? Boolean(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET)
    : p === "kick" ? Boolean(process.env.KICK_CLIENT_ID && process.env.KICK_CLIENT_SECRET)
      : Boolean(process.env.YOUTUBE_API_KEY);

const norm = (s: string) => s.trim().toLowerCase();

/** The league's saved links that still belong to whoever runs each team now (teamId → link). */
export function activeLinks(settings: Record<string, unknown> | null | undefined, teams: { id: number; user: string }[]): Map<number, StreamLink> {
  const raw = (settings?.streams || {}) as Record<string, StreamLink>;
  const out = new Map<number, StreamLink>();
  for (const t of teams) {
    const l = raw[String(t.id)];
    if (l && t.user && l.user && norm(l.user) === norm(t.user) && l.platform && l.channel) out.set(t.id, l);
  }
  return out;
}

// ------------------------------------------------------------------ platform checks

const TIMEOUT = 6000;
type Token = { value: string; until: number };
const tokens: Partial<Record<"twitch" | "kick", Token>> = {};

async function appToken(p: "twitch" | "kick"): Promise<string> {
  const t = tokens[p];
  if (t && t.until > Date.now() + 60_000) return t.value;
  const url = p === "twitch" ? "https://id.twitch.tv/oauth2/token" : "https://id.kick.com/oauth/token";
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: (p === "twitch" ? process.env.TWITCH_CLIENT_ID : process.env.KICK_CLIENT_ID)!,
    client_secret: (p === "twitch" ? process.env.TWITCH_CLIENT_SECRET : process.env.KICK_CLIENT_SECRET)!,
  });
  const res = await fetch(url, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(TIMEOUT), cache: "no-store" });
  if (!res.ok) throw new Error(`${p} token ${res.status}`);
  const j = (await res.json()) as { access_token: string; expires_in?: number };
  tokens[p] = { value: j.access_token, until: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return j.access_token;
}

const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

async function checkTwitch(logins: string[]): Promise<Map<string, LiveInfo>> {
  const out = new Map<string, LiveInfo>();
  const token = await appToken("twitch");
  for (const part of chunk(logins, 100)) {
    const q = part.map((l) => `user_login=${encodeURIComponent(l)}`).join("&");
    const res = await fetch(`https://api.twitch.tv/helix/streams?first=100&${q}`, {
      headers: { "Client-Id": process.env.TWITCH_CLIENT_ID!, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT), cache: "no-store",
    });
    if (res.status === 401) delete tokens.twitch;
    if (!res.ok) throw new Error(`twitch streams ${res.status}`);
    const j = (await res.json()) as { data: { user_login: string; type: string; title: string; viewer_count: number; started_at: string }[] };
    for (const l of part) out.set(l, { live: false, checked: true });
    for (const s of j.data || []) if (s.type === "live") out.set(s.user_login.toLowerCase(), { live: true, checked: true, title: s.title, viewers: s.viewer_count, startedAt: s.started_at });
  }
  return out;
}

async function checkKick(slugs: string[]): Promise<Map<string, LiveInfo>> {
  const out = new Map<string, LiveInfo>();
  const token = await appToken("kick");
  for (const part of chunk(slugs, 50)) {
    const q = part.map((s) => `slug=${encodeURIComponent(s)}`).join("&");
    const res = await fetch(`https://api.kick.com/public/v1/channels?${q}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT), cache: "no-store",
    });
    if (res.status === 401) delete tokens.kick;
    if (!res.ok) throw new Error(`kick channels ${res.status}`);
    const j = (await res.json()) as { data: { slug: string; stream_title?: string; stream?: { is_live?: boolean; viewer_count?: number; start_time?: string } }[] };
    for (const s of part) out.set(s, { live: false, checked: true });
    // only the fields we show are kept (the response also carries the stream key, which must never be passed on)
    for (const c of j.data || []) {
      if (c.stream?.is_live) out.set(c.slug.toLowerCase(), { live: true, checked: true, title: c.stream_title, viewers: c.stream.viewer_count, startedAt: c.stream.start_time });
    }
  }
  return out;
}

const ytIds = new Map<string, string>(); // "@handle" → channel id, remembered per server instance

/** "@handle" → "UC…" (channels.list forHandle, 1 quota unit). Channel ids pass straight through. */
export async function youtubeChannelId(channel: string): Promise<string | null> {
  if (channel.startsWith("UC")) return channel;
  const hit = ytIds.get(channel);
  if (hit) return hit;
  if (!process.env.YOUTUBE_API_KEY) return null;
  const res = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${encodeURIComponent(channel)}&key=${process.env.YOUTUBE_API_KEY}`, { signal: AbortSignal.timeout(TIMEOUT), cache: "no-store" });
  if (!res.ok) throw new Error(`youtube channels ${res.status}`);
  const id = ((await res.json()) as { items?: { id: string }[] }).items?.[0]?.id ?? null;
  if (id) ytIds.set(channel, id);
  return id;
}

async function checkYouTube(channels: { channel: string; ytId?: string }[]): Promise<Map<string, LiveInfo>> {
  const out = new Map<string, LiveInfo>();
  // 1. latest videos per channel from its RSS feed (a live stream shows up there once it starts)
  const recent = new Map<string, string>(); // video id → channel key
  await Promise.all(channels.map(async (c) => {
    try {
      const id = c.ytId || (await youtubeChannelId(c.channel));
      if (!id) return;
      const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`, { signal: AbortSignal.timeout(TIMEOUT), cache: "no-store" });
      if (!res.ok) return;
      const xml = await res.text();
      for (const m of [...xml.matchAll(/<yt:videoId>([\w-]{11})<\/yt:videoId>/g)].slice(0, 5)) recent.set(m[1], c.channel);
      out.set(c.channel, { live: false, checked: true });
    } catch { /* left unchecked */ }
  }));
  // 2. which of those are live right now (50 videos per call, 1 quota unit each)
  for (const part of chunk([...recent.keys()], 50)) {
    const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,liveStreamingDetails&id=${part.join(",")}&key=${process.env.YOUTUBE_API_KEY}`, { signal: AbortSignal.timeout(TIMEOUT), cache: "no-store" });
    if (!res.ok) throw new Error(`youtube videos ${res.status}`);
    const j = (await res.json()) as { items?: { id: string; snippet?: { title?: string; liveBroadcastContent?: string }; liveStreamingDetails?: { concurrentViewers?: string; actualStartTime?: string; actualEndTime?: string } }[] };
    for (const v of j.items || []) {
      const live = v.snippet?.liveBroadcastContent === "live" && !v.liveStreamingDetails?.actualEndTime;
      const key = recent.get(v.id)!;
      if (live && !out.get(key)?.live) {
        out.set(key, { live: true, checked: true, title: v.snippet?.title, videoId: v.id, startedAt: v.liveStreamingDetails?.actualStartTime,
          viewers: v.liveStreamingDetails?.concurrentViewers ? Number(v.liveStreamingDetails.concurrentViewers) : undefined });
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ league check (cached)

const cache = new Map<string, { at: number; result: Map<number, LiveInfo> }>();
const CACHE_MS = 60_000;

/** Live status for each team with a link (teamId → LiveInfo). Never throws: a failed platform reads "not checked".
 *  fresh: skip the 1-minute cache (Discord /live and /redzone check at the moment they're typed). */
export async function liveStatus(slug: string, links: Map<number, StreamLink>, opts: { fresh?: boolean } = {}): Promise<Map<number, LiveInfo>> {
  const sig = [...links].map(([t, l]) => `${t}:${l.platform}:${l.channel}`).sort().join("|");
  const key = `${slug}|${sig}`;
  const hit = cache.get(key);
  if (hit && !opts.fresh && Date.now() - hit.at < CACHE_MS) return hit.result;

  const by = (p: Platform) => [...links.values()].filter((l) => l.platform === p);
  const run = async <T,>(p: Platform, f: () => Promise<Map<string, T>>) => {
    if (!by(p).length || !platformReady(p)) return new Map<string, T>();
    try { return await f(); } catch (e) { console.error("live check", p, slug, e); return new Map<string, T>(); }
  };
  const [tw, ki, yt] = await Promise.all([
    run("twitch", () => checkTwitch([...new Set(by("twitch").map((l) => l.channel))])),
    run("kick", () => checkKick([...new Set(by("kick").map((l) => l.channel))])),
    run("youtube", () => checkYouTube(by("youtube"))),
  ]);
  const result = new Map<number, LiveInfo>();
  for (const [team, l] of links) {
    const m = l.platform === "twitch" ? tw : l.platform === "kick" ? ki : yt;
    result.set(team, m.get(l.channel) ?? { live: false, checked: false });
  }
  cache.set(key, { at: Date.now(), result });
  return result;
}

export function clearLiveCache(slug: string) {
  for (const k of cache.keys()) if (k.startsWith(`${slug}|`)) cache.delete(k);
}
