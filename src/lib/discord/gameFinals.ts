// Box scores and auto-closing for the weekly game channels (Nick, 2026-11-20: "post the box score of a
// completed game in the channel after a sync, and auto delete the channel 12 hours after the score is posted").
//
// After every sync (the worker calls /api/leagues/<slug>/discord/games) each game channel whose game EA now
// reports final gets one box score post, and the time is saved on that channel (finalPostedAt). A cron every
// 15 minutes (/api/cron/game-channels) deletes channels whose box score is 12+ hours old, and a week's category
// once every channel in it is closed. After an advance, every earlier week's category is deleted outright. Closed channels stay in the saved state (closedAt), so running
// /gamechannels again for that week never brings them back, and /set can still pick those games.
import { forgetLeagueData, getLeagueData } from "@/lib/league/load";
import { supabaseAdmin } from "@/lib/supabase/server";
import { updateLeagueSettings } from "@/lib/leagueSettings";
import type { Game, LeagueData, Team } from "@/lib/league/types";
import { BRAND, hexColor, tidy, type Embed } from "./api";
import { leagueBySlug } from "./links";
import { matchupImageUrl } from "./cardLink";
import { dc, isGone, sleep } from "./rest";
import { withLeagueLock } from "./lock";
import type { GameChannel, GameChannels } from "./gameChannels";
import { readGameChannels } from "./gameChannels";
import { rename } from "./forceResult";

export const CLOSE_AFTER_MS = 12 * 3_600_000;
const APP_URL = (process.env.APP_URL || "https://cfm-manager-delta.vercel.app").replace(/\/$/, "");
const BUSY = "busy (someone is running /gamechannels); will try again on the next run";

// ---------- the box score post ----------

/** The box score as a picture: scoreboard, team stat bars and leaders (the /tws image for a finished game). */
export function boxScoreEmbed(slug: string, d: LeagueData, g: Game, a: Team, h: Team): Embed {
  const winner = g.as === g.hs ? null : g.as > g.hs ? a : h;
  const tags = [g.simmed ? "sim" : "", g.forced ? `forced ${g.forced.kind}` : "", g.disconnect ? "disconnect" : ""].filter(Boolean);
  return {
    title: `Final: ${a.abbr} ${g.as}, ${h.abbr} ${g.hs}${tags.length ? ` (${tags.join(", ")})` : ""}`,
    url: `${APP_URL}/l/${slug}/games/${g.id}`,
    color: hexColor((winner || h).primary) || BRAND,
    image: { url: matchupImageUrl(APP_URL, slug, g.id, d.pulledAt) },
    footer: { text: "Full box score on the site (title link)" },
  };
}

const slugName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** "eagles-31-at-saints-17", plus "-sim", "-force-win-eagles", "-force-sim" or "-disconnect" (Nick, 2026-11-20). */
export function scoreChannelName(g: Game, a: Team, h: Team): string {
  const f = g.forced, who = f?.team === a.id ? a : f?.team === h.id ? h : undefined;
  const dw = g.disconnectWinner === a.id ? a : g.disconnectWinner === h.id ? h : undefined;
  const tag = g.disconnect ? `-disconnect${dw ? `-win-${slugName(dw.name)}` : ""}`
    : f ? `-force-${f.kind}${f.kind !== "sim" && who ? `-${slugName(who.name)}` : ""}`
      : g.simmed ? "-sim" : "";
  return `${slugName(a.name)}-${g.as}-at-${slugName(h.name)}-${g.hs}${tag}`.slice(0, 100);
}

/** Puts the final score in the channel name. Discord allows 2 renames per channel every 10 minutes, so a blocked
 *  rename stays pending (scoreName set, renamed unset) and the 15-minute cron tries again. */
async function renameToScore(gc: GameChannel): Promise<void> {
  if (!gc.scoreName || gc.renamed || gc.closedAt) return;
  const r = await rename(gc.channelId, gc.scoreName, "final score");
  if (r === "ok" || r === "same" || r === "gone") gc.renamed = true;
}

