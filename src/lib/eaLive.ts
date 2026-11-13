// Live "has this game been played?" check straight from EA, for closing game and
// player-prop markets the moment a game is played (Nick, 2026-11-13). Without it,
// someone could play their game and bet on it before the next sync shows the result.
//
// One league-hub call (the same lightweight call the sync worker makes first), using
// the league's linked EA account. Cached for a minute per league.
import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { decryptJson, encryptJson } from "@/lib/crypto";
import { blazeLogin, leagueHub, refreshToken, type EaToken } from "@/lib/ea/client";

export type LiveWeek = {
  at: number;
  played: Set<number>;          // scheduleIds of this week's games EA says are played
  week: { type: number; week: number } | null; // EA's current seasonWeekType / seasonWeek
};

const memo = new Map<string, { at: number; v: LiveWeek | null; pending?: Promise<LiveWeek | null> }>();
const TTL = 60_000;

async function fetchLive(slug: string): Promise<LiveWeek | null> {
  const admin = supabaseAdmin();
  const { data: lg } = await admin.from("leagues").select("ea_league_id, ea_connection_id").eq("slug", slug).maybeSingle();
  if (!lg?.ea_connection_id) return null;
  const { data: conn } = await admin.from("ea_connections").select("id, token_ciphertext").eq("id", lg.ea_connection_id).maybeSingle();
  if (!conn) return null;
  const old = decryptJson<EaToken>(conn.token_ciphertext);
  const tok = await refreshToken(old);
  if (tok.accessToken !== old.accessToken) {
    await admin.from("ea_connections").update({ token_ciphertext: encryptJson(tok), updated_at: new Date().toISOString() }).eq("id", conn.id);
  }
  const s = await blazeLogin(tok);
  const hub = await leagueHub(tok, s, Number(lg.ea_league_id));
  const played = new Set<number>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const g of hub?.gameScheduleHubInfo?.leagueSchedule || []) if (g?.seasonGameInfo?.isGamePlayed) played.add(Number(g.seasonGameKey));
  const si = hub?.careerHubInfo?.seasonInfo;
  return { at: Date.now(), played, week: si ? { type: Number(si.seasonWeekType), week: Number(si.seasonWeek) } : null };
}

const withTimeout = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("EA took too long")), ms))]);

/** EA's live view of this week, or null if it can't be had (no linked account, EA down…). */
export async function liveWeek(slug: string, { fresh = false } = {}): Promise<LiveWeek | null> {
  if (process.env.LOCAL_LEAGUE_DATA || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const hit = memo.get(slug);
  if (hit && !fresh && Date.now() - hit.at < TTL) return hit.v;
  if (hit?.pending) return hit.pending;
  const pending = withTimeout(fetchLive(slug), 8000).catch((e) => { console.error("ea live week", slug, (e as Error).message); return null; });
  memo.set(slug, { at: hit?.at ?? 0, v: hit?.v ?? null, pending });
  const v = await pending;
  // keep the last good answer if EA failed this time (but don't count it as fresh)
  memo.set(slug, v ? { at: Date.now(), v } : { at: hit?.at ?? 0, v: hit?.v ?? null });
  return v;
}

/** EA has moved past the week our data shows (an advance happened since the last sync). */
export function weekMoved(live: LiveWeek, data: { stage: number; week: number }) {
  if (!live.week) return false;
  // EA weekType: 0 preseason, 1 regular season, 2+ playoffs (data stage 1 covers both)
  const liveStage = live.week.type === 0 ? 0 : 1;
  return liveStage !== data.stage || live.week.week !== data.week;
}

/** Whatever is cached (possibly stale or null), without calling EA. */
export function liveWeekCached(slug: string): LiveWeek | null {
  const hit = memo.get(slug);
  return hit && Date.now() - hit.at < 10 * TTL ? hit.v : null;
}
/** Refresh the cache in the background if it's older than a minute. */
export function refreshLiveWeek(slug: string) {
  const hit = memo.get(slug);
  if (hit && (hit.pending || Date.now() - hit.at < TTL)) return;
  try { after(() => liveWeek(slug).then(() => {}, () => {})); }
  catch { void liveWeek(slug).catch(() => {}); } // outside a request (scripts)
}
