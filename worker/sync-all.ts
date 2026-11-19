// CFM Manager sync worker. Runs on GitHub Actions (.github/workflows/sync-leagues.yml).
//
// For every league (or just LEAGUE=<slug>):
//   1. Decrypt and refresh the EA session that league syncs with.
//   2. Check the league hub. In auto mode, stop if nothing moved and the last
//      pull is under 20 hours old (trades and signings don't move the key).
//   3. Pull everything and upload it as one gzipped bundle:
//        league-raw/<slug>/raw.json.gz    { "<file>.json": data, ... }   (PRIVATE bucket: the raw pull
//        league-raw/<slug>/status.json    carries members' EA account details; only this worker reads it)
//   4. Build the data file the league pages read, carrying over past stat lines:
//        league-data/<slug>/data.json.gz
//   5. Record the run in sync_runs and update the league row.
//
// MODE=rebuild skips EA entirely and rebuilds data.json.gz from the saved raw
// pull (after a change to the data format).
//
// Leagues run one at a time so we stay gentle with EA's servers.
//
// Env: NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY,
//      EA_CLIENT_SECRET, EA_TOKEN_KEY, optional LEAGUE, MODE (auto|full).

import { gunzipSync, gzipSync } from "node:zlib";
import { createClient } from "@supabase/supabase-js";
import { blazeLogin, refreshToken, type EaToken } from "../src/lib/ea/client";
import { decryptJson, encryptJson } from "../src/lib/crypto";
import { signWorkerCall } from "../src/lib/workerSig";
import { updateSettings } from "../src/lib/leagueSettingsCore";
import { fullPull, getHub, leagueKey } from "./pull";
import { buildLeagueData, mergeHistory } from "../src/lib/league/build";
import { healRenumberedLog, remapLeagueTeams, teamIdMap } from "../src/lib/league/teamIds";
import { appendEvents, diffLeague, seedHistory, type LeagueHistory, type TradePicks } from "../src/lib/league/history";
import { archiveSeason, type SeasonArchive } from "../src/lib/league/seasons";
import fs from "node:fs";
import { resolvePortraits } from "../src/lib/league/portraits";
import type { LeagueData } from "../src/lib/league/types";
import { leagueChanges } from "../src/lib/discord/changes";
import { tradeTransactionPosts } from "../src/lib/discord/tradeTransactions";
import type { TradeChannels } from "../src/lib/discord/tradeChannels";
import { TX_CHANNELS, backlogPosts, transactionPosts, type TxChannelsState, type TxKey } from "../src/lib/discord/txPosts";
import { maddenBlockChanges, type TradeBlockState } from "../src/lib/league/tradeBlock";
import { maddenBlockPosts } from "../src/lib/discord/tradeBlock";
import { postToChannel, type AlertEvent, type AlertVideo } from "../src/lib/discord/api";

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase URL and service-role key are required."); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

const MODE = process.env.MODE === "full" ? "full" : process.env.MODE === "rebuild" ? "rebuild" : "auto";
const ONLY = (process.env.LEAGUE || "").trim();
const STALE_HOURS = 20;

type League = {
  id: string; slug: string; name: string; ea_league_id: number; console: string;
  ea_connection_id: string | null; last_sync_key: string | null; last_synced_at: string | null;
  settings: { discord?: { guildId?: string; channelId?: string | null; videos?: Partial<Record<AlertEvent, AlertVideo>> }; marketChannels?: unknown; gameChannels?: unknown; activity?: unknown; tradeChannels?: TradeChannels; tradeBlock?: TradeBlockState; txChannels?: TxChannelsState; tradePicks?: TradePicks } | null;
};

const APP_URL = (process.env.APP_URL || "https://cfm-manager-delta.vercel.app").replace(/\/$/, "");

