// Loads a league's row and its data file for the league pages.
// The data file lives in public storage (league-data/<slug>/data.json.gz) and
// is cached in memory for a minute per server instance.

import { cache } from "react";
import { gunzipSync } from "node:zlib";
import fs from "node:fs";
import { supabaseUser } from "@/lib/supabase/server";
import type { LeagueData } from "./types";

export type LeagueRow = {
  id: string; slug: string; name: string; console: string;
  last_sync_status: string | null; last_synced_at: string | null;
};

export const getLeagueRow = cache(async (slug: string): Promise<LeagueRow | null> => {
  if (process.env.LOCAL_LEAGUE_DATA) {
    return { id: "local", slug, name: slug.toUpperCase(), console: "ps5", last_sync_status: "synced", last_synced_at: new Date().toISOString() };
  }
  const sb = await supabaseUser();
  const { data } = await sb
    .from("leagues")
    .select("id, slug, name, console, last_sync_status, last_synced_at")
    .eq("slug", slug)
    .maybeSingle();
  return data;
});

const memo = new Map<string, { at: number; data: LeagueData | null }>();
const TTL_MS = 60_000;

async function fetchData(slug: string): Promise<LeagueData | null> {
  // Local development: LOCAL_LEAGUE_DATA=/path/to/dir with <slug>.json files.
  const local = process.env.LOCAL_LEAGUE_DATA;
  if (local) {
    const f = `${local}/${slug}.json`;
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
  }
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/league-data/${encodeURIComponent(slug)}/data.json.gz`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  // Storage may already have undone the gzip on the way out; handle both.
  const text = buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
  return JSON.parse(text) as LeagueData;
}

export const getLeagueData = cache(async (slug: string): Promise<LeagueData | null> => {
  const hit = memo.get(slug);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  try {
    const data = await fetchData(slug);
    memo.set(slug, { at: Date.now(), data });
    return data;
  } catch (e) {
    console.error("league data load failed", slug, e);
    return hit?.data ?? null;
  }
});
