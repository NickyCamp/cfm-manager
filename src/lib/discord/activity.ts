// User activity tracking (Nick, 2026-11-19): /activitychannels makes a bot-only "Activity" category
// with #activity-tracker-week.
//  - Every sync: each newly played user game posts there, and both users get a game played.
//  - After an advance, the week that ended gets a wrap-up: first the games an admin forced with
//    /set (the result, and the team picked with `activity`, whose user gets a game played, not a
//    miss; the other user gets a miss), then the games nobody played, which count as a sim with a
//    miss for both users.
//  - EA only says whether a game was played or simmed while its week is current, so a game finished
//    after the last sync but before the advance comes through "unknown". Those aren't counted;
//    the wrap-up flags them for an admin to settle with /set force … activity.
//  - A message at the top of the channel keeps each user's season totals (played / missed).
// Only user-run teams count; CPU teams have no one to track.
//
// State: leagues.settings.activity (see ActivityState). Runs after every sync (the worker calls
// POST /api/leagues/<slug>/discord/activity), from /activitychannels, and after /set.
import { getLeagueData, forgetLeagueData } from "@/lib/league/load";
import { weekTitle } from "@/lib/league/derive";
import type { Game, LeagueData, Team } from "@/lib/league/types";
import { updateLeagueSettings } from "@/lib/leagueSettings";
import { BRAND, type Embed } from "./api";
import { discordOf, leagueBySlug, type LinkedLeague } from "./links";
import { withLeagueLock } from "./lock";
import { dc, isGone, sleep } from "./rest";
import { botOnly, makeChannel } from "./tradeChannels";

type Status = "P" | "M"; // played, missed
/** How a game counted: played, forced by an admin, missed (not played), or unknown (EA didn't say). */
type How = "played" | "forced" | "missed" | "unknown";
type Rec = { wk: string; how: How; by: Record<string, { u: string; s: Status }> };
export type ActivityState = {
  categoryId: string;
  channelId: string;
  totalsMessageId?: string | null;
  season: number;
  /** First week tracked ("stage:week"); earlier weeks of the season aren't counted. */
  start: string;
  games: Record<string, Rec>;
  /** Weeks whose wrap-up has been posted ("stage:week"). */
  wrapped: string[];
  /** Earlier seasons' totals: year → user → [played, missed]. */
  history?: Record<string, Record<string, [number, number]>>;
};

const CHANNEL = "activity-tracker-week";
const TOPIC = "User activity: games played and missed each week. Posted by the bot after every sync and advance.";
const wkOf = (stage: number, week: number) => `${stage}:${week}`;
const rankOf = (wk: string) => { const [s, w] = wk.split(":").map(Number); return (s || 0) * 100 + (w || 0); };
const BUSY = "Activity tracking is already updating (a sync or another command). Try again in a minute.";

export const readActivity = (lg: LinkedLeague) => (lg.settings?.activity as ActivityState | undefined) || null;

async function save(lg: LinkedLeague, st: ActivityState | null) {
  await updateLeagueSettings(lg.id, (s) => { if (st) s.activity = st; else delete s.activity; return s; });
}

/** Team ids an admin credited with activity on a forced game (a number from before "Both teams", or a list). */
export function activityTeams(f: { activity?: number | number[] } | undefined): number[] {
  if (!f || f.activity == null) return [];
  return Array.isArray(f.activity) ? f.activity : [f.activity];
}

const label = (t: Team | undefined) => (t ? `${t.abbr} (${t.user || "CPU"})` : "?");
const userTeams = (d: LeagueData, g: Game) => [g.away, g.home].map((id) => d.teams.find((t) => t.id === id)).filter((t): t is Team => Boolean(t?.user));
const playedNow = (g: Game) => g.final && g.simmed === false && !g.forced;