/** Posts the box score in a game channel and starts its 12-hour clock. Returns null, or why Discord refused. */
export async function postBoxScore(slug: string, d: LeagueData, g: Game, gc: GameChannel): Promise<string | null> {
  const teams = new Map(d.teams.map((t) => [t.id, t]));
  const a = teams.get(g.away), h = teams.get(g.home);
  if (!a || !h) return "teams not found";
  const closeAt = Math.floor((Date.now() + CLOSE_AFTER_MS) / 1000);
  const r = await dc("POST", `/channels/${gc.channelId}/messages`, tidy({
    content: `🏁 **Final.** This channel closes <t:${closeAt}:R> (<t:${closeAt}:f>).`,
    embeds: [boxScoreEmbed(slug, d, g, a, h)],
  }));
  if (!r.ok) return `Discord ${r.status}${r.data.message ? ` (${String(r.data.message)})` : ""}${r.data.errors ? ` ${JSON.stringify(r.data.errors).slice(0, 300)}` : ""}`;
  gc.final = true;
  gc.finalPostedAt = new Date().toISOString();
  gc.scoreName = scoreChannelName(g, a, h);
  await renameToScore(gc);
  return null;
}

// ---------- after a sync, and the 15-minute cron ----------

async function saveState(leagueId: string, state: GameChannels) {
  await updateLeagueSettings(leagueId, (s) => { s.gameChannels = state; return s; });
}

/** Deletes channels whose box score is 12+ hours old, then any week whose channels are all closed. */
async function closeDue(state: GameChannels, log: string[]): Promise<boolean> {
  let changed = false;
  for (const wk of Object.values(state.weeks)) {
    for (const gc of Object.values(wk.games)) {
      if (gc.closedAt || !gc.finalPostedAt || Date.now() - Date.parse(gc.finalPostedAt) < CLOSE_AFTER_MS) continue;
      const ch = await dc("GET", `/channels/${gc.channelId}`);
      if (ch.ok) gc.closedName = String(ch.data.name || "");
      const r = ch.ok ? await dc("DELETE", `/channels/${gc.channelId}`) : ch;
      if (!r.ok && !isGone(r)) { log.push(`couldn't delete a game channel (Discord ${r.status}); will retry`); continue; }
      gc.closedAt = new Date().toISOString();
      changed = true;
      await sleep(250);
    }
    const games = Object.values(wk.games);
    if (!wk.closedAt && games.length && games.every((gc) => gc.closedAt)) {
      const r = await dc("DELETE", `/channels/${wk.categoryId}`);
      if (r.ok || isGone(r)) { wk.closedAt = new Date().toISOString(); changed = true; log.push(`closed ${wk.name || "a week"} (every game final)`); }
    }
  }
  return changed;
}

/** Deletes a whole week: every open channel in it, then its category. Channels keep their closed records (closedAt,
 *  closedName) so /set can still pick those games and /gamechannels never rebuilds them. */
async function closeWeek(wk: GameChannels["weeks"][string]): Promise<boolean> {
  let ok = true;
  for (const gc of Object.values(wk.games)) {
    if (gc.closedAt) continue;
    const ch = await dc("GET", `/channels/${gc.channelId}`);
    if (ch.ok) gc.closedName = String(ch.data.name || "");
    const r = ch.ok ? await dc("DELETE", `/channels/${gc.channelId}`) : ch;
    if (!r.ok && !isGone(r)) { ok = false; continue; }
    gc.closedAt = new Date().toISOString();
    await sleep(250);
  }
  if (!ok) return false;
  const r = await dc("DELETE", `/channels/${wk.categoryId}`);
  if (!r.ok && !isGone(r)) return false;
  wk.closedAt = new Date().toISOString();
  return true;
}

