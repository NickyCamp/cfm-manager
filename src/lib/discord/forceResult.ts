// /set (Nick, 2026-11-19): admins force a result on a game from the game channel categories.
//   /set force game:<game channel> result:<Force Win | Force Loss | Force Sim> [team] [activity]
// activity (Nick, 2026-11-19): the team whose user gets credit for the game as played, not missed.
//   /set remove game:<a forced game>
// A forced game is stored in leagues.settings.forcedGames[year][gameId]. getLeagueData overlays it
// (game.simmed = true, game.forced), so the site shows it as simmed, /audit games leaves it out
// like any simmed game, and its game and prop markets close and settle void (every stake back).
// The game's channel is renamed (e.g. eagles-at-saints-force-win-eagles) and gets a note.
import { getLeagueData, forgetLeagueData } from "@/lib/league/load";
import { weekTitle } from "@/lib/league/derive";
import { marketBook } from "@/lib/league/markets";
import type { Game, LeagueData, Team } from "@/lib/league/types";
import { updateLeagueSettings } from "@/lib/leagueSettings";
import { settleFinished } from "@/lib/marketStore";
import { bookKey, ticketsConfig } from "@/lib/tickets";
import { readGameChannels } from "./gameChannels";
import type { LinkedLeague } from "./links";
import { dc } from "./rest";

export type ForceKind = "win" | "loss" | "sim";
export type ForcedGame = { kind: ForceKind; team?: number; activity?: number; by: string; at: string };
/** settings.forcedGames: season → game id → the forced result. */
export type ForcedGames = Record<string, Record<string, ForcedGame>>;

const KIND_LABEL: Record<ForceKind, string> = { win: "Force Win", loss: "Force Loss", sim: "Force Sim" };
const slugName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function forcedFor(settings: Record<string, unknown> | null | undefined, year: number): Record<string, ForcedGame> {
  return ((settings?.forcedGames as ForcedGames | undefined) || {})[String(year)] || {};
}

/** "eagles-at-saints", plus "-force-win-eagles" / "-force-loss-saints" / "-force-sim" when forced. */
export function channelNameFor(a: Team, h: Team, f?: { kind: ForceKind; team?: number }): string {
  const base = slugName(`${a.name}-at-${h.name}`);
  if (!f) return base.slice(0, 100);
  const who = f.team === a.id ? a : f.team === h.id ? h : undefined;
  return `${base}-force-${f.kind}${f.kind !== "sim" && who ? `-${slugName(who.name)}` : ""}`.slice(0, 100);
}

export function describeForce(d: LeagueData, f: { kind: ForceKind; team?: number; activity?: number }): string {
  const t = d.teams.find((x) => x.id === f.team);
  const act = f.activity != null ? d.teams.find((x) => x.id === f.activity) : undefined;
  return `${f.kind === "sim" ? "Force Sim" : `${KIND_LABEL[f.kind]}: ${t ? `${t.city} ${t.name}` : "?"}`}${act ? ` (activity: ${act.abbr})` : ""}`;
}

const teamOf = (d: LeagueData, id: number) => d.teams.find((t) => t.id === id);

type Pick = { g: Game; channelId: string | null; category: string };
/** The games /set can pick: every game with a channel in the game channel categories (any week built
 *  with /gamechannels, newest week first). Only if there are none, this week's games without channels.
 *  (Nick, 2026-11-19: it showed nothing when the league had moved past the current week's games.) */
function candidates(lg: LinkedLeague, d: LeagueData): Pick[] {
  const byId = new Map(d.games.map((g) => [String(g.id), g]));
  const weeks = Object.entries(readGameChannels(lg.settings?.gameChannels).weeks)
    .sort(([a], [b]) => b.localeCompare(a, undefined, { numeric: true }));
  const out: Pick[] = [];
  for (const [key, wk] of weeks) {
    for (const [id, gc] of Object.entries(wk.games)) {
      const g = byId.get(id);
      if (g && g.home && g.away) out.push({ g, channelId: gc.channelId, category: wk.name || `${key.split(":")[0]} - ${weekTitle(d, g.stage, g.week)}` });
    }
  }
  if (out.length) return out;
  return d.games.filter((g) => g.stage === 1 && g.stage === d.season.stage && g.week === d.season.week && g.home && g.away)
    .map((g) => ({ g, channelId: null, category: `${d.season.year} - ${weekTitle(d, g.stage, g.week)}` }));
}