/** How a game counts once its week is over (or now, for a game already played). */
function judge(d: LeagueData, g: Game): Rec {
  const wk = wkOf(g.stage, g.week);
  const users = userTeams(d, g);
  if (g.forced) {
    const act = new Set(activityTeams(g.forced));
    return { wk, how: "forced", by: Object.fromEntries(users.map((t) => [String(t.id), { u: t.user, s: act.has(t.id) ? "P" : "M" }])) };
  }
  if (playedNow(g)) return { wk, how: "played", by: Object.fromEntries(users.map((t) => [String(t.id), { u: t.user, s: "P" as Status }])) };
  if (g.final && g.simmed == null) return { wk, how: "unknown", by: {} };
  return { wk, how: "missed", by: Object.fromEntries(users.map((t) => [String(t.id), { u: t.user, s: "M" as Status }])) };
}

function forceText(d: LeagueData, g: Game): string {
  const f = g.forced!;
  const t = d.teams.find((x) => x.id === f.team);
  return f.kind === "sim" ? "Force Sim" : `Force ${f.kind === "win" ? "Win" : "Loss"}: ${t?.abbr ?? "?"}`;
}

/** One line for a game's activity. */
function line(d: LeagueData, g: Game, r: Rec): string {
  const a = d.teams.find((t) => t.id === g.away), h = d.teams.find((t) => t.id === g.home);
  const who = (t: Team | undefined) => {
    const x = t ? r.by[String(t.id)] : undefined;
    return x ? `${x.s === "P" ? "✅" : "❌"} ${t!.user} (${t!.abbr}) ${x.s === "P" ? "played" : "missed"}` : null;
  };
  const people = [who(a), who(h)].filter(Boolean).join(" · ");
  const match = `${a?.abbr ?? "?"} @ ${h?.abbr ?? "?"}`;
  if (r.how === "played") return `✅ ${label(a)} ${g.as} @ ${label(h)} ${g.hs} · ${Object.keys(r.by).length === 2 ? "both played" : `${people.replace(/^✅ /, "")}`}`;
  if (r.how === "forced") return `⚖️ ${match} · ${forceText(d, g)} · ${people || "no user teams"}`;
  if (r.how === "unknown") return `❓ ${label(a)} @ ${label(h)} · EA didn't say if this was played or simmed before the advance; not counted. An admin can settle it with \`/set force\` and \`activity\`.`;
  return `❌ ${match} · not played (sim) · ${people}`;
}

type Totals = Map<string, { p: number; m: number; teams: Set<string> }>;
function totals(d: LeagueData, st: ActivityState): Totals {
  const out: Totals = new Map();
  for (const r of Object.values(st.games)) {
    for (const [tid, x] of Object.entries(r.by)) {
      const e = out.get(x.u) || { p: 0, m: 0, teams: new Set<string>() };
      if (x.s === "P") e.p++; else e.m++;
      const t = d.teams.find((tt) => String(tt.id) === tid);
      if (t) e.teams.add(t.abbr);
      out.set(x.u, e);
    }
  }
  return out;
}

function totalsEmbed(d: LeagueData, st: ActivityState): Embed {
  const rows = [...totals(d, st)].sort((a, b) => b[1].m - a[1].m || a[0].localeCompare(b[0]));
  const lines = rows.map(([u, e]) => `**${u}** (${[...e.teams].join("/")}): ${e.p} played · ${e.m} missed${e.m ? " ⚠️" : ""}`);
  return {
    title: `${st.season} activity: games played and missed`,
    color: BRAND,
    description: (lines.length ? lines.join("\n") : "Nothing counted yet. Games show up here as they're played, and misses after each advance.").slice(0, 4000),
    footer: { text: `Counting from ${weekTitle(d, ...(st.start.split(":").map(Number) as [number, number]))} · updated each sync` },
  };
}

async function post(channelId: string, body: Record<string, unknown>) {
  return dc("POST", `/channels/${channelId}/messages`, { allowed_mentions: { parse: [] }, ...body });
}

