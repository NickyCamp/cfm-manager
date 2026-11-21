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
//  - #activity-tracker-season: a chart of all 32 teams' users (played, missed, miss %) for this season,
//    cleared and reposted after each advance. #activity-tracker-cycle: every user's totals over every
//    season, starting from the league's own sheet for the seasons before the bot (activitySeeds.ts).
//  - Regular season and playoffs only (stage 1); preseason games never count.
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
import { botAndAdmins, makeChannel } from "./tradeChannels";
import { postToChannel } from "./api";
import { clearChannel } from "./marketChannels";
import { missPct, renderActivity, type ActivityRow } from "./activityImage";
import { seedFor } from "./activitySeeds";

type Status = "P" | "M"; // played, missed
/** How a game counted: played, forced by an admin, missed (not played), or unknown (EA didn't say). */
type How = "played" | "forced" | "missed" | "unknown" | "disconnect";
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
  /** Channel lock version: 2 = the bot and the "admin" role can post. */
  lock?: number;
  seasonChannelId?: string;
  cycleChannelId?: string;
  /** The seasons before the bot, from the league's sheet: each row's EA user is the team's user when it was loaded. */
  seed?: { version?: number; seasons: string[]; gamesPerSeason: number; rows: { name: string; team: string; ea: string | null; misses: number[] }[];
    /** Team abbr → the name its games count under from now on, whoever's EA account runs it (a new user, e.g. NO → Lee). */
    teamNames?: Record<string, string> };
  /** Team id → the last EA user seen running it. A forced game where the user played the other team's CPU
   *  (Nick, 2026-11-21) can sync with that team showing no user; this still gives that user the miss. */
  owners?: Record<string, string>;
};

const CHANNEL = "activity-tracker-week";
const TOPIC = "User activity: games played and missed each week. Posted by the bot after every sync and advance.";
const SEASON_CH = "activity-tracker-season", CYCLE_CH = "activity-tracker-cycle";
const SEASON_TOPIC = "Every team's user: games played and missed this season (regular season + playoffs). Redrawn after each advance.";
const CYCLE_TOPIC = "Every user's games played and missed over every season. Redrawn after each advance.";
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

/** The user a team belongs to even while EA shows it as CPU: the name set for the team (seed teamNames),
 *  the last EA user seen running it, or the sheet's EA user for it. */
function ownerOf(st: ActivityState | null | undefined, t: Team): string {
  return t.user || st?.seed?.teamNames?.[t.abbr] || st?.owners?.[String(t.id)] || st?.seed?.rows.find((r) => r.team === t.abbr && r.ea)?.ea || "";
}
/** Both users of a forced game. Forces are for user games, so a team EA shows as CPU (its user was
 *  taken off so the other user could play its CPU, a common force-win setup) still counts for its user. */
function forcedTeams(st: ActivityState | null | undefined, d: LeagueData, g: Game): Team[] {
  return [g.away, g.home].map((id) => d.teams.find((t) => t.id === id)).filter((t): t is Team => Boolean(t))
    .map((t) => ({ ...t, user: ownerOf(st, t) })).filter((t) => t.user);
}
/** Teams a game counts for: forced games include a user team EA shows as CPU (see forcedTeams). */
const countedTeams = (st: ActivityState | null | undefined, d: LeagueData, g: Game) => (g.forced ? forcedTeams(st, d, g) : userTeams(d, g));

/** Remembers each team's EA user, so a team that briefly shows as CPU still has one. */
function noteOwners(st: ActivityState, d: LeagueData) {
  for (const t of d.teams) if (t.user) (st.owners ||= {})[String(t.id)] = t.user;
}