/** Posts what changed to the league's Discord update channel (/notify), if it has one. Never fails the sync. */
async function postDiscordUpdates(lg: League, prev: LeagueData | null, data: LeagueData, log: (s: string) => void) {
  const channel = lg.settings?.discord?.channelId;
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!channel || !token) return;
  try {
    const msgs = leagueChanges(prev, data, lg.name, APP_URL, lg.slug);
    const videos = lg.settings?.discord?.videos || {};
    const files = new Map<string, Buffer | null>();
    for (const m of msgs) {
      // A server's /alertvideo clip goes along with that kind of post.
      const v = m.event ? videos[m.event] : undefined;
      let file;
      if (v) {
        if (!files.has(v.path)) files.set(v.path, await download(v.path));
        const data = files.get(v.path);
        if (data) file = { data, filename: v.filename, contentType: v.contentType };
        else log(`- Discord: the ${m.event} video is missing from storage; posted without it.`);
      }
      const err = await postToChannel(token, channel, m, file);
      if (err) { log(`- Discord: ${err}`); return; }
    }
    if (msgs.length) log(`- Posted ${msgs.length} update${msgs.length === 1 ? "" : "s"} to Discord.`);
  } catch (e) {
    log(`- Discord post failed: ${(e as Error).message}`);
  }
}

/** #trade-transactions: each trade seen in this sync, linked to the approved proposal it matches. Never fails the sync. */
async function postTradeTransactions(lg: League, prev: LeagueData | null, data: LeagueData, log: (s: string) => void) {
  const st = lg.settings?.tradeChannels;
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!st?.transactionsId || !token) return;
  try {
    const msgs = tradeTransactionPosts(prev, data, st, lg.settings?.discord?.guildId, APP_URL, lg.slug);
    for (const m of msgs) {
      const err = await postToChannel(token, st.transactionsId, m);
      if (err) { log(`- Discord #trade-transactions: ${err}`); return; }
    }
    if (msgs.length) log(`- Posted ${msgs.length} trade${msgs.length === 1 ? "" : "s"} to #trade-transactions.`);
  } catch (e) {
    log(`- Discord #trade-transactions failed: ${(e as Error).message}`);
  }
}

/** #trade-block: players Madden newly lists on (or drops from) its trade block this sync. Never fails the sync. */
async function postTradeBlock(lg: League, prev: LeagueData | null, data: LeagueData, log: (s: string) => void) {
  const st = lg.settings?.tradeChannels;
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!data.blockKey) { if (st?.blockId) log("- Trade block: EA's roster data has no trade block field, so only players added by hand show."); return; }
  if (!st?.blockId || !token || prev?.pulledAt === data.pulledAt) return;
  try {
    const { on, off } = maddenBlockChanges(prev, data, lg.settings?.tradeBlock);
    const msgs = maddenBlockPosts(data, lg.slug, on, off);
    for (const m of msgs) {
      const err = await postToChannel(token, st.blockId, m);
      if (err) { log(`- Discord #trade-block: ${err}`); return; }
    }
    if (msgs.length) log(`- #trade-block: ${on.length} on, ${off.length} off Madden's block (field ${data.blockKey}).`);
  } catch (e) {
    log(`- Discord #trade-block failed: ${(e as Error).message}`);
  }
}