/** Posts box scores for games that went final, then closes what's due. `withData` false = closing only (no data load). */
export async function gameChannelFinals(slug: string, withData = true): Promise<string> {
  const lg = await leagueBySlug(slug);
  if (!lg?.settings?.gameChannels) return "No game channels.";
  return withLeagueLock(lg.id, "gameChannels", BUSY, async () => {
    const fresh = await leagueBySlug(slug);
    const state = readGameChannels(fresh?.settings?.gameChannels);
    const log: string[] = [];
    let changed = false, posted = 0, already = 0, open = 0, channels = 0;
    if (withData) {
      forgetLeagueData(slug);
      const d = await getLeagueData(slug);
      if (d) {
        const byId = new Map(d.games.map((g) => [String(g.id), g]));
        for (const wk of Object.values(state.weeks)) {
          for (const [id, gc] of Object.entries(wk.games)) {
            const g = byId.get(id);
            if (gc.closedAt) continue;
            channels++;
            if (!g?.final) { open++; continue; }
            if (gc.finalPostedAt) {
              already++;
              // box score posted before channels were renamed: give it its score name too
              const a = d.teams.find((t) => t.id === g.away), h = d.teams.find((t) => t.id === g.home);
              if (!gc.scoreName && a && h) { gc.scoreName = scoreChannelName(g, a, h); changed = true; }
              continue;
            }
            const err = await postBoxScore(slug, d, g, gc);
            if (!err) { posted++; changed = true; }
            else {
              // channel deleted by hand: nothing to post in, so treat it as closed
              const c = await dc("GET", `/channels/${gc.channelId}`);
              if (isGone(c)) { gc.closedAt = new Date().toISOString(); changed = true; log.push(`game ${id}'s channel is gone`); }
              else log.push(`couldn't post game ${id}'s box score: ${err}`);
            }
            await sleep(300);
          }
        }
        state.finalsAt = new Date().toISOString();
        changed = true;
        // After an advance (Nick, 2026-11-22: "delete the previous week/s category when we advance"): every week
        // category before the league's current week goes, open channels and all.
        const now = d.season.year * 1000 + d.season.stage * 100 + d.season.week;
        for (const [key, wk] of Object.entries(state.weeks)) {
          if (wk.closedAt) continue;
          const [y, st, w] = key.split(":").map(Number);
          if ((y || 0) * 1000 + (st || 0) * 100 + (w || 0) >= now) continue;
          log.push(await closeWeek(wk) ? `deleted ${wk.name || key} (league advanced)` : `couldn't fully delete ${wk.name || key}; will retry`);
        }
      }
    }
    for (const wk of Object.values(state.weeks)) for (const gc of Object.values(wk.games)) {
      if (gc.scoreName && !gc.renamed && !gc.closedAt) { await renameToScore(gc); if (gc.renamed) changed = true; }
    }
    if (await closeDue(state, log)) changed = true;
    if (changed) await saveState(lg.id, state);
    const counts = withData ? `${channels} open channel${channels === 1 ? "" : "s"}: ${posted} box score${posted === 1 ? "" : "s"} posted, ${already} posted before, ${open} not played yet` : "";
    return [counts, ...log].filter(Boolean).join("; ") || "nothing to do";
  }).catch((e) => `failed: ${(e as Error).message}`);
}

/** The cron: every league with game channels. Box scores too when a sync landed since the last pass. */
export async function gameChannelsCron(): Promise<Record<string, string>> {
  const db = supabaseAdmin();
  const { data } = await db.from("leagues").select("slug, last_synced_at, settings").not("settings->gameChannels", "is", null);
  const out: Record<string, string> = {};
  for (const lg of data || []) {
    const st = readGameChannels((lg.settings as Record<string, unknown> | null)?.gameChannels);
    const synced = lg.last_synced_at ? Date.parse(lg.last_synced_at as string) : 0;
    const needFinals = !st.finalsAt || synced > Date.parse(st.finalsAt);
    const due = Object.values(st.weeks).some((wk) => !wk.closedAt && Object.values(wk.games).some((gc) => !gc.closedAt && gc.finalPostedAt
      && (Date.now() - Date.parse(gc.finalPostedAt) >= CLOSE_AFTER_MS || (gc.scoreName && !gc.renamed))));
    if (!needFinals && !due) continue;
    out[lg.slug as string] = await gameChannelFinals(lg.slug as string, needFinals);
  }
  return out;
}
