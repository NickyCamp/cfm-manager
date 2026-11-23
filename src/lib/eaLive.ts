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
import { eaPhase } from "@/lib/league/phase";
import { mergeSimSeen } from "@/lib/league/simSeen";
import { updateLeagueSettings } from "@/lib/leagueSettings";
import { requestSync } from "@/lib/sync";

export type LiveWeek = {
  at: number;
  played: Set<number>;          // scheduleIds of this week's games EA says are played
  week: { type: number; week: number } | null; // EA's current seasonWeekType / seasonWeek
  newPlayed: number;            // finished games EA reported that hadn't been recorded in settings.simSeen yet
};

const memo = new Map<string, { at: number; v: LiveWeek | null; pending?: Promise<LiveWeek | null> }>();
const TTL = 60_000;

async function fetchLive(slug: string): Promise<LiveWeek | null> {
  const admin = supabaseAdmin();
  const { data: lg } = await admin.from("leagues").select("id, ea_league_id, ea_connection_id").eq("slug", slug).maybeSingle();
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
  const simmed = new Map<number, boolean>();
  for (const g of hub?.gameScheduleHubInfo?.leagueSchedule || []) {
    const sg = g?.seasonGameInfo;
    if (!sg?.isGamePlayed) continue;
    played.add(Number(g.seasonGameKey));
    simmed.set(Number(g.seasonGameKey), (Number(sg.numberTimesPlayed) || 0) === 0);
  }
  const si = hub?.careerHubInfo?.seasonInfo;
  // Remember played vs simmed while EA still says it (only for the current week): a game finished after
  // the last sync but before an advance would otherwise come through unknown (simSeen.ts).
  let newPlayed = 0;
  const ph = si ? eaPhase(si) : null;
  if (ph && !ph.offseason && simmed.size) {
    await updateLeagueSettings(lg.id as string, (s) => {
      const m = mergeSimSeen(s.simSeen, simmed, ph.stage, ph.week);
      if (!m) return null;
      newPlayed = m.added;
      s.simSeen = m.next;
      return s;
    }).catch((e) => console.error("simSeen save", slug, (e as Error).message));
  }
  return { at: Date.now(), played, week: si ? { type: Number(si.seasonWeekType), week: Number(si.seasonWeek) } : null, newPlayed };
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
  // EA weekType: 0 preseason, 1 regular season, 2-6 playoffs (data stage 1 covers both), then offseason (stage 2)
  const ph = eaPhase({ seasonWeekType: live.week.type, seasonWeek: live.week.week });
  return ph.stage !== data.stage || ph.week !== data.week;
}

// When each played-but-not-yet-synced game was first noticed (per server instance).
const firstSeenPlayed = new Map<string, number>();

/**
 * EA has results our data file doesn't: the league advanced, or a game EA says was played isn't
 * final in the data yet. Season-long markets are priced from the data file, so until the next sync
 * rebuilds it their prices are out of date and trading them is paused (Nick, 2026-11-16: nobody
 * trades a market whose outcome has moved because of a game that's already been played).
 * A sync that pulled after we first saw the game played but still doesn't show it final means EA's
 * two answers disagree; that game is then ignored so the markets can't stay paused for good.
 */
export function dataBehind(slug: string, live: LiveWeek, d: { season: { stage: number; week: number }; pulledAt: string; games: { id: number; final: boolean }[] }) {
  if (weekMoved(live, d.season)) return true;
  if (!live.played.size) return false;
  const pulled = Date.parse(d.pulledAt) || 0;
  const final = new Map(d.games.map((g) => [g.id, g.final]));
  let behind = false;
  for (const id of live.played) {
    const key = `${slug}:${id}`;
    if (final.get(id) !== false) { firstSeenPlayed.delete(key); continue; } // final in the data (or not a game we carry)
    if (!firstSeenPlayed.has(key)) firstSeenPlayed.set(key, Date.now());
    if (pulled > firstSeenPlayed.get(key)! + 60_000) continue;
    behind = true;
  }
  return behind;
}
export const PAUSED_STATUS = "Paused: a game has been played, prices are updating (a few minutes)";

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

/**
 * Hourly (the first game-channels cron run each hour): asks EA about this week in each league that tracks activity
 * or has game channels. That records played vs simmed for every finished game (simSeen.ts) while EA still
 * says it, and starts a sync when a game was played since the last check, so the site and Discord catch up
 * without waiting for the 3-hourly run (Nick, 2026-11-22: a Week 1 game played just before the advance
 * showed as unknown).
 */
export async function liveCheckCron(): Promise<Record<string, string>> {
  if (process.env.LOCAL_LEAGUE_DATA || !process.env.SUPABASE_SERVICE_ROLE_KEY) return {};
  // Hourly, not every 15 minutes (Nick, 2026-11-22: "check hourly"): only the cron run in the first quarter
  // of each hour asks EA. Bets still check EA live on their own.
  if (new Date().getUTCMinutes() >= 15) return { skipped: "hourly check (runs in the first 15 minutes of each hour)" };
  const { data } = await supabaseAdmin().from("leagues").select("slug, settings").not("ea_connection_id", "is", null);
  const out: Record<string, string> = {};
  for (const lg of data || []) {
    const st = (lg.settings || {}) as Record<string, unknown>;
    if (!st.activity && !st.gameChannels && !st.marketChannels) continue;
    const slug = lg.slug as string;
    const live = await liveWeek(slug, { fresh: true });
    if (!live) { out[slug] = "EA check failed"; continue; }
    if (!live.newPlayed) { out[slug] = "nothing new"; continue; }
    const r = await requestSync(slug, { minGapMs: 10 * 60_000, mode: "auto", by: "live-check" }).catch(() => null);
    out[slug] = `${live.newPlayed} newly finished game${live.newPlayed === 1 ? "" : "s"} recorded${r?.started ? "; sync started" : ""}`;
  }
  return out;
}