/** Autocomplete for /set: `game` lists this week's games (only forced ones for remove); `team` the picked game's two teams. */
export function setChoices(lg: LinkedLeague, d: LeagueData, sub: string | undefined, focused: string, q: string, gameValue: unknown): { name: string; value: string }[] {
  const forced = forcedFor(lg.settings, d.season.year);
  const n = norm(q);
  if (focused === "team" || focused === "activity") {
    const g = d.games.find((x) => String(x.id) === String(gameValue ?? ""));
    if (!g) return [];
    return [g.away, g.home].map((id) => teamOf(d, id)).filter((t): t is Team => Boolean(t))
      .filter((t) => !n || norm(`${t.city} ${t.name} ${t.abbr}`).includes(n))
      .map((t) => ({ name: `${t.city} ${t.name} (${t.abbr})`, value: t.abbr }));
  }
  return candidates(lg, d)
    .filter(({ g }) => sub !== "remove" || forced[String(g.id)])
    .map(({ g, channelId, category }) => {
      const a = teamOf(d, g.away)!, h = teamOf(d, g.home)!;
      const f = forced[String(g.id)];
      const ch = channelId ? `#${channelNameFor(a, h, f)}` : `${a.name} at ${h.name} (no channel)`;
      return { name: `${category} · ${ch}${f ? ` · ${describeForce(d, f)}` : ""}`.slice(0, 100), value: String(g.id), key: `${a.city} ${a.name} ${a.abbr} ${h.city} ${h.name} ${h.abbr}` };
    })
    .filter((x) => !n || norm(x.key + x.name).includes(n))
    .slice(0, 25)
    .map(({ name, value }) => ({ name, value }));
}

/** One rename attempt. Discord allows about 2 renames per channel every 10 minutes; on that limit, say so
 *  instead of waiting it out (running /set again later renames it). */
async function rename(channelId: string, name: string): Promise<"ok" | "same" | "limited" | "gone" | "failed"> {
  const cur = await dc("GET", `/channels/${channelId}`);
  if (!cur.ok) return cur.status === 404 || cur.status === 403 ? "gone" : "failed";
  if (cur.data.name === name) return "same";
  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
    method: "PATCH",
    headers: { authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, "content-type": "application/json", "x-audit-log-reason": "/set" },
    body: JSON.stringify({ name }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res) return "failed";
  if (res.status === 429) return "limited";
  return res.ok ? "ok" : "failed";
}

const renameNote = (r: Awaited<ReturnType<typeof rename>>, ch: string, name: string) =>
  r === "ok" ? ` Renamed <#${ch}> to **${name}**.`
    : r === "same" ? ""
      : r === "limited" ? ` Discord only lets a channel be renamed twice every 10 minutes, so <#${ch}> keeps its old name for now; run the same /set again in a few minutes to rename it.`
        : r === "gone" ? " Its game channel is gone, so nothing was renamed."
          : ` Couldn't rename <#${ch}> (Discord error); run the same /set again in a minute.`;

/** Void the forced game's bets right away instead of waiting for the next sync. */
async function settleNow(lg: LinkedLeague): Promise<void> {
  forgetLeagueData(lg.slug);
  const d = await getLeagueData(lg.slug);
  if (!d) return;
  const cfg = await ticketsConfig(lg.slug).catch(() => null);
  await settleFinished(lg.id, bookKey(d.season.year, Boolean(cfg)), d, marketBook(d), Boolean(cfg)).catch((e) => console.error("settle after /set", (e as Error).message));
}

async function saveForced(lg: LinkedLeague, year: number, gameId: number, f: ForcedGame | null) {
  await updateLeagueSettings(lg.id, (settings) => {
    const all = { ...((settings.forcedGames as ForcedGames | undefined) || {}) };
    const yr = { ...(all[String(year)] || {}) };
    if (f) yr[String(gameId)] = f; else delete yr[String(gameId)];
    if (Object.keys(yr).length) all[String(year)] = yr; else delete all[String(year)];
    if (Object.keys(all).length) settings.forcedGames = all; else delete settings.forcedGames;
    return settings;
  });
  forgetLeagueData(lg.slug);
}

