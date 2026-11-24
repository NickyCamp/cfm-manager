// Loads a league's row and its data file for the league pages.
// The data file lives in public storage (league-data/<slug>/data.json.gz) and
// is cached in memory for a minute per server instance.

import { fixLineTeams } from "./lineTeams";
import { cache } from "react";
import { gunzipSync } from "node:zlib";
import fs from "node:fs";
import { supabaseAdmin, supabaseUser } from "@/lib/supabase/server";
import type { LeagueData } from "./types";
import { findAbility } from "./abilities";
import { KNOWN_LEAGUE_CAPS } from "./cap";
import { attachRestructures, type LeagueHistory } from "./history";
import type { SeasonArchive } from "./seasons";
import { pastSeasonData, type SeasonStats } from "./seasonStats";
import { PREV_SEEDS } from "./prev-seasons";
import { applySimSeen } from "./simSeen";

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

const statsMemo = new Map<string, { at: number; data: SeasonStats | null }>();

/** One season's player stats (league-data/<slug>/stats-<year>.json.gz, seasonStats.ts), cached a minute. */
export const getSeasonStats = cache(async (slug: string, year: number): Promise<SeasonStats | null> => {
  const k = `${slug}:${year}`;
  const hit = statsMemo.get(k);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  try {
    const data = await fetchJson<SeasonStats>(slug, `stats-${year}`);
    statsMemo.set(k, { at: Date.now(), data });
    return data;
  } catch (e) {
    console.error("league season stats load failed", slug, year, e);
    return hit?.data ?? null;
  }
});

/** The years with saved scores or stats other than the current season, newest first. */
export async function pastYears(slug: string, d: LeagueData): Promise<number[]> {
  const arc = await getLeagueSeasons(slug);
  return Object.keys(arc?.seasons ?? {}).map(Number).filter((y) => y && y !== d.season.year).sort((a, b) => b - a);
}

/** A past season shaped like the current one (box scores, game logs, totals), or null if nothing was kept. */
export const getPastSeason = cache(async (slug: string, year: number): Promise<LeagueData | null> => {
  const [d, arc, stats] = await Promise.all([getLeagueData(slug), getLeagueSeasons(slug), getSeasonStats(slug, year)]);
  const season = arc?.seasons[String(year)];
  if (!d || !season || year === d.season.year) return null;
  const past = pastSeasonData(d, season, stats);
  if (stats?.partial) past.partialStats = stats.partial;
  return past;
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
      // Last season's per-game numbers for early-season props: the worker keeps them from now on; leagues
      // that rolled over before that use a recovered copy (prev-seasons/).
      if (!data.prevSeason) { const seed = PREV_SEEDS[`${slug}-${data.season.year - 1}`]; if (seed) data.prevSeason = seed; }
      // Stat lines EA re-tagged with a player's new team go back to the team he played for (lineTeams.ts).
      const lt = fixLineTeams(data, hist);
      if (lt.fixed || lt.unresolved) data.lineTeamFix = lt;
      const known = Object.fromEntries(Object.entries(KNOWN_LEAGUE_CAPS[slug] || {}).filter(([y]) => Number(y) > (data.season.capYear ?? data.season.year)));
      if (Object.keys(known).length) data.knownCaps = known;
      const { awards, forced, simSeen } = await leagueOverlays(slug, data.season.year);
      if (awards) data.awardResults = awards;
      // played vs simmed EA said live for games the data file has as unknown (simSeen.ts)
      applySimSeen(data.games, simSeen);
      // /set (Nick, 2026-11-19): a forced result counts as simmed everywhere (site, audits, bets).
      for (const g of data.games) {
        const f = forced?.[String(g.id)];
        // /set disconnect: both users get a game played (activity) and its bets are voided; EA's result is kept as is
        if (f && g.stage === 1 && f.kind === "dc") { g.disconnect = true; if (f.team != null) g.disconnectWinner = f.team; }
        // /set played (Nick, 2026-11-22): EA never said, but both users played it; bets and audits treat it as played
        else if (f && g.stage === 1 && f.kind === "played") g.simmed = false;
        else if (f && g.stage === 1) { g.forced = { kind: f.kind as "win" | "loss" | "sim", team: f.team, ...(f.activity != null ? { activity: f.activity } : {}) }; g.simmed = true; }
      }
    }
    memo.set(slug, { at: Date.now(), data });
    return data;
  } catch (e) {
    console.error("league data load failed", slug, e);
    return hit?.data ?? null;
  }
});

/** Drops the cached data file so the next load picks up a change (e.g. an award winner entered). */
export function forgetLeagueData(slug: string) {
  memo.delete(slug);
}

type Forced = Record<string, { kind: "win" | "loss" | "sim" | "dc" | "played"; team?: number; activity?: number | number[] }>;
/** From leagues.settings for this season: Madden's award winners a commissioner entered (awards[year])
 *  and the results admins forced with /set (forcedGames[year]). */
async function leagueOverlays(slug: string, year: number): Promise<{ awards: Record<string, string> | null; forced: Forced | null; simSeen?: unknown }> {
  if (process.env.LOCAL_LEAGUE_DATA || !process.env.SUPABASE_SERVICE_ROLE_KEY) return { awards: null, forced: null };
  try {
    const { data } = await supabaseAdmin().from("leagues").select("settings").eq("slug", slug).maybeSingle();
    const s = data?.settings as { awards?: Record<string, Record<string, string>>; forcedGames?: Record<string, Forced>; simSeen?: unknown } | null;
    const r = s?.awards?.[String(year)];
    const f = s?.forcedGames?.[String(year)];
    return { awards: r && Object.keys(r).length ? r : null, forced: f && Object.keys(f).length ? f : null, simSeen: s?.simSeen };
  } catch (e) {
    console.error("league overlays load failed", slug, (e as Error).message);
    return { awards: null, forced: null };
  }
}

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
