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
import { activityAfterForce, activityTeams } from "./activity";

// "dc" (/set disconnect, Nick 2026-11-19): the game disconnected and the users won't replay it, so both
// get a game played even if it sims. Its bets are voided like a force's (Nick: "Disconnects should also void
// bets"); the result shown is EA's, and it isn't marked simmed by the bot.
export type ForceKind = "win" | "loss" | "sim" | "dc";
export type ForcedGame = { kind: ForceKind; team?: number; activity?: number | number[]; by: string; at: string };
/** settings.forcedGames: season → game id → the forced result. */
export type ForcedGames = Record<string, Record<string, ForcedGame>>;

const KIND_LABEL: Record<ForceKind, string> = { win: "Force Win", loss: "Force Loss", sim: "Force Sim", dc: "Disconnect" };
const slugName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function forcedFor(settings: Record<string, unknown> | null | undefined, year: number): Record<string, ForcedGame> {
  return ((settings?.forcedGames as ForcedGames | undefined) || {})[String(year)] || {};
}

/** "eagles-at-saints", plus "-force-win-eagles" / "-force-loss-saints" / "-force-sim" when forced. */
export function channelNameFor(a: Team, h: Team, f?: { kind: ForceKind; team?: number }): string {
  const base = slugName(`${a.name}-at-${h.name}`);
  if (!f) return base.slice(0, 100);
  if (f.kind === "dc") return `${base}-disconnect`.slice(0, 100);
  const who = f.team === a.id ? a : f.team === h.id ? h : undefined;
  return `${base}-force-${f.kind}${f.kind !== "sim" && who ? `-${slugName(who.name)}` : ""}`.slice(0, 100);
}