export async function setForce(lg: LinkedLeague, d: LeagueData, a: { game: unknown; kind: unknown; team: unknown; activity?: unknown; by: string }): Promise<string> {
  const pick = candidates(lg, d).find((x) => String(x.g.id) === String(a.game ?? ""));
  if (!pick) return "Pick a game from the list (it shows the games in your game channel categories; build one with /gamechannels).";
  const g = pick.g;
  const kind = String(a.kind ?? "") as ForceKind;
  if (!(kind in KIND_LABEL)) return "Pick Force Win, Force Loss or Force Sim.";
  const away = teamOf(d, g.away)!, home = teamOf(d, g.home)!;
  let team: Team | undefined;
  if (kind !== "sim") {
    const tv = norm(String(a.team ?? ""));
    if (!tv) return `${KIND_LABEL[kind]} needs a team: pick ${away.name} or ${home.name} in the team box.`;
    team = [away, home].find((t) => [t.abbr, t.name, `${t.city} ${t.name}`].some((x) => norm(x) === tv));
    if (!team) return `Pick ${away.name} or ${home.name}; they're the two teams in that game.`;
  }
  const pickTeam = (v: unknown) => { const n = norm(String(v ?? "")); return n ? [away, home].find((t) => [t.abbr, t.name, `${t.city} ${t.name}`].some((x) => norm(x) === n)) : undefined; };
  let act: Team | undefined;
  if (String(a.activity ?? "").trim()) {
    act = pickTeam(a.activity);
    if (!act) return `For activity, pick ${away.name} or ${home.name}; they're the two teams in that game.`;
  }
  const f: ForcedGame = { kind, team: team?.id, ...(act ? { activity: act.id } : {}), by: a.by, at: new Date().toISOString() };
  const label = describeForce(d, f);
  const prev = forcedFor(lg.settings, d.season.year)[String(g.id)];
  await saveForced(lg, d.season.year, g.id, f);

  let note = " This game has no channel yet (/gamechannels).";
  const ch = pick.channelId;
  if (ch) {
    const name = channelNameFor(away, home, f);
    note = renameNote(await rename(ch, name), ch, name);
    if (!prev || prev.kind !== f.kind || prev.team !== f.team || prev.activity !== f.activity) {
      const actLine = act ? ` It counts as a game played for **${act.city} ${act.name}**${act.user ? ` (${act.user})` : ""} for activity.` : "";
      await dc("POST", `/channels/${ch}/messages`, { content: `⚖️ An admin set **${label}** on this game. It's marked simmed on the site, so it doesn't count for bets (stakes come back) or audits.${actLine}`, allowed_mentions: { parse: [] } });
    }
  }
  await settleNow(lg);
  return `**${label}** set on ${d.season.year} ${weekTitle(d, g.stage, g.week)}: ${away.abbr} @ ${home.abbr}. It's marked simmed on the site: its bets are voided (stakes back) and /audit leaves it out.${act ? ` Activity: counts as a game played for ${act.abbr}${act.user ? ` (${act.user})` : ""}.` : ""}${note} Undo with \`/set remove\`.`;
}

export async function removeForce(lg: LinkedLeague, d: LeagueData, a: { game: unknown }): Promise<string> {
  const forced = forcedFor(lg.settings, d.season.year);
  const g = d.games.find((x) => String(x.id) === String(a.game ?? ""));
  const f = g ? forced[String(g.id)] : undefined;
  if (!g || !f) {
    const list = Object.keys(forced).map((id) => d.games.find((x) => String(x.id) === id)).filter((x): x is Game => Boolean(x))
      .map((x) => `${teamOf(d, x.away)?.abbr} @ ${teamOf(d, x.home)?.abbr} (${describeForce(d, forced[String(x.id)])})`);
    return `That game doesn't have a forced result.${list.length ? ` Forced this season: ${list.join(", ")}.` : ""}`;
  }
  const away = teamOf(d, g.away)!, home = teamOf(d, g.home)!;
  await saveForced(lg, d.season.year, g.id, null);
  let note = "";
  const ch = candidates(lg, d).find((x) => x.g.id === g.id)?.channelId || null;
  if (ch) {
    const name = channelNameFor(away, home);
    note = renameNote(await rename(ch, name), ch, name);
    await dc("POST", `/channels/${ch}/messages`, { content: `↩️ An admin removed the **${describeForce(d, f)}** on this game.`, allowed_mentions: { parse: [] } });
  }
  return `Removed **${describeForce(d, f)}** from ${away.abbr} @ ${home.abbr}. The game counts normally again (simmed or played as EA reports it).${note} Bets already voided by the force stay refunded; new bets can be placed if the game is still open.`;
}