/** Finds or makes the Activity category and #activity-tracker-week (bot-only). Keeps the counts if they exist. */
async function ensureChannel(lg: LinkedLeague, d: LeagueData, repair: boolean): Promise<ActivityState | string> {
  const guildId = discordOf(lg)?.guildId;
  if (!guildId) return "This league isn't linked to a Discord server yet (an admin runs /link there).";
  const old = readActivity(lg);
  const list = await dc("GET", `/guilds/${guildId}/channels`);
  if (!list.ok) return `Discord said ${list.status} listing the server's channels.`;
  const chans = (Array.isArray(list.data) ? list.data : []) as unknown as { id: string; name: string; type: number; parent_id?: string }[];
  if (!repair && old && chans.some((c) => c.id === old.channelId)) return old;

  let cat = (old?.categoryId && chans.find((c) => c.id === old.categoryId && c.type === 4)?.id)
    || chans.find((c) => c.type === 4 && c.name.toLowerCase() === "activity")?.id;
  if (!cat) {
    const r = await dc("POST", `/guilds/${guildId}/channels`, { name: "Activity", type: 4 });
    if (!r.ok) return r.status === 403 ? "The bot needs the Manage Channels permission to make the Activity category." : `Discord said ${r.status}: ${String(r.data.message || "")}`;
    cat = String(r.data.id);
  }
  const locked = await botOnly(guildId);
  let ch = (old?.channelId && chans.find((c) => c.id === old.channelId)?.id) || chans.find((c) => c.type === 0 && c.parent_id === cat && c.name === CHANNEL)?.id;
  let fresh = false;
  if (ch && repair) await dc("PATCH", `/channels/${ch}`, { permission_overwrites: locked, topic: TOPIC, parent_id: cat });
  if (!ch) {
    const r = await makeChannel(guildId, { name: CHANNEL, type: 0, parent_id: cat, topic: TOPIC }, locked);
    if (!r.ok) return r.status === 403 ? `The bot couldn't make #${CHANNEL}: it needs Manage Channels.` : `Discord said ${r.status} making #${CHANNEL}.`;
    ch = String(r.data.id);
    fresh = true;
  }
  const st: ActivityState = old
    ? { ...old, categoryId: cat, channelId: ch, totalsMessageId: fresh ? null : old.totalsMessageId }
    : { categoryId: cat, channelId: ch, totalsMessageId: null, season: d.season.year, start: wkOf(d.season.stage, d.season.week), games: {}, wrapped: [] };
  if (fresh) {
    await post(ch, { content: `**User activity.** Every user game played posts here after each sync. After each advance, the week that ended gets a wrap-up: games an admin set with \`/set\` first (the team picked for \`activity\` gets a game played, not a miss), then games nobody played, which count as a sim with a miss for both users. Season totals are in the next message and stay up to date.` });
  }
  await save(lg, st);
  return st;
}

/** Keeps the season-totals message current (made on first use, or again if it was deleted). */
async function refreshTotals(st: ActivityState, d: LeagueData) {
  const embed = totalsEmbed(d, st);
  if (st.totalsMessageId) {
    const r = await dc("PATCH", `/channels/${st.channelId}/messages/${st.totalsMessageId}`, { embeds: [embed], allowed_mentions: { parse: [] } });
    if (r.ok || !isGone(r)) return;
  }
  const m = await post(st.channelId, { embeds: [embed] });
  if (m.ok) {
    st.totalsMessageId = String(m.data.id);
    await dc("PUT", `/channels/${st.channelId}/pins/${st.totalsMessageId}`).catch(() => null);
  }
}