/** Transactions category (/transactionchannels): what this sync newly recorded, one bot-only channel per kind. Never fails the sync. */
async function postTransactionChannels(lg: League, prev: LeagueData | null, data: LeagueData, log: (s: string) => void) {
  const st = lg.settings?.txChannels;
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!st?.channels || !token) return;
  try {
    const opts = { appUrl: APP_URL, slug: lg.slug, leagueName: lg.name, trade: lg.settings?.tradeChannels || null, guildId: lg.settings?.discord?.guildId, tradePicks: lg.settings?.tradePicks };
    const byKey = transactionPosts(prev, data, opts);
    // New channels (or "Repost history"): everything the site already saved goes first, oldest first.
    let backlog: ReturnType<typeof backlogPosts> = {};
    const only = st.historyPostedAt ? st.historyFor || [] : null; // null: the whole history, every channel
    if (!st.historyPostedAt || only?.length) {
      const buf = await download(`${lg.slug}/history.json.gz`);
      let hist: LeagueHistory | null = null;
      try { hist = buf ? JSON.parse(gunzipSync(buf).toString("utf8")) : null; } catch { hist = null; }
      backlog = backlogPosts(hist, prev, data, opts);
      if (only) backlog = Object.fromEntries(Object.entries(backlog).filter(([k]) => only.includes(k as TxKey)));
    }
    const done: string[] = [];
    for (const c of TX_CHANNELS) {
      const msgs = [...(backlog[c.key] || []), ...(byKey[c.key] || [])], channel = st.channels[c.key];
      if (!msgs?.length || !channel) continue;
      let err: string | null = null;
      for (const m of msgs) if ((err = await postToChannel(token, channel, m))) break;
      if (err) log(`- Discord #${c.name}: ${err}`);
      else done.push(`#${c.name} ${msgs.length}`);
    }
    if (done.length) log(`- Transactions channels: ${done.join(", ")}.`);
    if (!st.historyPostedAt) {
      // Marked even if a channel failed, so a later sync never posts the whole history twice
      // (an admin can run /transactionchannels action: Repost history after fixing permissions).
      await updateSettings(db, lg.id, (s) => { const t = s.txChannels as TxChannelsState | undefined; if (!t) return null; t.historyPostedAt = new Date().toISOString(); return s; });
      log(`- Transactions channels: saved history posted (${Object.values(backlog).reduce((n, m) => n + (m?.length || 0), 0)} messages).`);
    } else if (only?.length) {
      await updateSettings(db, lg.id, (s) => { const t = s.txChannels as TxChannelsState | undefined; if (!t) return null; delete t.historyFor; return s; });
      log(`- Transactions channels: saved history posted in ${only.join(", ")} (${Object.values(backlog).reduce((n, m) => n + (m?.length || 0), 0)} messages).`);
    }
  } catch (e) {
    log(`- Discord Transactions channels failed: ${(e as Error).message}`);
  }
}

/** Asks the site to roll/refresh the league's Discord Markets channels (only if they've been set up). */
async function refreshMarketChannels(lg: League, log: (s: string) => void) {
  if (!lg.settings?.marketChannels || !process.env.EA_TOKEN_KEY) return;
  try {
    const { ts, sig } = signWorkerCall(lg.slug);
    const res = await fetch(`${APP_URL}/api/leagues/${lg.slug}/markets/discord`, { method: "POST", headers: { "x-cfm-ts": ts, "x-cfm-sig": sig } });
    const j = (await res.json().catch(() => ({}))) as { result?: string; error?: string };
    log(`- Discord Markets: ${j.result || j.error || `HTTP ${res.status}`}`);
  } catch (e) {
    log(`- Discord Markets refresh failed: ${(e as Error).message}`);
  }
}

/** Asks the site to update #activity-tracker-week (only if /activitychannels was run). */
async function refreshActivity(lg: League, log: (s: string) => void) {
  if (!lg.settings?.activity || !process.env.EA_TOKEN_KEY) return;
  try {
    const { ts, sig } = signWorkerCall(lg.slug);
    const res = await fetch(`${APP_URL}/api/leagues/${lg.slug}/discord/activity`, { method: "POST", headers: { "x-cfm-ts": ts, "x-cfm-sig": sig } });
    const j = (await res.json().catch(() => ({}))) as { result?: string; error?: string };
    log(`- Discord activity: ${j.result || j.error || `HTTP ${res.status}`}`);
  } catch (e) {
    log(`- Discord activity refresh failed: ${(e as Error).message}`);
  }
}