export function describeForce(d: LeagueData, f: { kind: ForceKind; team?: number; activity?: number | number[] }): string {
  if (f.kind === "dc") return "Disconnect (both users played)";
  const t = d.teams.find((x) => x.id === f.team);
  const act = activityTeams(f).map((id) => d.teams.find((x) => x.id === id)?.abbr ?? "?");
  return `${f.kind === "sim" ? "Force Sim" : `${KIND_LABEL[f.kind]}: ${t ? `${t.city} ${t.name}` : "?"}`}${act.length ? ` (activity: ${act.join(" + ")})` : ""}`;
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
      if (g && g.home && g.away) out.push({ g, channelId: gc.closedAt ? null : gc.channelId, category: wk.name || `${key.split(":")[0]} - ${weekTitle(d, g.stage, g.week)}` });
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
    const two = [g.away, g.home].map((id) => teamOf(d, id)).filter((t): t is Team => Boolean(t))
      .map((t) => ({ name: `${t.city} ${t.name} (${t.abbr})${focused === "activity" ? ` · ${t.user || "CPU"}` : ""}`, value: t.abbr }));
    // activity: "Both teams" too, e.g. a game both users played that EA didn't report before the advance
    const all = focused === "activity" ? [...two, { name: "Both teams (both users played)", value: "both" }] : two;
    return all.filter((x) => !n || norm(x.name).includes(n));
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

/** The `game` box for /set, without loading the league data file (Nick, 2026-11-20: the Week 1 game channels
 *  didn't show up). Discord gives autocomplete 3 seconds and a cold data load can take longer, which left the
 *  list empty. This reads only the saved game channel categories and the server's channel names (one Discord
 *  call), so it answers fast and lists every channel that exists. setForce still checks the pick against the
 *  league data when the command runs. */
export async function setGameChoicesFast(lg: LinkedLeague, sub: string | undefined, q: string): Promise<{ name: string; value: string }[] | null> {
  const weeks = Object.entries(readGameChannels(lg.settings?.gameChannels).weeks)
    .sort(([a], [b]) => b.localeCompare(a, undefined, { numeric: true }));
  if (!weeks.length) return null; // no categories: the slow path offers this week's games
  const guildId = (lg.settings?.discord as { guildId?: string } | undefined)?.guildId;
  const names = new Map<string, string>();
  if (guildId) {
    const r = await dc("GET", `/guilds/${guildId}/channels`).catch(() => null);
    if (r?.ok && Array.isArray(r.data)) for (const c of r.data as unknown as { id: string; name: string }[]) names.set(String(c.id), c.name);
  }
  const n = norm(q);
  const out: { name: string; value: string }[] = [];
  for (const [key, wk] of weeks) {
    const forced = forcedFor(lg.settings, Number(key.split(":")[0]));
    for (const [id, gc] of Object.entries(wk.games)) {
      if (sub === "remove" && !forced[id]) continue;
      // closed 12 hours after its box score (gameFinals.ts): still pickable, e.g. to credit activity
      if (gc.closedAt) {
        const label = `${wk.name || key} · ${gc.closedName ? `#${gc.closedName}` : `game ${id}`} (closed)`.slice(0, 100);
        if (!n || norm(label).includes(n)) out.push({ name: label, value: id });
        continue;
      }
      if (names.size && !names.has(gc.channelId)) continue; // channel was deleted in Discord
      const ch = names.get(gc.channelId);
      const label = `${wk.name || key} · ${ch ? `#${ch}` : `game ${id}`}`.slice(0, 100);
      if (n && !norm(label).includes(n)) continue;
      out.push({ name: label, value: id });
    }
  }
  return out.slice(0, 25);
}

/** One rename attempt. Discord allows about 2 renames per channel every 10 minutes; on that limit, say so
 *  instead of waiting it out (running /set again later renames it). */
export async function rename(channelId: string, name: string, reason = "/set"): Promise<"ok" | "same" | "limited" | "gone" | "failed"> {
  const cur = await dc("GET", `/channels/${channelId}`);
  if (!cur.ok) return cur.status === 404 || cur.status === 403 ? "gone" : "failed";
  if (cur.data.name === name) return "same";
  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
    method: "PATCH",
    headers: { authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, "content-type": "application/json", "x-audit-log-reason": reason },
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
  if (kind === "dc") return setDisconnect(lg, d, pick, a.by);
  const away = teamOf(d, g.away)!, home = teamOf(d, g.home)!;
  let team: Team | undefined;
  if (kind !== "sim") {
    const tv = norm(String(a.team ?? ""));
    if (!tv) return `${KIND_LABEL[kind]} needs a team: pick ${away.name} or ${home.name} in the team box.`;
    team = [away, home].find((t) => [t.abbr, t.name, `${t.city} ${t.name}`].some((x) => norm(x) === tv));
    if (!team) return `Pick ${away.name} or ${home.name}; they're the two teams in that game.`;
  }
  const pickTeam = (v: unknown) => { const n = norm(String(v ?? "")); return n ? [away, home].find((t) => [t.abbr, t.name, `${t.city} ${t.name}`].some((x) => norm(x) === n)) : undefined; };
  let acts: Team[] = [];
  const av = String(a.activity ?? "").trim();
  if (av) {
    if (norm(av) === "both") acts = [away, home];
    else {
      const one = pickTeam(a.activity);
      if (!one) return `For activity, pick ${away.name}, ${home.name} or Both teams.`;
      acts = [one];
    }
  }
  const f: ForcedGame = { kind, team: team?.id, ...(acts.length ? { activity: acts.length === 1 ? acts[0].id : acts.map((t) => t.id) } : {}), by: a.by, at: new Date().toISOString() };
  const label = describeForce(d, f);
  const prev = forcedFor(lg.settings, d.season.year)[String(g.id)];
  await saveForced(lg, d.season.year, g.id, f);

  let note = " This game has no open channel (not made yet, or closed after its box score).";
  const ch = pick.channelId;
  if (ch) {
    const name = channelNameFor(away, home, f);
    note = renameNote(await rename(ch, name), ch, name);
    if (!prev || prev.kind !== f.kind || prev.team !== f.team || JSON.stringify(prev.activity) !== JSON.stringify(f.activity)) {
      const actLine = acts.length ? ` For activity it counts as a game played for ${acts.map((t) => `**${t.city} ${t.name}**${t.user ? ` (${t.user})` : ""}`).join(" and ")}.` : "";
      await dc("POST", `/channels/${ch}/messages`, { content: `⚖️ An admin set **${label}** on this game. It's marked simmed on the site, so it doesn't count for bets (stakes come back) or audits.${actLine}`, allowed_mentions: { parse: [] } });
    }
  }
  await settleNow(lg);
  return `**${label}** set on ${d.season.year} ${weekTitle(d, g.stage, g.week)}: ${away.abbr} @ ${home.abbr}. It's marked simmed on the site: its bets are voided (stakes back) and /audit leaves it out.${acts.length ? ` Activity: a game played for ${acts.map((t) => `${t.abbr}${t.user ? ` (${t.user})` : ""}`).join(" and ")}.` : ""}${note}${await activityAfterForce(lg.slug, g.id)} Undo with \`/set remove\`.`;
}

/** /set disconnect: both users get a game played; the result stands as EA reports it. Replaces a force on the game. */
async function setDisconnect(lg: LinkedLeague, d: LeagueData, pick: Pick, by: string): Promise<string> {
  const g = pick.g;
  const away = teamOf(d, g.away)!, home = teamOf(d, g.home)!;
  const f: ForcedGame = { kind: "dc", by, at: new Date().toISOString() };
  const prev = forcedFor(lg.settings, d.season.year)[String(g.id)];
  await saveForced(lg, d.season.year, g.id, f);
  const users = [away, home].filter((t) => t.user);
  let note = " This game has no open channel (not made yet, or closed after its box score).";
  if (pick.channelId) {
    const name = channelNameFor(away, home, f);
    note = renameNote(await rename(pick.channelId, name), pick.channelId, name);
    if (prev?.kind !== "dc") {
      await dc("POST", `/channels/${pick.channelId}/messages`, { content: `🔌 An admin marked this game as a **disconnect**: it won't be replayed, so ${users.length ? users.map((t) => `**${t.user}** (${t.abbr})`).join(" and ") : "both users"} get credit for playing it, even if it sims. Bets on it are voided (stakes come back).${prev ? ` (Replaces the ${describeForce(d, prev)}.)` : ""}`, allowed_mentions: { parse: [] } });
    }
  }
  await settleNow(lg); // void its bets right away
  return `**Disconnect** set on ${d.season.year} ${weekTitle(d, g.stage, g.week)}: ${away.abbr} @ ${home.abbr}. Both users get a game played for activity, even if it sims, and its bets are voided (stakes back).${prev && prev.kind !== "dc" ? ` Replaced the ${describeForce(d, prev)}.` : ""}${note}${await activityAfterForce(lg.slug, g.id)} Undo with \`/set remove\`.`;
}

export async function removeForce(lg: LinkedLeague, d: LeagueData, a: { game: unknown }): Promise<string> {
  const forced = forcedFor(lg.settings, d.season.year);
  const g = d.games.find((x) => String(x.id) === String(a.game ?? ""));
  const f = g ? forced[String(g.id)] : undefined;
  if (!g || !f) {
    const list = Object.keys(forced).map((id) => d.games.find((x) => String(x.id) === id)).filter((x): x is Game => Boolean(x))
      .map((x) => `${teamOf(d, x.away)?.abbr} @ ${teamOf(d, x.home)?.abbr} (${describeForce(d, forced[String(x.id)])})`);
    return `That game doesn't have a force or disconnect.${list.length ? ` Forced this season: ${list.join(", ")}.` : ""}`;
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
  return `Removed **${describeForce(d, f)}** from ${away.abbr} @ ${home.abbr}. The game counts normally again (simmed or played as EA reports it).${note} Bets already voided stay refunded; new bets can be placed if the game is still open.${await activityAfterForce(lg.slug, g.id)}`;
}
