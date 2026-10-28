// CFM Manager sync worker. Runs on GitHub Actions (.github/workflows/sync-leagues.yml).
//
// For every league (or just LEAGUE=<slug>):
//   1. Decrypt and refresh the EA session that league syncs with.
//   2. Check the league hub. In auto mode, stop if nothing moved and the last
//      pull is under 20 hours old (trades and signings don't move the key).
//   3. Pull everything and upload it as one gzipped bundle:
//        league-data/<slug>/raw.json.gz   { "<file>.json": data, ... }
//        league-data/<slug>/status.json   small summary the app can read
//   4. Record the run in sync_runs and update the league row.
//
// Leagues run one at a time so we stay gentle with EA's servers.
//
// Env: NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY,
//      EA_CLIENT_SECRET, EA_TOKEN_KEY, optional LEAGUE, MODE (auto|full).

import { gzipSync } from "node:zlib";
import { createClient } from "@supabase/supabase-js";
import { blazeLogin, refreshToken, type EaToken } from "../src/lib/ea/client";
import { decryptJson, encryptJson } from "../src/lib/crypto";
import { fullPull, getHub, leagueKey } from "./pull";

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase URL and service-role key are required."); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

const MODE = process.env.MODE === "full" ? "full" : "auto";
const ONLY = (process.env.LEAGUE || "").trim();
const STALE_HOURS = 20;

type League = {
  id: string; slug: string; name: string; ea_league_id: number; console: string;
  ea_connection_id: string | null; last_sync_key: string | null; last_synced_at: string | null;
};

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
  const up = await db.storage.from("league-data").upload(`${lg.slug}/raw.json.gz`, bundle, { contentType: "application/gzip", upsert: true });
  if (up.error) { log(`- **Couldn't save the pull:** ${up.error.message}`); return finish("failed"); }
  const meta = files["meta.json"] as { seasonInfo: unknown; currentWeekTitle: string; pulledAt: string };
  await db.storage.from("league-data").upload(
    `${lg.slug}/status.json`,
    Buffer.from(JSON.stringify({ key: syncKey, label, pulledAt: meta.pulledAt, seasonInfo: meta.seasonInfo, files: Object.keys(files).length })),
    { contentType: "application/json", upsert: true },
  );
  log(`- Saved ${Object.keys(files).length} files (${(bundle.length / 1024).toFixed(0)} KB compressed).`);
  return finish("synced", syncKey);
}

(async () => {
  let q = db.from("leagues").select("id, slug, name, ea_league_id, console, ea_connection_id, last_sync_key, last_synced_at").order("created_at");
  if (ONLY) q = q.eq("slug", ONLY);
  const { data: leagues, error } = await q;
  if (error) { console.error(error.message); process.exit(1); }
  if (!leagues?.length) { console.log(ONLY ? `No league "${ONLY}".` : "No leagues yet."); return; }

  const results: string[] = [];
  for (const lg of leagues as League[]) {
    try { results.push(`${lg.slug}: ${await syncLeague(lg)}`); }
    catch (e) { results.push(`${lg.slug}: crashed (${(e as Error).message})`); console.error(e); }
  }
  console.log("\nSummary\n" + results.join("\n"));
})();
