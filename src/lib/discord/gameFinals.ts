// Box scores and auto-closing for the weekly game channels (Nick, 2026-11-20: "post the box score of a
// completed game in the channel after a sync, and auto delete the channel 12 hours after the score is posted").
//
// After every sync (the worker calls /api/leagues/<slug>/discord/games) each game channel whose game EA now
// reports final gets one box score post, and the time is saved on that channel (finalPostedAt). A cron every
// 15 minutes (/api/cron/game-channels) deletes channels whose box score is 12+ hours old, and a week's category
// once every channel in it is closed. Closed channels stay in the saved state (closedAt), so running
// /gamechannels again for that week never brings them back, and /set can still pick those games.
import { forgetLeagueData, getLeagueData } from "@/lib/league/load";
import { boxScore } from "@/lib/league/derive";
import { avg } from "@/lib/league/format";
import { supabaseAdmin } from "@/lib/supabase/server";
import { updateLeagueSettings } from "@/lib/leagueSettings";
import type { Game, LeagueData, Player, StatLine, Team, TeamGame } from "@/lib/league/types";
import { BRAND, hexColor, tidy, type Embed } from "./api";
import { leagueBySlug } from "./links";
import { dc, isGone, sleep } from "./rest";
import { withLeagueLock } from "./lock";
import type { GameChannel, GameChannels } from "./gameChannels";
import { readGameChannels } from "./gameChannels";

export const CLOSE_AFTER_MS = 12 * 3_600_000;
const APP_URL = (process.env.APP_URL || "https://cfm-manager-delta.vercel.app").replace(/\/$/, "");
const BUSY = "busy (someone is running /gamechannels); will try again on the next run";

// ---------- the box score post ----------

const n = (x?: number) => x || 0;
const short = (p: Player | undefined) => (p ? `${p.first.charAt(0)}. ${p.last}` : "Unknown");

function teamStatsBlock(a: Team, h: Team, sa: TeamGame, sh: TeamGame): string {
  const rows: [string, string, string][] = [
    ["Total yards", `${sa.yds}`, `${sh.yds}`],
    ["Passing", `${sa.passYds}`, `${sh.passYds}`],
    ["Rushing", `${sa.rushYds}`, `${sh.rushYds}`],
    ["First downs", `${sa.firstDowns}`, `${sh.firstDowns}`],
    ["3rd down", `${sa.third[0]}/${sa.third[1]}`, `${sh.third[0]}/${sh.third[1]}`],
    ["4th down", `${sa.fourth[0]}/${sa.fourth[1]}`, `${sh.fourth[0]}/${sh.fourth[1]}`],
    ["Red zone", `${sa.redZone[0]}/${sa.redZone[1]}`, `${sh.redZone[0]}/${sh.redZone[1]}`],
    ["Turnovers", `${sa.turnovers}`, `${sh.turnovers}`],
    ["Sacks", `${sa.sacks}`, `${sh.sacks}`],
    ["Penalties", `${sa.penalties}-${sa.penaltyYds}`, `${sh.penalties}-${sh.penaltyYds}`],
  ];
  const w = Math.max(...rows.map((r) => r[0].length));
  const head = `${"".padEnd(w)}  ${a.abbr.padStart(6)}  ${h.abbr.padStart(6)}`;
  return "```\n" + [head, ...rows.map(([l, x, y]) => `${l.padEnd(w)}  ${x.padStart(6)}  ${y.padStart(6)}`)].join("\n") + "\n```";
}