/** The work for one run: new played games, wrap-ups for finished weeks, the totals. */
async function runActivity(lg: LinkedLeague, st: ActivityState, d: LeagueData): Promise<string> {
  const notes: string[] = [];
  // a new season: keep last season's totals, start over
  if (st.season !== d.season.year) {
    st.history = { ...(st.history || {}), [String(st.season)]: Object.fromEntries([...totals(d, st)].map(([u, e]) => [u, [e.p, e.m] as [number, number]])) };
    await post(st.channelId, { content: `**${st.season} season done.** Final activity totals are kept; counting starts over for ${d.season.year}.` });
    Object.assign(st, { season: d.season.year, start: wkOf(d.season.stage, d.season.week), games: {}, wrapped: [], totalsMessageId: null });
  }
  const cur = rankOf(wkOf(d.season.stage, d.season.week)), start = rankOf(st.start);
  const tracked = d.games.filter((g) => g.stage === 1 && g.home && g.away && rankOf(wkOf(g.stage, g.week)) >= start && rankOf(wkOf(g.stage, g.week)) <= cur && userTeams(d, g).length);
  let changed = false;

  // games played since the last run (any tracked week), one post each
  const played: string[] = [];
  for (const g of tracked.sort((a, b) => a.week - b.week || a.id - b.id)) {
    if (st.games[String(g.id)] || !playedNow(g)) continue;
    const r = judge(d, g);
    st.games[String(g.id)] = r;
    played.push(`**${weekTitle(d, g.stage, g.week)}** · ${line(d, g, r)}`);
  }
  for (let k = 0; k < played.length; k += 15) { await post(st.channelId, { content: played.slice(k, k + 15).join("\n") }); await sleep(250); }
  if (played.length) { changed = true; notes.push(`${played.length} game${played.length === 1 ? "" : "s"} played`); }

  // weeks that are over (the league advanced past them): wrap-up of forces and misses
  const weeks = [...new Set(tracked.map((g) => wkOf(g.stage, g.week)))].filter((w) => rankOf(w) < cur && !st.wrapped.includes(w)).sort((a, b) => rankOf(a) - rankOf(b));
  for (const w of weeks) {
    const games = tracked.filter((g) => wkOf(g.stage, g.week) === w);
    const forced: string[] = [], missed: string[] = [], unknown: string[] = [];
    let nPlayed = 0;
    for (const g of games) {
      const prev = st.games[String(g.id)];
      if (prev?.how === "played" && !g.forced) { nPlayed++; continue; }
      const r = judge(d, g);
      st.games[String(g.id)] = r;
      if (r.how === "played") nPlayed++;
      else if (r.how === "forced") forced.push(line(d, g, r));
      else if (r.how === "unknown") unknown.push(line(d, g, r));
      else missed.push(line(d, g, r));
    }
    const [s, wk] = w.split(":").map(Number);
    const parts = [
      forced.length ? `**Set by admins**\n${forced.join("\n")}` : "",
      missed.length ? `**Not played: counted as a sim, a miss for each user**\n${missed.join("\n")}` : "",
      unknown.length ? `**Not counted**\n${unknown.join("\n")}` : "",
      `${nPlayed} user game${nPlayed === 1 ? "" : "s"} played this week${forced.length || missed.length ? "" : ", no misses"}.`,
    ].filter(Boolean);
    await post(st.channelId, { embeds: [{ title: `📋 ${d.season.year} ${weekTitle(d, s, wk)}: activity wrap-up`, color: BRAND, description: parts.join("\n\n").slice(0, 4000) }] });
    st.wrapped.push(w);
    changed = true;
    notes.push(`${weekTitle(d, s, wk)} wrapped up (${forced.length} forced, ${missed.length} missed${unknown.length ? `, ${unknown.length} unknown` : ""})`);
  }

  if (changed || !st.totalsMessageId) await refreshTotals(st, d);
  await save(lg, st);
  return notes.length ? `Activity: ${notes.join("; ")}.` : "Activity: nothing new.";
}