async function syncLeague(lg: League): Promise<string> {
  const report: string[] = [];
  const log = (s: string) => { console.log(`[${lg.slug}] ${s}`); report.push(s); };
  const { data: run } = await db.from("sync_runs").insert({ league_id: lg.id }).select("id").single();

  const finish = async (result: "synced" | "unchanged" | "failed", syncKey?: string) => {
    const now = new Date().toISOString();
    await db.from("sync_runs").update({ finished_at: now, result, sync_key: syncKey, report: report.join("\n") }).eq("id", run?.id);
    const patch: Record<string, unknown> = { last_sync_status: result === "unchanged" ? "synced" : result };
    if (result === "synced") { patch.last_sync_key = syncKey; patch.last_synced_at = now; }
    await db.from("leagues").update(patch).eq("id", lg.id);
    return result;
  };

  log(`# ${lg.name} — ${new Date().toISOString()} (mode: ${MODE})`);
  if (!lg.ea_connection_id) { log("- **No EA account is linked to this league.** Someone in the league needs to connect EA again."); return finish("failed"); }

  const { data: conn } = await db.from("ea_connections").select("id, token_ciphertext, persona_name").eq("id", lg.ea_connection_id).single();
  if (!conn) { log("- **The EA account for this league was removed.** Connect EA again."); return finish("failed"); }

  let tok: EaToken;
  try {
    tok = await refreshToken(decryptJson<EaToken>(conn.token_ciphertext));
    await db.from("ea_connections").update({ token_ciphertext: encryptJson(tok), status: "ok", updated_at: new Date().toISOString() }).eq("id", conn.id);
  } catch (e) {
    await db.from("ea_connections").update({ status: "expired" }).eq("id", conn.id);
    log(`- **EA sign-in expired for ${conn.persona_name}.** Connect EA again to keep this league syncing. (${(e as Error).message})`);
    return finish("failed");
  }

  let s, hub;
  try {
    s = await blazeLogin(tok);
    hub = await getHub(tok, s, lg.ea_league_id);
  } catch (e) {
    log(`- **Couldn't reach the league:** ${(e as Error).message}`);
    return finish("failed");
  }

  const { key: syncKey, label } = leagueKey(hub);
  log(`- League: ${label}.`);
  const staleHours = lg.last_synced_at ? (Date.now() - Date.parse(lg.last_synced_at)) / 3.6e6 : Infinity;
  if (MODE === "auto" && lg.last_sync_key === syncKey && staleHours < STALE_HOURS) {
    log("- No change since the last sync.");
    return finish("unchanged", syncKey);
  }

  const { files, fails, token } = await fullPull(tok, s, lg.ea_league_id, hub, log);
  await db.from("ea_connections").update({ token_ciphertext: encryptJson(token), updated_at: new Date().toISOString() }).eq("id", conn.id);
  if (fails.length) {
    log(`- **Some pieces failed after retries, so this pull wasn't saved:** ${fails.slice(0, 12).join("; ")}${fails.length > 12 ? ` (+${fails.length - 12} more)` : ""}`);
    return finish("failed");
  }

  const bundle = gzipSync(Buffer.from(JSON.stringify(files)));
  await ensureRawBucket();
  const up = await db.storage.from(RAW_BUCKET).upload(`${lg.slug}/raw.json.gz`, bundle, { contentType: "application/gzip", upsert: true });
  if (up.error) { log(`- **Couldn't save the pull:** ${up.error.message}`); return finish("failed"); }
  await dropPublicRaw(lg.slug, log);
  const meta = files["meta.json"] as { seasonInfo: unknown; currentWeekTitle: string; pulledAt: string };
  await db.storage.from(RAW_BUCKET).upload(
    `${lg.slug}/status.json`,
    Buffer.from(JSON.stringify({ key: syncKey, label, pulledAt: meta.pulledAt, seasonInfo: meta.seasonInfo, files: Object.keys(files).length })),
    { contentType: "application/json", upsert: true },
  );
  log(`- Saved ${Object.keys(files).length} files (${(bundle.length / 1024).toFixed(0)} KB compressed).`);
  const built = await buildAndSave(lg.slug, files, log);
  if (built) await postDiscordUpdates(lg, built.prev, built.data, log);
  if (built) await postTradeTransactions(lg, built.prev, built.data, log);
  if (built) await postTradeBlock(lg, built.prev, built.data, log);
  if (built) await postTransactionChannels(lg, built.prev, built.data, log);
  if (built) await refreshMarketChannels(lg, log);
  if (built) await refreshActivity(lg, log);
  return finish(built ? "synced" : "failed", built ? syncKey : undefined);
}