/** How a game counts once its week is over (or now, for a game already played). */
function judge(d: LeagueData, g: Game, st?: ActivityState | null): Rec {
  const wk = wkOf(g.stage, g.week);
  const users = countedTeams(st, d, g);
  if (g.forced) {
    const act = new Set(activityTeams(g.forced));
    return { wk, how: "forced", by: Object.fromEntries(users.map((t) => [String(t.id), { u: t.user, s: act.has(t.id) ? "P" : "M" }])) };
  }
  // /set disconnect: both users played, even if EA simmed it
  if (g.disconnect) return { wk, how: "disconnect", by: Object.fromEntries(users.map((t) => [String(t.id), { u: t.user, s: "P" as Status }])) };
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
    return x ? `${x.s === "P" ? "✅" : "❌"} ${x.u} (${t!.abbr}) ${x.s === "P" ? "played" : "missed"}` : null;
  };
  const people = [who(a), who(h)].filter(Boolean).join(" · ");
  const match = `${a?.abbr ?? "?"} @ ${h?.abbr ?? "?"}`;
  if (r.how === "played") return `✅ ${label(a)} ${g.as} @ ${label(h)} ${g.hs} · ${Object.keys(r.by).length === 2 ? "both played" : `${people.replace(/^✅ /, "")}`}`;
  if (r.how === "disconnect") return `🔌 ${match} · disconnect, not replayed · ${people}`;
  if (r.how === "forced") return `⚖️ ${g.final && g.simmed === false ? `${a?.abbr ?? "?"} ${g.as} @ ${h?.abbr ?? "?"} ${g.hs}` : match} · ${forceText(d, g)} · ${people || "no user teams"}`;
  if (r.how === "unknown") return `❓ ${label(a)} @ ${label(h)} · EA didn't say if this was played or simmed before the advance; not counted. An admin can settle it with \`/set force\` and \`activity\`.`;
  return `❌ ${match} · not played (sim) · ${people}`;
}

/** Who a counted game belongs to: the name set for that team (a new user like NO → Lee, whatever EA account
 *  runs it), otherwise the EA user, shown with their sheet name when they have one. */
function personOf(st: ActivityState, d: LeagueData, teamId: string | number, u: string): { key: string; name: string } {
  const abbr = d.teams.find((t) => String(t.id) === String(teamId))?.abbr;
  const set = abbr ? st.seed?.teamNames?.[abbr] : undefined;
  if (set) return { key: `name:${set.toLowerCase()}`, name: set };
  return { key: u.toLowerCase(), name: displayName(st, u) };
}
/** The name for a key from personOf (history is saved by key). */
function nameOfKey(st: ActivityState, key: string): string {
  if (key.startsWith("name:")) return Object.values(st.seed?.teamNames || {}).find((n) => `name:${n.toLowerCase()}` === key) || key.slice(5);
  return displayName(st, key);
}

type Totals = Map<string, { name: string; p: number; m: number; teams: Set<string> }>;
function totals(d: LeagueData, st: ActivityState): Totals {
  const out: Totals = new Map();
  for (const r of Object.values(st.games)) {
    for (const [tid, x] of Object.entries(r.by)) {
      const who = personOf(st, d, tid, x.u);
      const e = out.get(who.key) || { name: who.name, p: 0, m: 0, teams: new Set<string>() };
      if (x.s === "P") e.p++; else e.m++;
      const t = d.teams.find((tt) => String(tt.id) === tid);
      if (t) e.teams.add(t.abbr);
      out.set(who.key, e);
    }
  }
  return out;
}

