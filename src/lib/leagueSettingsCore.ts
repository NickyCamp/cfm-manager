// Safe changes to leagues.settings (one JSON blob holding every per-league option: Discord link,
// bet caps, house rules, awards, channel ids, sync request, locks...).
//
// Before 2026-11-16 every writer read the whole blob, changed its own key and wrote the whole blob
// back. Two writers a moment apart (a page visit recording a sync request while an admin saved a bet
// cap) meant the second one put back the first one's old copy and that change was gone.
//
// Now every writer goes through updateSettings(): read settings + settings_rev, change, and write
// only if settings_rev is still what was read; otherwise read again and redo the change. The
// database bumps settings_rev on every settings change (supabase/migrations/0011_league_settings_rev.sql),
// so even a writer that doesn't use this helper is noticed.
//
// Until that migration has run, the column doesn't exist: the helper then works the old way
// (plain read, change, write) so nothing breaks, just without the protection.
//
// No Next.js imports here: the sync worker (plain Node) uses it with its own client.
import type { SupabaseClient } from "@supabase/supabase-js";

export type Settings = Record<string, unknown>;
/** Return the new settings, or null to leave them alone (nothing to change, or a claim someone else holds). */
export type Mutate = (current: Settings) => Settings | null;
export type SettingsResult = { ok: boolean; changed: boolean; settings: Settings | null; error?: string };

let revColumn: boolean | null = null; // null = not checked yet on this server instance
let revCheckedAt = 0;
const missingColumn = (e: { code?: string; message?: string } | null) => Boolean(e && (e.code === "42703" || /settings_rev/.test(e.message || "")));

/** Has the settings_rev migration run? (Rechecked every few minutes while the answer is no.) */
export async function settingsRevAvailable(db: SupabaseClient): Promise<boolean> {
  if (revColumn === true || (revColumn === false && Date.now() - revCheckedAt < 5 * 60_000)) return revColumn;
  const { error } = await db.from("leagues").select("settings_rev").limit(1);
  revColumn = !error;
  revCheckedAt = Date.now();
  if (error && !missingColumn(error)) revColumn = false; // some other failure: treat as unavailable for now
  return revColumn;
}

export async function updateSettings(db: SupabaseClient, leagueId: string, mutate: Mutate, extra: Record<string, unknown> = {}): Promise<SettingsResult> {
  const withRev = await settingsRevAvailable(db);
  for (let attempt = 0; attempt < 8; attempt++) {
    const { data, error } = await db.from("leagues").select(withRev ? "settings, settings_rev" : "settings").eq("id", leagueId).maybeSingle();
    if (error) return { ok: false, changed: false, settings: null, error: error.message };
    if (!data) return { ok: false, changed: false, settings: null, error: "No such league." };
    const row = data as unknown as { settings: Settings | null; settings_rev?: number };
    const current: Settings = { ...(row.settings || {}) };
    const next = mutate(structuredClone(current));
    if (!next) return { ok: true, changed: false, settings: current };
    let q = db.from("leagues").update({ ...extra, settings: next }).eq("id", leagueId);
    if (withRev) q = q.eq("settings_rev", row.settings_rev ?? 0);
    const { data: done, error: ue } = await q.select("id");
    if (ue) return { ok: false, changed: false, settings: current, error: ue.message };
    if (done?.length) return { ok: true, changed: true, settings: next };
    // someone else changed the settings in between: read again and redo the change
    await new Promise((r) => setTimeout(r, 20 + Math.random() * 60 * (attempt + 1)));
  }
  return { ok: false, changed: false, settings: null, error: "The league's settings kept changing; try again." };
}

/** Sets (or with undefined, removes) one top-level key. */
export function setKey(db: SupabaseClient, leagueId: string, key: string, value: unknown) {
  return updateSettings(db, leagueId, (s) => { if (value === undefined) delete s[key]; else s[key] = value; return s; });
}
