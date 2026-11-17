// One run at a time for the jobs that create and delete Discord channels (the Markets category,
// the weekly game channels). They take a minute or more, read the saved channel ids at the start
// and write them back at the end; two runs at once (the after-sync refresh while an admin runs
// /marketchannels, a command tapped twice) each created their own copy of every channel, and only
// one copy was remembered, so the other stayed in the server for good.
//
// The lock is a timestamp in leagues.settings, claimed with a conditional update (same idea as
// the sync request in src/lib/sync.ts). It expires by itself after LOCK_MS in case a run is cut off.
import { supabaseAdmin } from "@/lib/supabase/server";
import { leagueSettingsRev, updateLeagueSettings } from "@/lib/leagueSettings";

const LOCK_MS = 6 * 60_000; // longer than the longest run (the routes allow 5 minutes)

export async function withLeagueLock<T>(leagueId: string, name: string, busy: T, fn: () => Promise<T>): Promise<T> {
  const key = `lock_${name}`;
  if (await leagueSettingsRev()) {
    // with migration 0011: claim and release without touching anyone else's settings change
    const mine = new Date().toISOString();
    const r = await updateLeagueSettings(leagueId, (s) => {
      const prev = typeof s[key] === "string" ? Date.parse(s[key] as string) : 0;
      if (prev && Date.now() - prev < LOCK_MS) return null;
      s[key] = mine;
      return s;
    });
    if (r.error === "No such league.") return fn();
    if (!r.ok || !r.changed) return busy;
    try {
      return await fn();
    } finally {
      await updateLeagueSettings(leagueId, (s) => { if (s[key] !== mine) return null; delete s[key]; return s; }).catch(() => {});
    }
  }
  const db = supabaseAdmin();
  const { data } = await db.from("leagues").select("settings").eq("id", leagueId).maybeSingle();
  if (!data) return fn(); // no such league: let the job report that itself
  const settings = (data.settings || {}) as Record<string, unknown>;
  const prev = typeof settings[key] === "string" ? (settings[key] as string) : null;
  if (prev && Date.now() - Date.parse(prev) < LOCK_MS) return busy;
  const mine = new Date().toISOString();
  let claim = db.from("leagues").update({ settings: { ...settings, [key]: mine } }).eq("id", leagueId);
  claim = prev ? claim.filter(`settings->>${key}`, "eq", prev) : claim.is(`settings->>${key}`, null);
  const { data: claimed, error } = await claim.select("id");
  if (error) return fn(); // can't lock (shouldn't happen): better to run than to block every refresh
  if (!claimed?.length) return busy;
  try {
    return await fn();
  } finally {
    try {
      const { data: now } = await db.from("leagues").select("settings").eq("id", leagueId).maybeSingle();
      const s = { ...((now?.settings as Record<string, unknown>) || {}) };
      if (now && s[key] === mine) { delete s[key]; await db.from("leagues").update({ settings: s }).eq("id", leagueId); }
    } catch { /* it expires on its own */ }
  }
}