/** One team's leaders: top passer, 2 rushers, 3 receivers, 2 defenders, kicker. */
function teamLeaders(lines: StatLine[], players: Map<number, Player>): string {
  const top = (k: keyof StatLine, count: number) => lines.filter((l) => n(l[k] as number) > 0).sort((x, y) => n(y[k] as number) - n(x[k] as number)).slice(0, count);
  const name = (l: StatLine) => short(players.get(l.p));
  const td = (x: number, label = "TD") => (x ? `, ${x} ${label}` : "");
  const out: string[] = [];
  for (const l of top("pa", 1)) out.push(`**Pass** ${name(l)}: ${n(l.pc)}/${n(l.pa)}, ${n(l.py)} yds${td(n(l.ptd))}${td(n(l.pint), "INT")}`);
  const rush = top("ra", 2).map((l) => `${name(l)} ${n(l.ra)}-${n(l.ry)} (${avg(n(l.ry), n(l.ra))})${td(n(l.rtd))}`);
  if (rush.length) out.push(`**Rush** ${rush.join(" · ")}`);
  const rec = top("rc", 3).map((l) => `${name(l)} ${n(l.rc)}-${n(l.rcy)}${td(n(l.rctd))}`);
  if (rec.length) out.push(`**Rec** ${rec.join(" · ")}`);
  const def = lines.filter((l) => n(l.tk) + n(l.sk) + n(l.int) + n(l.ff) > 0)
    .sort((x, y) => n(y.int) * 10 + n(y.sk) * 3 + n(y.ff) * 3 + n(y.tk) - (n(x.int) * 10 + n(x.sk) * 3 + n(x.ff) * 3 + n(x.tk)))
    .slice(0, 2)
    .map((l) => [`${name(l)} ${n(l.tk)} TKL`, n(l.sk) ? `${n(l.sk)} SCK` : "", n(l.int) ? `${n(l.int)} INT` : "", n(l.ff) ? `${n(l.ff)} FF` : ""].filter(Boolean).join(", "));
  if (def.length) out.push(`**Def** ${def.join(" · ")}`);
  for (const l of top("fga", 1)) out.push(`**Kick** ${name(l)} ${n(l.fgm)}/${n(l.fga)} FG${n(l.fglng) ? ` (long ${n(l.fglng)})` : ""}`);
  return out.join("\n") || "No player stats from EA.";
}

export function boxScoreEmbed(slug: string, d: LeagueData, g: Game, a: Team, h: Team): Embed {
  const players = new Map(d.players.map((p) => [p.id, p]));
  const { lines, teamStats } = boxScore(d, g.id);
  const sa = teamStats.find((s) => s.t === a.id), sh = teamStats.find((s) => s.t === h.id);
  const winner = g.as === g.hs ? null : g.as > g.hs ? a : h;
  const tags = [g.simmed ? "sim" : "", g.forced ? `forced ${g.forced.kind}` : "", g.disconnect ? "disconnect" : ""].filter(Boolean);
  const fields: NonNullable<Embed["fields"]> = [];
  if (lines.length) {
    fields.push({ name: `${a.city} ${a.name}`, value: teamLeaders(lines.filter((l) => l.t === a.id), players) });
    fields.push({ name: `${h.city} ${h.name}`, value: teamLeaders(lines.filter((l) => l.t === h.id), players) });
  }
  return {
    title: `Final: ${a.abbr} ${g.as}, ${h.abbr} ${g.hs}${tags.length ? ` (${tags.join(", ")})` : ""}`,
    url: `${APP_URL}/l/${slug}/games/${g.id}`,
    color: hexColor((winner || h).primary) || BRAND,
    description: [
      `**${a.city} ${a.name}** ${g.as} @ **${h.city} ${h.name}** ${g.hs}`,
      sa && sh ? teamStatsBlock(a, h, sa, sh) : "EA sent no team stats for this game.",
    ].join("\n"),
    fields,
    footer: { text: "Full box score on the site (title link)" },
  };
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
            if (gc.finalPostedAt) { already++; continue; }
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
      }
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
    const due = Object.values(st.weeks).some((wk) => !wk.closedAt && Object.values(wk.games).some((gc) => !gc.closedAt && gc.finalPostedAt && Date.now() - Date.parse(gc.finalPostedAt) >= CLOSE_AFTER_MS));
    if (!needFinals && !due) continue;
    out[lg.slug as string] = await gameChannelFinals(lg.slug as string, needFinals);
  }
  return out;
}
