// Pack stats per league: league-data/<slug>/discord/packs.json.
import { supabaseAdmin } from "@/lib/supabase/server";
import type { PackStats } from "./packs";

const path = (slug: string) => `${slug}/discord/packs.json`;

export async function loadPackStats(slug: string): Promise<PackStats> {
  const { data } = await supabaseAdmin().storage.from("league-data").download(path(slug));
  if (!data) return { users: {} };
  try { return JSON.parse(await data.text()) as PackStats; } catch { return { users: {} }; }
}

export async function savePackStats(slug: string, stats: PackStats) {
  const { error } = await supabaseAdmin().storage.from("league-data")
    .upload(path(slug), Buffer.from(JSON.stringify(stats)), { contentType: "application/json", upsert: true, cacheControl: "0" });
  if (error) throw new Error(error.message);
}
