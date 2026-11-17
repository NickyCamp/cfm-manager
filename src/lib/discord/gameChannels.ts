// Weekly game channels (Nick, 2026-11-14: "a command to generate each week's game channels
// like you do for the markets"). The bot keeps a category named after the current week
// ("2027 - Week 12") with one channel per game, where the two managers set up their game.
// Each channel opens with both managers pinged (Discord linked with /connect; otherwise
// their PSN/Xbox name), records, the kickoff on file and the /tws matchup chart. On each
// advance the old channels are deleted and the new week's are created; when a game goes
// final its opening message turns into the final score.
//
// Runs on the site (needs DISCORD_BOT_TOKEN + Manage Channels): from /gamechannels, and
// after every sync (the worker calls POST /api/leagues/<slug>/discord/gamechannels).
import { getLeagueData } from "@/lib/league/load";
import { weekTitle } from "@/lib/league/derive";
import { supabaseAdmin } from "@/lib/supabase/server";
import { updateLeagueSettings } from "@/lib/leagueSettings";
import { closeTimes, fmtET } from "@/lib/marketStore";
import { discordOfUser } from "@/lib/tickets";
import { discordOf, leagueBySlug } from "./links";
import { BRAND, hexColor, type Embed } from "./api";
import { matchupImageUrl } from "./cardLink";
import { weekIndex } from "./matchup";
import { channelGone, dc, sleep } from "./rest";
import { withLeagueLock } from "./lock";

/** True only when Discord says the channel is gone. If Discord can't say (rate limit, outage), assume it's
 *  still there: recreating on a hiccup is what leaves duplicate channels behind. */
const surelyGone = (id: string) => channelGone(id).catch(() => false);
import type { Game, LeagueData, Team } from "@/lib/league/types";

const APP_URL = (process.env.APP_URL || "https://cfm-manager-delta.vercel.app").replace(/\/$/, "");

type GameChannel = { channelId: string; messageId: string | null; final?: boolean };
export type GameChannels = { categoryId: string; weekKey: string; games: Record<string, GameChannel> };

const keyOf = (year: number, stage: number, week: number) => `${year}:${stage}:${week}`;
/** Orders week keys so an automatic refresh only ever moves forward. */
const rank = (key: string) => { const [y, s, w] = key.split(":").map(Number); return (y || 0) * 1000 + (s || 0) * 100 + (w || 0); };
const slugName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 90);
const record = (t: Team) => `${t.rec.w}-${t.rec.l}${t.rec.t ? `-${t.rec.t}` : ""}`;

async function saveState(leagueId: string, state: GameChannels | null) {
  await updateLeagueSettings(leagueId, (settings) => {
    if (state) settings.gameChannels = state; else delete settings.gameChannels;
    return settings;
  });
}

