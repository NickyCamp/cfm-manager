// Loads a league's row and its data file for the league pages.
// The data file lives in public storage (league-data/<slug>/data.json.gz) and
// is cached in memory for a minute per server instance.

import { cache } from "react";
import { gunzipSync } from "node:zlib";
import fs from "node:fs";
import { supabaseUser } from "@/lib/supabase/server";
import type { LeagueData } from "./types";
import { findAbility } from "./abilities";
import { KNOWN_LEAGUE_CAPS } from "./cap";
import { attachRestructures, type LeagueHistory } from "./history";
import type { SeasonArchive } from "./seasons";

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

async function fetchJson<T>(slug: string, file: string): Promise<T | null> {
  // Local development: LOCAL_LEAGUE_DATA=/path/to/dir with <slug>.json (and <slug>.history.json) files.
  const local = process.env.LOCAL_LEAGUE_DATA;
  if (local) {
    const f = `${local}/${slug}${file === "data" ? "" : `.${file}`}.json`;
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
  }
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/league-data/${encodeURIComponent(slug)}/${file}.json.gz`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  // Storage may already have undone the gzip on the way out; handle both.
  const text = buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
  return JSON.parse(text) as T;
}

const seasonsMemo = new Map<string, { at: number; data: SeasonArchive | null }>();

/** Every season's scores the worker has kept (league-data/<slug>/seasons.json.gz). */
export const getLeagueSeasons = cache(async (slug: string): Promise<SeasonArchive | null> => {
  const hit = seasonsMemo.get(slug);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  try {
    const data = await fetchJson<SeasonArchive>(slug, "seasons");
    seasonsMemo.set(slug, { at: Date.now(), data });
    return data;
  } catch (e) {
    console.error("league seasons load failed", slug, e);
    return hit?.data ?? null;
  }
});

const histMemo = new Map<string, { at: number; data: LeagueHistory | null }>();

/** The league's transaction log (league-data/<slug>/history.json.gz), cached a minute like the data. */
export const getLeagueHistory = cache(async (slug: string): Promise<LeagueHistory | null> => {
  const hit = histMemo.get(slug);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  try {
    const data = await fetchJson<LeagueHistory>(slug, "history");
    histMemo.set(slug, { at: Date.now(), data });
    return data;
  } catch (e) {
    console.error("league history load failed", slug, e);
    return hit?.data ?? null;
  }
});

export const getLeagueData = cache(async (slug: string): Promise<LeagueData | null> => {
  const hit = memo.get(slug);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  try {
    const [data, hist] = await Promise.all([fetchJson<LeagueData>(slug, "data"), getLeagueHistory(slug)]);
    if (data) {
      markXFactorAbilities(data);
      attachRestructures(data, hist);
      const known = Object.fromEntries(Object.entries(KNOWN_LEAGUE_CAPS[slug] || {}).filter(([y]) => Number(y) > (data.season.capYear ?? data.season.year)));
      if (Object.keys(known).length) data.knownCaps = known;
    }
    memo.set(slug, { at: Date.now(), data });
    return data;
  } catch (e) {
    console.error("league data load failed", slug, e);
    return hit?.data ?? null;
  }
});

/** EA's rank on an X-Factor ability isn't reliable (Escape Artist came through as
 *  Bronze), so an ability counts as X-Factor when it sits in the X-Factor slot
 *  (unlock overall 0) or is an X-Factor ability by definition. */
function markXFactorAbilities(d: LeagueData) {
  for (const p of d.players) {
    for (const a of p.abilities) {
      if (a.tier === "X-Factor") continue;
      if (p.slots?.some((s) => s.ovr === 0 && s.title === a.title) || findAbility(a.title)?.kind === "X-Factor") a.tier = "X-Factor";
    }
    for (const s of p.slots || []) if (s.ovr === 0 && s.title) s.tier = "X-Factor";
  }
}