async function download(path: string, bucket = "league-data"): Promise<Buffer | null> {
  const { data, error } = await db.storage.from(bucket).download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

// ---------- the raw EA pull lives in a private bucket (Fable review, 2026-11-16) ----------
// It used to sit next to the public data file (league-data/<slug>/raw.json.gz), where anyone who knew
// a league's web address could download it, including the league hub's member list with EA account
// details. Only this worker needs it (MODE=rebuild), so it's kept in league-raw, which has no public
// access. The bucket is made by supabase/migrations/0009_private_raw_pulls.sql; the worker also makes
// it if it's missing, so the order of deploying and running the migration doesn't matter.
const RAW_BUCKET = "league-raw";
let rawBucketReady = false;
async function ensureRawBucket() {
  if (rawBucketReady) return;
  const { data } = await db.storage.getBucket(RAW_BUCKET);
  if (data) {
    if (data.public) await db.storage.updateBucket(RAW_BUCKET, { public: false });
  } else {
    const { error } = await db.storage.createBucket(RAW_BUCKET, { public: false });
    if (error && !/already exists/i.test(error.message)) throw new Error(`Couldn't create the private ${RAW_BUCKET} bucket: ${error.message}`);
  }
  rawBucketReady = true;
}
/** Removes the old public copies of a league's raw pull. */
async function dropPublicRaw(slug: string, log: (s: string) => void) {
  const { data, error } = await db.storage.from("league-data").remove([`${slug}/raw.json.gz`, `${slug}/status.json`]);
  if (error) log(`- Couldn't remove the old public copy of the raw pull: ${error.message}`);
  else if (data?.length) log(`- Removed the old public copy of the raw pull (${data.length} file${data.length === 1 ? "" : "s"}); it's kept privately now.`);
}
/** A league synced before the move: copy its raw pull to the private bucket, then delete the public one.
 *  Runs for every league on every worker run until there's nothing public left. Never fails the run. */
async function moveRawToPrivate(slug: string, log: (s: string) => void) {
  try {
    const old = await download(`${slug}/raw.json.gz`);
    const oldStatus = old ? null : await download(`${slug}/status.json`);
    if (!old && !oldStatus) return;
    await ensureRawBucket();
    if (old && !(await download(`${slug}/raw.json.gz`, RAW_BUCKET))) {
      const up = await db.storage.from(RAW_BUCKET).upload(`${slug}/raw.json.gz`, old, { contentType: "application/gzip", upsert: false });
      if (up.error && !/already exists|duplicate/i.test(up.error.message)) { log(`- Couldn't move the raw pull to private storage (left where it was): ${up.error.message}`); return; }
    }
    await dropPublicRaw(slug, log);
  } catch (e) {
    log(`- Moving the raw pull to private storage failed: ${(e as Error).message}`);
  }
}

async function buildAndSave(slug: string, files: Record<string, unknown>, log: (s: string) => void): Promise<{ prev: LeagueData | null; data: LeagueData } | null> {
  try {
    const prevBuf = await download(`${slug}/data.json.gz`);
    let prev: LeagueData | null = null;
    try { prev = prevBuf ? JSON.parse(gunzipSync(prevBuf).toString("utf8")) : null; } catch { prev = null; }
    const fresh = buildLeagueData(files);
    // EA can renumber every team id (NCL, 2027 offseason). Move the last sync onto the new ids first, or every
    // player looks traded and old games/posts can't find their teams.
    const renum = teamIdMap(prev, fresh);
    if (prev && renum.size) { prev = remapLeagueTeams(prev, renum); log(`- EA renumbered ${renum.size} team ids; the last sync's data was moved onto the new ids.`); }
    const data = mergeHistory(prev, fresh);
    await resolvePortraits(prev, data, log);
    const gz = gzipSync(Buffer.from(JSON.stringify(data)));
    keepCopy(`${slug}.json.gz`, gz);
    const up = await db.storage.from("league-data").upload(`${slug}/data.json.gz`, gz, { contentType: "application/gzip", upsert: true, cacheControl: "60" });
    if (up.error) { log(`- **Couldn't save the league data:** ${up.error.message}`); return null; }
    log(`- Built league data: ${data.teams.length} teams, ${data.players.length} players, ${data.games.length} games, ${data.lines.length} stat lines (${(gz.length / 1024).toFixed(0)} KB).${data.season.capYear ? ` Contracts are on ${data.season.capYear}.` : ""}`);
    {
      const rk = data.players.filter((p) => !p.gone && p.yearsPro === 0);
      const cls = [...new Set(rk.map((p) => `${p.draft.year} (EA ${p.draft.ea ?? "?"})`))].slice(0, 4).join(", ");
      log(`- Draft classes: season ${JSON.stringify(data.season.year)}, ${rk.length} at 0 years pro → ${cls || "none"}.`);
    }
    await updateHistory(slug, prev, data, log);
    await updateSeasons(slug, data, log);
    return { prev, data };
  } catch (e) {
    log(`- **Couldn't build the league data:** ${(e as Error).message}`);
    return null;
  }
}

/** Copies of what was published, for the run's artifact (checking builds without storage access). */
function keepCopy(name: string, buf: Buffer) {
  try { fs.mkdirSync("out", { recursive: true }); fs.writeFileSync(`out/${name}`, buf); } catch { /* best effort */ }
}

/** Keeps every season's scores in league-data/<slug>/seasons.json.gz (EA only returns this season's). */
async function updateSeasons(slug: string, data: LeagueData, log: (s: string) => void) {
  try {
    const buf = await download(`${slug}/seasons.json.gz`);
    let arc: SeasonArchive | null = null;
    try { arc = buf ? JSON.parse(gunzipSync(buf).toString("utf8")) : null; } catch { arc = null; }
    arc = archiveSeason(arc, data);
    const gz = gzipSync(Buffer.from(JSON.stringify(arc)));
    const up = await db.storage.from("league-data").upload(`${slug}/seasons.json.gz`, gz, { contentType: "application/gzip", upsert: true, cacheControl: "60" });
    if (up.error) log(`- Couldn't save past seasons: ${up.error.message}`);
  } catch (e) {
    log(`- Past seasons update failed: ${(e as Error).message}`);
  }
}

/** Appends this sync's moves to league-data/<slug>/history.json.gz (the Transactions tab). Never fails the sync. */
async function updateHistory(slug: string, prev: LeagueData | null, data: LeagueData, log: (s: string) => void) {
  try {
    const buf = await download(`${slug}/history.json.gz`);
    let hist: LeagueHistory | null = null;
    try { hist = buf ? JSON.parse(gunzipSync(buf).toString("utf8")) : null; } catch { hist = null; }
    if (!hist) {
      // A league with an imported log (NCL: the old NCL site's) starts from it.
      const seedFile = `scripts/history/seed-${slug}.json`;
      if (fs.existsSync(seedFile)) {
        hist = seedHistory(JSON.parse(fs.readFileSync(seedFile, "utf8")), data);
        log(`- Transaction log started from ${seedFile}: ${hist.events.length} moves, ${hist.events.filter((e) => !e.p && e.kind !== "trade").length} players not matched.`);
      } else hist = { version: 1, trackedSince: new Date().toISOString(), events: [] };
    }
    const healed = healRenumberedLog(hist, data);
    if (healed.dropped) { hist = healed.hist; log(`- Transaction log: dropped ${healed.dropped} fake trades from a team-id renumbering and moved ${healed.fixed} older moves onto the new team ids.`); }
    const events = diffLeague(prev, data, data.pulledAt || new Date().toISOString());
    hist = appendEvents(hist, events);
    if (events.length) {
      const n: Record<string, number> = {};
      for (const e of events) n[e.kind] = (n[e.kind] || 0) + 1;
      log(`- Transactions: ${Object.entries(n).map(([k, v]) => `${v} ${k}`).join(", ")}.`);
    }
    const gz = gzipSync(Buffer.from(JSON.stringify(hist)));
    keepCopy(`${slug}.history.json.gz`, gz);
    const up = await db.storage.from("league-data").upload(`${slug}/history.json.gz`, gz, { contentType: "application/gzip", upsert: true, cacheControl: "60" });
    if (up.error) log(`- Couldn't save the transaction log: ${up.error.message}`);
  } catch (e) {
    log(`- Transaction log update failed: ${(e as Error).message}`);
  }
}

async function rebuildLeague(lg: League): Promise<string> {
  const log = (s: string) => console.log(`[${lg.slug}] ${s}`);
  const raw = await download(`${lg.slug}/raw.json.gz`, RAW_BUCKET);
  if (!raw) { log("- No saved pull yet."); return "skipped"; }
  const ok = await buildAndSave(lg.slug, JSON.parse(gunzipSync(raw).toString("utf8")), log);
  return ok ? "rebuilt" : "failed";
}

// ---------- leagues everyone removed (Nick, 2026-11-14) ----------
// "Remove" on the dashboard by the last member sets settings.orphanedAt. Orphaned leagues don't sync;
// after 30 days with nobody adding it back, the league and all its files are deleted.
const ORPHAN_DAYS = 30;

/** Every file path under a folder in a bucket, one level of subfolders deep. */
async function filesUnder(bucket: string, prefix: string): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await db.storage.from(bucket).list(prefix, { limit: 100, offset });
    if (error || !data) break;
    for (const f of data) {
      if (f.id) out.push(`${prefix}/${f.name}`);
      else out.push(...(await filesUnder(bucket, `${prefix}/${f.name}`)));
    }
    if (data.length < 100) break;
  }
  return out;
}