/** Team id → the server role for that team, matched by name: "Eagles", "Philadelphia Eagles" or "PHI" (any case). */
export async function teamRoles(guildId: string, teams: Team[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const r = await dc("GET", `/guilds/${guildId}/roles`);
  if (!r.ok || !Array.isArray(r.data)) return out;
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  const roles = (r.data as unknown as { id: string; name: string }[]).map((x) => ({ id: String(x.id), key: norm(x.name) }));
  for (const t of teams) {
    const want = [norm(t.name), norm(`${t.city} ${t.name}`), norm(t.abbr)];
    const hit = want.map((w) => roles.find((x) => x.key === w)).find(Boolean);
    if (hit) out.set(t.id, hit.id);
  }
  return out;
}

/** Team abbr (lowercase) → the Discord id of the member who runs it (linked with /connect). */
async function managersByTeam(leagueId: string, teams: Team[]): Promise<Map<string, string>> {
  const db = supabaseAdmin();
  const { data } = await db.from("league_members").select("user_id, team_abbr").eq("league_id", leagueId);
  const members = (data || []).map((r) => ({ user: r.user_id as string, abbr: (r.team_abbr as string | null) || "" }));
  // Nothing in the app sets team_abbr, so the team usually comes from EA: the team whose in-game user
  // is one of the member's connected EA names (the same match as card art and the own-game betting rule).
  const { data: conns } = members.length ? await db.from("ea_connections").select("user_id, persona_name").in("user_id", members.map((m) => m.user)) : { data: [] };
  const byName = new Map((conns || []).map((c) => [String(c.persona_name || "").trim().toLowerCase(), c.user_id as string]));
  const userOfTeam = new Map<string, string>();
  for (const t of teams) { const u = t.user ? byName.get(t.user.trim().toLowerCase()) : undefined; if (u) userOfTeam.set(t.abbr.toLowerCase(), u); }
  for (const m of members) if (m.abbr) userOfTeam.set(m.abbr.toLowerCase(), m.user);
  const out = new Map<string, string>();
  await Promise.all([...userOfTeam].map(async ([abbr, user]) => {
    const dsc = await discordOfUser(user).catch(() => null);
    if (dsc) out.set(abbr, dsc.id);
  }));
  return out;
}

const who = (t: Team, ids: Map<string, string>) => {
  const id = ids.get(t.abbr.toLowerCase());
  return id ? `<@${id}>` : t.user ? `**${t.user}**` : "CPU";
};

function gameEmbed(slug: string, d: LeagueData, g: Game, a: Team, h: Team, ids: Map<string, string>, kickoff?: string): Embed {
  const lines = g.final
    ? [`**Final: ${a.abbr} ${g.as}, ${h.abbr} ${g.hs}**${g.simmed ? " (sim)" : ""} · [box score](${APP_URL}/l/${slug}/games/${g.id})`]
    : [
      `${a.abbr} (${record(a)}): ${who(a, ids)}`,
      `${h.abbr} (${record(h)}): ${who(h, ids)}`,
      kickoff ? `⏰ Kickoff on file: **${kickoff}**` : "Set up your game here. Once you agree on a time, either manager can run `/kickoff` so the Markets close at kickoff.",
      `[Game page](${APP_URL}/l/${slug}/games/${g.id})`,
    ];
  return {
    title: `${weekTitle(d, g.stage, g.week)}: ${a.city} ${a.name} at ${h.city} ${h.name}`,
    url: `${APP_URL}/l/${slug}/games/${g.id}`,
    color: hexColor(h.primary) || BRAND,
    description: lines.join("\n"),
    image: { url: matchupImageUrl(APP_URL, slug, g.id) },
    footer: { text: `${a.abbr} @ ${h.abbr} · ${d.season.year} season` },
  };
}

/**
 * Creates/refreshes the game channels for one week; switching weeks deletes the old ones first.
 * `pick` (from /gamechannels year week; week 1-18, 19 Wild Card … 22 Super Bowl) builds that week.
 * Without it (the after-sync refresh, or the command with no options) it uses the current week,
 * but never moves back from a later week someone built ahead of time.
 */
export async function syncGameChannels(slug: string, pick?: { year?: number; week?: number }): Promise<string> {
  const lg = await leagueBySlug(slug);
  if (!lg) return "This league isn't linked to a Discord server (/link).";
  return withLeagueLock(lg.id, "gameChannels", BUSY, () => syncGameChannelsNow(slug, pick).catch((e) => `Stopped: ${(e as Error).message}`));
}
const BUSY = "The game channels are already being updated (a sync, or someone else's command). Give it a minute, then try again.";

async function syncGameChannelsNow(slug: string, pick?: { year?: number; week?: number }): Promise<string> {
  const lg = await leagueBySlug(slug);
  const guildId = lg ? discordOf(lg)?.guildId : null;
  if (!lg || !guildId) return "This league isn't linked to a Discord server (/link).";
  const d = await getLeagueData(slug);
  if (!d) return "No league data yet.";
  let state = (lg.settings?.gameChannels as GameChannels | undefined) || null;

  let stage = d.season.stage, week = d.season.week;
  if (pick?.year && pick.year !== d.season.year) return `Only this season's schedule (${d.season.year}) is loaded, so pick year ${d.season.year}.`;
  if (pick?.week) { stage = 1; week = weekIndex(pick.week); }
  else if (state?.weekKey && state.weekKey.startsWith(`${d.season.year}:`) && rank(state.weekKey) > rank(keyOf(d.season.year, stage, week))) {
    [, stage, week] = state.weekKey.split(":").map(Number); // keep the week built ahead of time
  }
  const key = keyOf(d.season.year, stage, week);
  const title = weekTitle(d, stage, week);
  const catName = `${d.season.year} - ${title}`.slice(0, 100); // "2027 - Week 12" (Nick's format)
  const teams = new Map(d.teams.map((t) => [t.id, t]));
  // every game on this week's schedule, CPU games included
  const games = d.games.filter((g) => g.stage === stage && g.week === week && g.home && g.away);
  if (!games.length && pick?.week) return `There are no games on the schedule for ${d.season.year} ${title} yet.`;

  // category (renamed for the new week)
  if (state?.categoryId) {
    const c = await dc("GET", `/channels/${state.categoryId}`);
    if (!c.ok) { if (await channelGone(state.categoryId)) state = null; } // throws if Discord can't say, so a hiccup doesn't start a second category
    else if (c.data.name !== catName) await dc("PATCH", `/channels/${state.categoryId}`, { name: catName });
  }
  if (!state) {
    const cat = await dc("POST", `/guilds/${guildId}/channels`, { name: catName, type: 4 });
    if (!cat.ok) return cat.status === 403 ? "The bot needs the Manage Channels permission in this server to make game channels." : `Discord said ${cat.status}: ${String(cat.data.message || "")}`;
    state = { categoryId: String(cat.data.id), weekKey: "", games: {} };
  }

  // new week: clear out last week's channels
  let removed = 0;
  if (state.weekKey !== key) {
    for (const g of Object.values(state.games)) { const r = await dc("DELETE", `/channels/${g.channelId}`); if (r.ok) removed++; await sleep(250); }
    state.games = {};
    state.weekKey = key;
  }

  const ids = await managersByTeam(lg.id, d.teams);
  const roles = await teamRoles(guildId, d.teams);
  const closes = await closeTimes(lg.id, d.season.year).catch(() => new Map<number, { closeAt: string }>());

  let created = 0, updated = 0;
  for (const g of games) {
    const a = teams.get(g.away)!, h = teams.get(g.home)!;
    let gc = state.games[String(g.id)];
    if (gc && (await surelyGone(gc.channelId))) gc = undefined as unknown as GameChannel;
    const c = closes.get(g.id);
    const embed = gameEmbed(slug, d, g, a, h, ids, c ? fmtET(c.closeAt) : undefined);
    if (!gc) {
      const ch = await dc("POST", `/guilds/${guildId}/channels`, {
        name: slugName(`${a.name}-at-${h.name}`), type: 0, parent_id: state.categoryId,
        topic: `${title}: ${a.abbr} (${a.user || "CPU"}) at ${h.abbr} (${h.user || "CPU"}) · schedule your game here`,
      });
      if (!ch.ok) { await saveState(lg.id, state); return ch.status === 403 ? "The bot needs the Manage Channels permission in this server." : `Discord said ${ch.status} creating a game channel.`; }
      gc = { channelId: String(ch.data.id), messageId: null };
      state.games[String(g.id)] = gc;
      // The opening message tags both teams' server roles (@Eagles @Saints; Nick, 2026-11-14), falling
      // back to the manager's linked Discord account for a team with no role. Only this once; edits don't ping.
      const tag = [a, h].map((t) => roles.get(t.id) ? { role: roles.get(t.id)! } : ids.get(t.abbr.toLowerCase()) ? { user: ids.get(t.abbr.toLowerCase())! } : null);
      const text = tag.map((x, k) => x?.role ? `<@&${x.role}>` : x?.user ? `<@${x.user}>` : `**${[a, h][k].name}**`);
      const m = await dc("POST", `/channels/${gc.channelId}/messages`, {
        content: `${text[0]} @ ${text[1]}: your ${title} game. Schedule it here.`,
        embeds: [embed], allowed_mentions: { roles: tag.flatMap((x) => (x?.role ? [x.role] : [])), users: tag.flatMap((x) => (x?.user ? [x.user] : [])) },
      });
      gc.messageId = m.ok ? String(m.data.id) : null;
      gc.final = g.final;
      created++;
      await sleep(300);
    } else if (gc.messageId) {
      // Keep it current (kickoff, records, final score); the chart link is re-signed each time.
      const r = await dc("PATCH", `/channels/${gc.channelId}/messages/${gc.messageId}`, { embeds: [embed], allowed_mentions: { parse: [] } });
      if (r.ok) updated++;
      if (g.final && !gc.final) {
        gc.final = true;
        await dc("POST", `/channels/${gc.channelId}/messages`, { content: `🏁 Final: **${a.abbr} ${g.as}, ${h.abbr} ${g.hs}**${g.simmed ? " (sim)" : ""}`, allowed_mentions: { parse: [] } });
      }
    }
  }
  await saveState(lg.id, state);
  return `Game channels up to date (category **${catName}**): ${games.length} channel${games.length === 1 ? "" : "s"}${created ? ` (${created} new)` : ""}${removed ? `, ${removed} old removed` : ""}${updated ? `, ${updated} refreshed` : ""}. New channels tag both teams' roles (found ${roles.size} of ${d.teams.length} team roles${roles.size < d.teams.length ? `; missing: ${d.teams.filter((t) => !roles.has(t.id)).map((t) => t.name).slice(0, 12).join(", ")}` : ""}). They roll over after every advance.`;
}

/** /gamechannels off: deletes the category and its channels and stops the weekly rollover. */
export async function removeGameChannels(slug: string): Promise<string> {
  const lg = await leagueBySlug(slug);
  if (!lg) return "Game channels aren't set up here.";
  return withLeagueLock(lg.id, "gameChannels", BUSY, () => removeGameChannelsNow(slug).catch((e) => `Stopped: ${(e as Error).message}`));
}

async function removeGameChannelsNow(slug: string): Promise<string> {
  const lg = await leagueBySlug(slug);
  const state = lg?.settings?.gameChannels as GameChannels | undefined;
  if (!lg || !state) return "Game channels aren't set up here.";
  for (const g of Object.values(state.games)) { await dc("DELETE", `/channels/${g.channelId}`); await sleep(250); }
  await dc("DELETE", `/channels/${state.categoryId}`);
  await saveState(lg.id, null);
  return "Game channels removed. Run /gamechannels again any time to bring them back.";
}
