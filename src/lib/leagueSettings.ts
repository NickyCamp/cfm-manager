// leagues.settings changes from the site (service role). See leagueSettingsCore.ts for how and why.
import { supabaseAdmin } from "@/lib/supabase/server";
import { setKey, settingsRevAvailable, updateSettings, type Mutate } from "./leagueSettingsCore";

export type { Settings, SettingsResult } from "./leagueSettingsCore";
export const updateLeagueSettings = (leagueId: string, mutate: Mutate, extra?: Record<string, unknown>) => updateSettings(supabaseAdmin(), leagueId, mutate, extra);
export const setLeagueSetting = (leagueId: string, key: string, value: unknown) => setKey(supabaseAdmin(), leagueId, key, value);
export const leagueSettingsRev = () => settingsRevAvailable(supabaseAdmin());