/** After every sync (and from /activitychannels): only if /activitychannels has been run. */
export async function syncActivity(slug: string): Promise<string> {
  const lg = await leagueBySlug(slug);
  if (!lg || !readActivity(lg)) return "Activity tracking isn't set up (/activitychannels).";
  return withLeagueLock(lg.id, "activity", BUSY, async () => {
    const fresh = await leagueBySlug(slug);
    forgetLeagueData(slug);
    const d = await getLeagueData(slug);
    if (!fresh || !d) return "No league data yet.";
    const st = await ensureChannel(fresh, d, false);
    if (typeof st === "string") return st;
    return runActivity(fresh, st, d);
  }).catch((e) => `Activity failed: ${(e as Error).message}`);
}

/** /activitychannels: make or repair the channel and catch up; Remove deletes the channel and the counts. */
export async function activityChannelsCmd(slug: string, remove: boolean): Promise<string> {
  const lg = await leagueBySlug(slug);
  if (!lg) return "This league isn't linked to a Discord server (/link).";
  if (remove) {
    const st = readActivity(lg);
    if (!st) return "Activity tracking isn't set up.";
    await dc("DELETE", `/channels/${st.channelId}`);
    await dc("DELETE", `/channels/${st.categoryId}`);
    await save(lg, null);
    return "Activity tracking removed (the channel and its counts). Run /activitychannels again to start over from the current week.";
  }
  return withLeagueLock(lg.id, "activity", BUSY, async () => {
    const d = await getLeagueData(slug);
    if (!d) return "No league data yet.";
    const isNew = !readActivity(lg);
    const st = await ensureChannel(lg, d, true);
    if (typeof st === "string") return st;
    const res = await runActivity(lg, st, d);
    return [
      isNew ? `Activity tracking is on: <#${st.channelId}> (bot-only). Counting starts with ${d.season.year} ${weekTitle(d, ...(st.start.split(":").map(Number) as [number, number]))}.` : `<#${st.channelId}> repaired and up to date.`,
      "It updates after every sync: played games right away, and after each advance a wrap-up with admin forces (/set, with the `activity` team getting a game played) and misses for games nobody played.",
      res,
    ].join("\n");
  }).catch((e) => `Activity failed: ${(e as Error).message}`);
}

/** After /set changes a force: if that game was already counted (played, or its week wrapped up), recount it and post the change. */
export async function activityAfterForce(slug: string, gameId: number): Promise<string> {
  const lg = await leagueBySlug(slug);
  const st0 = lg ? readActivity(lg) : null;
  if (!lg || !st0) return "";
  return withLeagueLock(lg.id, "activity", " Activity tracking was busy; the change counts at the next sync's wrap-up if that week isn't wrapped up yet.", async () => {
    const fresh = await leagueBySlug(slug);
    const st = fresh ? readActivity(fresh) : null;
    forgetLeagueData(slug);
    const d = await getLeagueData(slug);
    const g = d?.games.find((x) => x.id === gameId);
    if (!fresh || !st || !d || !g || st.season !== d.season.year) return "";
    const w = wkOf(g.stage, g.week);
    const prev = st.games[String(g.id)];
    if (!prev && !st.wrapped.includes(w)) return " Activity counts it in that week's wrap-up after the advance.";
    if (rankOf(w) < rankOf(st.start)) return "";
    const next = judge(d, g);
    // the week isn't over and the force was taken off: it isn't decided yet
    if (!st.wrapped.includes(w) && next.how !== "played") { delete st.games[String(g.id)]; }
    else st.games[String(g.id)] = next;
    if (JSON.stringify(prev) === JSON.stringify(st.games[String(g.id)])) return "";
    await post(st.channelId, { content: `✏️ **Updated after /set** · ${weekTitle(d, g.stage, g.week)} · ${st.games[String(g.id)] ? line(d, g, next) : `${label(d.teams.find((t) => t.id === g.away))} @ ${label(d.teams.find((t) => t.id === g.home))}: counted again in this week's wrap-up after the advance`}` });
    await refreshTotals(st, d);
    await save(fresh, st);
    return " Activity tracker updated.";
  }).catch(() => "");
}

/** For tests. */
export const _test = { judge, line, totalsEmbed };