/** "skip" (still inside the 30 days), "deleted", "back" (someone rejoined) or null (not orphaned). */
async function handleOrphan(lg: League): Promise<string | null> {
  const at = (lg.settings as { orphanedAt?: string } | null)?.orphanedAt;
  if (!at) return null;
  const { count } = await db.from("league_members").select("user_id", { count: "exact", head: true }).eq("league_id", lg.id);
  if (count) {
    // Someone is a member again: the clock stops.
    const r = await updateSettings(db, lg.id, (s) => { if (!s.orphanedAt) return null; delete s.orphanedAt; return s; });
    if (r.settings) lg.settings = r.settings as League["settings"];
    return null;
  }
  const due = new Date(new Date(at).getTime() + ORPHAN_DAYS * 86_400_000);
  if (Date.now() < due.getTime()) return `no members since ${at.slice(0, 10)}, not syncing; deleted on ${due.toISOString().slice(0, 10)} unless someone adds it back`;
  const files = [
    ...(await filesUnder("league-data", lg.slug)).map((p) => ["league-data", p] as const),
    ...(await filesUnder("card-art", lg.slug)).map((p) => ["card-art", p] as const),
    ...(await filesUnder(RAW_BUCKET, lg.slug)).map((p) => [RAW_BUCKET, p] as const),
    ["player-nicknames", `${lg.slug}.json`] as const,
    ["card-layouts", `${lg.slug}.json`] as const,
  ];
  const { error } = await db.from("leagues").delete().eq("id", lg.id); // members, sync runs, markets cascade
  if (error) return `orphan delete failed: ${error.message}`;
  for (const bucket of ["league-data", "card-art", RAW_BUCKET, "player-nicknames", "card-layouts"]) {
    const paths = files.filter(([b]) => b === bucket).map(([, p]) => p);
    for (let i = 0; i < paths.length; i += 100) await db.storage.from(bucket).remove(paths.slice(i, i + 100));
  }
  return `deleted (no members for ${ORPHAN_DAYS} days; ${files.length} files)`;
}

(async () => {
  let q = db.from("leagues").select("id, slug, name, ea_league_id, console, ea_connection_id, last_sync_key, last_synced_at, settings").order("created_at");
  if (ONLY) q = q.eq("slug", ONLY);
  const { data: leagues, error } = await q;
  if (error) { console.error(error.message); process.exit(1); }
  if (!leagues?.length) { console.log(ONLY ? `No league "${ONLY}".` : "No leagues yet."); return; }

  const results: string[] = [];
  for (const lg of leagues as League[]) {
    try {
      const orphan = await handleOrphan(lg);
      await moveRawToPrivate(lg.slug, (s) => console.log(`[${lg.slug}] ${s}`)); // also for orphaned leagues: nothing raw stays public
      if (orphan) { console.log(`[${lg.slug}] ${orphan}`); results.push(`${lg.slug}: ${orphan}`); continue; }
      results.push(`${lg.slug}: ${MODE === "rebuild" ? await rebuildLeague(lg) : await syncLeague(lg)}`);
    }
    catch (e) { results.push(`${lg.slug}: crashed (${(e as Error).message})`); console.error(e); }
  }
  console.log("\nSummary\n" + results.join("\n"));
})();
