// Player nicknames (Nick, 2026-11-13): set by the person running the player's team,
// shown with the player's name on the Discord bot and the player page.
// One small JSON file per league in a private bucket: player-nicknames/<slug>.json = { "<playerId>": "Showtime" }.
import { supabaseAdmin } from "@/lib/supabase/server";
import { getLeagueData } from "@/lib/league/load";
import type { LeagueData } from "@/lib/league/types";

const BUCKET = "player-nicknames";
export const NICKNAME_MAX = 20;

let ready: Promise<void> | null = null;
function ensureBucket() {
  ready ??= (async () => {
    const admin = supabaseAdmin();
    const { data } = await admin.storage.getBucket(BUCKET);
    if (data) return;
    const { error } = await admin.storage.createBucket(BUCKET, { public: false, fileSizeLimit: 256 * 1024, allowedMimeTypes: ["application/json"] });
    if (error && !/already exists/i.test(error.message)) { ready = null; throw error; }
  })();
  return ready;
}

/** Trims and strips characters that would break names in Discord (quotes, markdown, mentions, line breaks). "" = none. */
export function cleanNickname(raw: unknown): string {
  return String(raw ?? "")
    .normalize("NFKC")
    .replace(/[\r\n\t"“”*_~`|>@\\<#]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NICKNAME_MAX)
    .trim();
}

/** Every nickname in the league (player id → nickname). Empty on any error. */
export async function leagueNicknames(slug: string): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  try {
    await ensureBucket();
    const { data, error } = await supabaseAdmin().storage.from(BUCKET).download(`${slug}.json`);
    if (error || !data) return out;
    const raw = JSON.parse(await data.text()) as Record<string, unknown>;
    for (const [id, n] of Object.entries(raw || {})) {
      const nick = cleanNickname(n);
      if (Number(id) > 0 && nick) out.set(Number(id), nick);
    }
  } catch (e) {
    console.error("nicknames", slug, e);
  }
  return out;
}

/** Set (or clear with "") one player's nickname. Read-modify-write of the league file. */
export async function saveNickname(slug: string, playerId: number, nickname: string) {
  await ensureBucket();
  const all = await leagueNicknames(slug);
  const nick = cleanNickname(nickname);
  if (nick) all.set(playerId, nick); else all.delete(playerId);
  const body = JSON.stringify(Object.fromEntries([...all].map(([id, n]) => [String(id), n])));
  const { error } = await supabaseAdmin().storage.from(BUCKET)
    .upload(`${slug}.json`, new Blob([body], { type: "application/json" }), { contentType: "application/json", upsert: true, cacheControl: "0" });
  if (error) throw new Error(error.message);
}

/** A copy of the league data with each player's nickname filled in (never mutates the shared cached data). */
export function withNicknames(d: LeagueData, nicks: Map<number, string>): LeagueData {
  if (!nicks.size) return d;
  return { ...d, players: d.players.map((p) => (nicks.has(p.id) ? { ...p, nick: nicks.get(p.id) } : p)) };
}

/** League data with nicknames applied, for the Discord bot and player pages. */
export async function getLeagueDataWithNicknames(slug: string): Promise<LeagueData | null> {
  const [d, nicks] = await Promise.all([getLeagueData(slug), leagueNicknames(slug)]);
  return d ? withNicknames(d, nicks) : null;
}