function totalsEmbed(d: LeagueData, st: ActivityState): Embed {
  const rows = [...totals(d, st)].sort((a, b) => b[1].m - a[1].m || a[1].name.localeCompare(b[1].name));
  const lines = rows.map(([, e]) => `**${e.name}** (${[...e.teams].join("/")}): ${e.p} played · ${e.m} missed${e.m ? " ⚠️" : ""}`);
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
  const have = (id?: string) => Boolean(id && chans.some((c) => c.id === id));
  // lock v2 (2026-11-19): bot + the "admin" role can post; channels made before get the new lock once
  if (old && (old.lock || 0) < 2) repair = true;
  const seedNow = seedFor(lg.slug, lg.name);
  const seedStale = Boolean(seedNow && (!old?.seed || (old.seed.version || 1) < seedNow.version));
  if (!repair && !seedStale && old && have(old.channelId) && have(old.seasonChannelId) && have(old.cycleChannelId)) return old;

  let cat = (old?.categoryId && chans.find((c) => c.id === old.categoryId && c.type === 4)?.id)
    || chans.find((c) => c.type === 4 && c.name.toLowerCase() === "activity")?.id;
  if (!cat) {
    const r = await dc("POST", `/guilds/${guildId}/channels`, { name: "Activity", type: 4 });
    if (!r.ok) return r.status === 403 ? "The bot needs the Manage Channels permission to make the Activity category." : `Discord said ${r.status}: ${String(r.data.message || "")}`;
    cat = String(r.data.id);
  }
  const { lock: locked } = await botAndAdmins(guildId);
  const made: Record<string, boolean> = {};
  const one = async (known: string | undefined, name: string, topic: string): Promise<string> => {
    let id = (known && chans.find((c) => c.id === known)?.id) || chans.find((c) => c.type === 0 && c.parent_id === cat && c.name === name)?.id;
    if (id && repair) await dc("PATCH", `/channels/${id}`, { permission_overwrites: locked, topic, parent_id: cat });
    if (!id) {
      const r = await makeChannel(guildId, { name, type: 0, parent_id: cat, topic }, locked);
      if (!r.ok) throw new Error(r.status === 403 ? `The bot couldn't make #${name}: it needs Manage Channels.` : `Discord said ${r.status} making #${name}.`);
      id = String(r.data.id);
      made[name] = true;
    }
    return id;
  };
  let ch: string, seasonCh: string, cycleCh: string;
  try {
    ch = await one(old?.channelId, CHANNEL, TOPIC);
    seasonCh = await one(old?.seasonChannelId, SEASON_CH, SEASON_TOPIC);
    cycleCh = await one(old?.cycleChannelId, CYCLE_CH, CYCLE_TOPIC);
  } catch (e) { return (e as Error).message; }
  const fresh = Boolean(made[CHANNEL]);
  const st: ActivityState = old
    ? { ...old, lock: 2, categoryId: cat, channelId: ch, seasonChannelId: seasonCh, cycleChannelId: cycleCh, totalsMessageId: fresh ? null : old.totalsMessageId }
    : { lock: 2, categoryId: cat, channelId: ch, seasonChannelId: seasonCh, cycleChannelId: cycleCh, totalsMessageId: null, season: d.season.year, start: wkOf(d.season.stage, d.season.week), games: {}, wrapped: [] };
  // the league's sheet for the seasons before the bot (once)
  // (again when the sheet in activitySeeds.ts changes version, e.g. a user leaving: Melo → Lee on the Saints)
  const seed = seedFor(lg.slug, lg.name);
  if (seed && (!st.seed || (st.seed.version || 1) < seed.version)) {
    const teamOf = (nick: string) => d.teams.find((x) => x.name.toLowerCase() === nick.toLowerCase());
    st.seed = {
      version: seed.version, seasons: seed.seasons, gamesPerSeason: seed.gamesPerSeason,
      rows: seed.rows.map((r) => {
        const t = teamOf(r.team);
        // a user who has left keeps his sheet numbers under his name, tied to no EA account
        return { name: r.name, team: t?.abbr || r.team, ea: r.left ? null : (t?.user || null), misses: r.misses };
      }),
      teamNames: Object.fromEntries(Object.entries(seed.teamNames || {}).map(([nick, name]) => [teamOf(nick)?.abbr || nick, name])),
    };
  }
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

/** How a user shows on the charts: their name from the league's sheet when there is one. */
function displayName(st: ActivityState, ea: string): string {
  return st.seed?.rows.find((r) => r.ea && r.ea.toLowerCase() === ea.toLowerCase())?.name || ea;
}

/** This season, one row per team (CPU teams included, with no counts). */
function seasonRows(d: LeagueData, st: ActivityState): ActivityRow[] {
  const rows = d.teams.map((t) => {
    let played = 0, missed = 0;
    const set = st.seed?.teamNames?.[t.abbr];
    // a team with a name set (a new user) counts all its games for that person; otherwise the current EA user's
    if (t.user || set) for (const r of Object.values(st.games)) { const x = r.by[String(t.id)]; if (x && (set || x.u === t.user)) { if (x.s === "P") played++; else missed++; } }
    return { user: set || (t.user ? displayName(st, t.user) : "CPU"), team: t, teamAbbr: t.abbr, played, missed };
  });
  return rows.sort((a, b) => Number(a.user === "CPU") - Number(b.user === "CPU") || missPct(a) - missPct(b) || a.missed - b.missed || b.played - a.played || a.user.localeCompare(b.user));
}

/** Every season: the sheet's seasons, then each season the bot counted (this one included). */
function cycleRows(d: LeagueData, st: ActivityState): { rows: ActivityRow[]; labels: string[] } {
  const seedN = st.seed?.seasons.length || 0;
  // this season gets a column once anything counts (or the season is under way), not while it's an empty offseason
  const live = Object.keys(st.games).length > 0 || d.season.stage <= 1;
  const years = [...Object.keys(st.history || {}).map(Number), ...(live ? [st.season] : [])].filter((y, i, a) => a.indexOf(y) === i).sort((a, b) => a - b);
  const labels = [...(st.seed?.seasons || []), ...years.map((y, i) => `Season ${seedN + i + 1}`)];
  type P = { key: string; name: string; teamAbbr: string; team?: Team; per: ({ p: number; m: number } | null)[] };
  const people = new Map<string, P>();
  const getKey = (key: string, name: string, abbr: string) => {
    if (!people.has(key)) people.set(key, { key, name, teamAbbr: abbr, per: labels.map(() => null) });
    return people.get(key)!;
  };
  const get = (ea: string | null, fallback: string, abbr: string) =>
    ea ? getKey(ea.toLowerCase(), displayName(st, ea), abbr) : getKey(`sheet:${fallback}`.toLowerCase(), fallback, abbr);
  for (const r of st.seed?.rows || []) {
    const p = get(r.ea, r.name, r.team);
    r.misses.forEach((m, k) => { p.per[k] = { p: st.seed!.gamesPerSeason - m, m }; });
  }
  const cur = totals(d, st);
  years.forEach((y, i) => {
    const src: [string, [number, number]][] = y === st.season && !st.history?.[String(y)] ? [...cur].map(([k, e]) => [k, [e.p, e.m]]) : Object.entries(st.history?.[String(y)] || {});
    for (const [k, [pl, mi]] of src) {
      const key = k.toLowerCase();
      const abbr = key.startsWith("name:") ? Object.entries(st.seed?.teamNames || {}).find(([, n]) => `name:${n.toLowerCase()}` === key)?.[0] || "" : "";
      const p = getKey(key, nameOfKey(st, key), abbr);
      p.per[seedN + i] = { p: pl, m: mi };
    }
  });
  const rows: ActivityRow[] = [...people.values()].map((p) => {
    const t = p.key.startsWith("name:") ? d.teams.find((x) => x.abbr === p.teamAbbr) : d.teams.find((x) => x.user && x.user.toLowerCase() === p.key);
    const played = p.per.reduce((s, x) => s + (x?.p || 0), 0), missed = p.per.reduce((s, x) => s + (x?.m || 0), 0);
    const seasons = p.per.filter((x) => x && x.p + x.m > 0).length;
    // newest season first, like the sheet
    return { user: p.name, team: t, teamAbbr: t?.abbr || p.teamAbbr || "—", played, missed, seasons, perSeason: [...p.per].reverse().map((x) => (x ? x.m : null)) };
  }).filter((r) => r.played + r.missed > 0 || r.team);
  rows.sort((a, b) => missPct(a) - missPct(b) || a.missed - b.missed || a.user.localeCompare(b.user));
  return { rows, labels: [...labels].reverse() };
}

/** Clears #activity-tracker-season and #activity-tracker-cycle and posts fresh charts. */
async function postCharts(lg: LinkedLeague, st: ActivityState, d: LeagueData): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return;
  if (st.seasonChannelId) {
    await clearChannel(st.seasonChannelId).catch(() => -1);
    const png = await renderActivity({ title: `${d.season.year} season activity`, subtitle: `${lg.name} · games played and missed · through ${d.season.title}`, rows: seasonRows(d, st) });
    await postToChannel(token, st.seasonChannelId, { content: `**${d.season.year} season activity** (regular season and playoffs; preseason doesn't count). Redrawn after each advance.`, allowed_mentions: { parse: [] } }, { data: png, filename: "activity-season.png", contentType: "image/png" });
  }
  if (st.cycleChannelId) {
    await clearChannel(st.cycleChannelId).catch(() => -1);
    const { rows, labels } = cycleRows(d, st);
    const png = await renderActivity({ title: "Activity: all seasons", subtitle: `${lg.name} · total games played and missed · misses per season`, rows, seasonLabels: labels });
    await postToChannel(token, st.cycleChannelId, { content: `**Activity over every season**${st.seed ? ` (${st.seed.seasons.join(" and ")} from the league's sheet)` : ""}. Redrawn after each advance.`, allowed_mentions: { parse: [] } }, { data: png, filename: "activity-cycle.png", contentType: "image/png" });
  }
}

/** The work for one run: new played games, wrap-ups for finished weeks, the totals. */
async function runActivity(lg: LinkedLeague, st: ActivityState, d: LeagueData, redraw = false): Promise<string> {
  const notes: string[] = [];
  noteOwners(st, d);
  // a new season: keep last season's totals, start over
  if (st.season !== d.season.year) {
    const done = Object.fromEntries([...totals(d, st)].map(([u, e]) => [u, [e.p, e.m] as [number, number]]));
    // a season with nothing counted (tracking began in its offseason) isn't a season of its own
    if (Object.keys(done).length) {
      st.history = { ...(st.history || {}), [String(st.season)]: done };
      await post(st.channelId, { content: `**${st.season} season done.** Final activity totals are kept; counting starts over for ${d.season.year}.` });
    }
    Object.assign(st, { season: d.season.year, start: wkOf(d.season.stage, d.season.week), games: {}, wrapped: [], totalsMessageId: null });
    redraw = true;
  }
  const cur = rankOf(wkOf(d.season.stage, d.season.week)), start = rankOf(st.start);
  const tracked = d.games.filter((g) => g.stage === 1 && g.home && g.away && rankOf(wkOf(g.stage, g.week)) >= start && rankOf(wkOf(g.stage, g.week)) <= cur && countedTeams(st, d, g).length);
  let changed = false;

  // games played since the last run (any tracked week), one post each
  const played: string[] = [];
  for (const g of tracked.sort((a, b) => a.week - b.week || a.id - b.id)) {
    if (st.games[String(g.id)] || !(playedNow(g) || (g.disconnect && g.final))) continue;
    const r = judge(d, g, st);
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
      if ((prev?.how === "played" && !g.forced && !g.disconnect) || (prev?.how === "disconnect" && g.disconnect)) { if (prev.how === "played") nPlayed++; else forced.push(line(d, g, prev)); continue; }
      const r = judge(d, g, st);
      st.games[String(g.id)] = r;
      if (r.how === "played") nPlayed++;
      else if (r.how === "forced" || r.how === "disconnect") forced.push(line(d, g, r));
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
  // the season and cycle charts: after each advance (a wrap-up), and when asked
  if (weeks.length || redraw) await postCharts(lg, st, d).catch((e) => console.error("activity charts", (e as Error).message));
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
    for (const id of [st.channelId, st.seasonChannelId, st.cycleChannelId]) if (id) await dc("DELETE", `/channels/${id}`);
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
    const res = await runActivity(lg, st, d, true);
    return [
      isNew ? `Activity tracking is on: <#${st.channelId}>, <#${st.seasonChannelId}> and <#${st.cycleChannelId}> (bot-only). Counting starts with ${d.season.year} ${weekTitle(d, ...(st.start.split(":").map(Number) as [number, number]))}; preseason never counts.` : `<#${st.channelId}>, <#${st.seasonChannelId}> and <#${st.cycleChannelId}> repaired and up to date.`,
      st.seed ? `The all-seasons chart starts from the league's sheet (${st.seed.seasons.join(", ")}): ${st.seed.rows.filter((r) => !r.ea).length ? `couldn't match ${st.seed.rows.filter((r) => !r.ea).map((r) => r.name).join(", ")} to a team with a user` : "every row matched to its team's user"}.` : "",
      "It updates after every sync: played games right away, and after each advance a wrap-up with admin forces (/set, with the `activity` team getting a game played) and misses for games nobody played.",
      res,
    ].filter(Boolean).join("\n");
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
    const next = judge(d, g, st);
    // the week isn't over and the force was taken off: it isn't decided yet
    if (!st.wrapped.includes(w) && next.how !== "played" && !(next.how === "disconnect" && g.final)) { delete st.games[String(g.id)]; }
    else st.games[String(g.id)] = next;
    if (JSON.stringify(prev) === JSON.stringify(st.games[String(g.id)])) return "";
    await post(st.channelId, { content: `✏️ **Updated after /set** · ${weekTitle(d, g.stage, g.week)} · ${st.games[String(g.id)] ? line(d, g, next) : `${label(d.teams.find((t) => t.id === g.away))} @ ${label(d.teams.find((t) => t.id === g.home))}: counted again in this week's wrap-up after the advance`}` });
    await refreshTotals(st, d);
    if (st.wrapped.includes(w)) await postCharts(fresh, st, d).catch(() => {});
    await save(fresh, st);
    return " Activity tracker updated.";
  }).catch(() => "");
}

/** For tests. */
export const _test = { judge, line, countedTeams, totalsEmbed, seasonRows, cycleRows };
