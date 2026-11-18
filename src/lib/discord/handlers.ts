// What each slash command answers. Everything reads the same league data file
// and helpers the website uses, so the bot and the site always agree.
import { getLeagueDataWithNicknames as getLeagueData } from "@/lib/nicknameStore";
import { getLeagueHistory } from "@/lib/league/load";
import type { LeagueData, Player, Team } from "@/lib/league/types";
import { DEV_LABEL } from "@/lib/league/types";
import {
  capSeason,
  capYears, fullName, gamesForWeek, inferredDeadCap, record, seasonTotals, standings, streakText,
  teamCapProjection, teamPlayers, weekTitle, defaultScoresWeek,
} from "@/lib/league/derive";
import { money } from "@/lib/league/format";
import { projectPlayer } from "@/lib/league/projection";
import { playoffPicture, recText } from "@/lib/league/playoffs";
import { askCapHits, recommend, type MarketPlayer } from "@/lib/league/recommend";
import { standInArt } from "@/lib/league/headshots";
import { cardImageUrl, matchupImageUrl, packImageUrl, statsImageUrl } from "./cardLink";
import { ODDS, PACK_SIZE, RARITY, cardPoints, luckLabel, openPack, packHits, recordTopPack } from "./packs";
import { loadPackStats, savePackStats } from "./packStore";
import { DISCORD_POS_GROUPS, findSortRating, groupStarters, sortRatingChoices, sortValue, type DiscordPosGroup, type PlayerSort } from "./posGroups";
import { STAT_CATS, statLeaders, type StatCat } from "./stats";
import { pickFact, playerFacts, remember, teamFacts } from "./funfacts";
import { mergeQuips, resolveQuips, type QuipMemory } from "./factFormat";
import { randomInt } from "node:crypto";
import { currentGame, edges, gameInWeek, gameLeaders, gameTable, sideTable, teamStats, weekIndex } from "./matchup";
import { ALERT_EVENTS, BRAND, EPHEMERAL, MAX_VIDEO_BYTES, appOwnerIds, hexColor, postToChannel, type AlertEvent, type Embed, type Message } from "./api";
import { supabaseAdmin } from "@/lib/supabase/server";
import { betCaps, cancelValue, closeTimes, economyOf, isFutures, isMember, fmtET, kickoffPermission, marketsForDiscord, marketsShared, memberNames, setCloseTime, teamsOfUser, ticketsAvailable, verifyKickoff } from "@/lib/marketStore";
import { marketBook, withAwardPlayers } from "@/lib/league/markets";
import { kickoffProblem, parseKickoff, parseKickoffPast, teamGameThisWeek, TIMEZONES } from "@/lib/kickoff";
import { bookKey, discordOfUser, makeLinkToken, ticketsConfig, userForDiscord } from "@/lib/tickets";
import { postPayoutsNow, rebuildMarketChannels, refreshGame, syncMarketChannels } from "./marketChannels";
import { isLeagueAdmin, NOT_ADMIN } from "./admin";
import { AUDIT_KINDS, auditMessage, runAudit, type AuditKind } from "./audit";
import { auditChannelsCmd, postAudit } from "./auditChannels";
import { updateLeagueSettings } from "@/lib/leagueSettings";
import { removeGameChannels, syncGameChannels } from "./gameChannels";
import { tradeChannelsCmd } from "./tradeChannels";
import { txChannelsCmd } from "./txChannels";
import { packChannelProblem, packChannelsCmd } from "./packChannels";
import { tradeBuilderStart } from "./tradeBuilder";
import { blockStateOf, setManualBlock, tradeBlockEmbed } from "./tradeBlock";
import { MANUAL_COOLDOWN_MS, requestSync } from "@/lib/sync";
import { supabaseAdmin as admin2 } from "@/lib/supabase/server";
import { clearMarketChannels, discordOf, leagueBySlug, leagueForGuild, leagueForUser, leaguesForDiscordUser, setDiscord, setUserLeague, type LinkedLeague } from "./links";

/** How many players/teams /funfact remembers recent facts for, per league. */
const FUNFACT_SUBJECTS = 80;

export type Option = { name: string; type: number; value?: string | number | boolean; focused?: boolean; options?: Option[] };
export type Interaction = {
  type: number;
  id: string;
  application_id: string;
  token: string;
  guild_id?: string;
  member?: { user: { id: string; username: string; global_name?: string | null }; permissions?: string; roles?: string[] };
  user?: { id: string; username: string; global_name?: string | null };   // set instead of member in DMs
  context?: number;                           // 0 server, 1 bot DM, 2 group DM / other DM
  channel_id?: string;
  channel?: { id: string; type: number; parent_id?: string | null };
  forced?: LinkedLeague;                      // set by /league: run the command for this league instead
  data?: { name: string; options?: Option[]; resolved?: { attachments?: Record<string, { url: string; filename: string; size: number; content_type?: string }> } };
};

const userId = (i: Interaction) => i.member?.user.id || i.user?.id || "";

/** The server's league if this server is linked, otherwise the person's own league (/myleague). */
async function resolveLeague(i: Interaction): Promise<{ lg: LinkedLeague; via: "server" | "user" } | null> {
  if (i.forced) return { lg: i.forced, via: "user" };
  if (i.guild_id) {
    const lg = await leagueForGuild(i.guild_id);
    if (lg) return { lg, via: "server" };
  }
  const uid = userId(i);
  const lg = uid ? await leagueForUser(uid) : null;
  return lg ? { lg, via: "user" } : null;
}

/** /audit has subcommands: their options sit one level down. Lift them up and keep the subcommand's name. */
function flattenSub(i: Interaction): Interaction & { sub?: string } {
  const s = i.data?.options?.[0];
  if (!i.data || s?.type !== 1) return i;
  return { ...i, sub: s.name, data: { ...i.data, options: s.options || [] } };
}

const opt = (i: Interaction, name: string) => i.data?.options?.find((o) => o.name === name)?.value;
const reply = (text: string, ephemeral = true): Message => ({ content: text, flags: ephemeral ? EPHEMERAL : undefined });
const MANAGE_SERVER = BigInt(1 << 5), ADMIN = BigInt(1 << 3);
const canManage = (i: Interaction) => {
  const p = BigInt(i.member?.permissions || "0");
  return (p & MANAGE_SERVER) !== BigInt(0) || (p & ADMIN) !== BigInt(0);
};

// ---------- lookups ----------

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, "").trim();

function searchPlayers(d: LeagueData, q: string, limit = 25): Player[] {
  const n = norm(q);
  const live = d.players.filter((p) => !p.gone);
  if (!n) return [...live].sort((a, b) => b.ovr - a.ovr).slice(0, limit);
  const scored = live.flatMap((p) => {
    const full = norm(`${p.first} ${p.last}`), last = norm(p.last), nick = p.nick ? norm(p.nick) : "";
    const s = full === n || (nick && nick === n) ? 0 : last === n ? 1 : full.startsWith(n) || (nick && nick.startsWith(n)) ? 2 : last.startsWith(n) ? 3 : full.includes(n) || (nick && nick.includes(n)) ? 4 : -1;
    return s < 0 ? [] : [{ p, s }];
  });
  return scored.sort((a, b) => a.s - b.s || b.p.ovr - a.p.ovr).slice(0, limit).map((x) => x.p);
}

function findPlayer(d: LeagueData, value: unknown): Player | undefined {
  const s = String(value ?? "");
  if (/^\d+$/.test(s)) {
    const byId = d.players.find((p) => String(p.id) === s);
    if (byId) return byId;
  }
  return searchPlayers(d, s, 1)[0];
}

function findTeam(d: LeagueData, value: unknown): Team | undefined {
  const n = norm(String(value ?? ""));
  if (!n) return undefined;
  return d.teams.find((t) => String(t.id) === n)
    || d.teams.find((t) => norm(t.abbr) === n || norm(t.name) === n || norm(t.city) === n || norm(`${t.city} ${t.name}`) === n)
    || d.teams.find((t) => norm(`${t.city} ${t.name} ${t.abbr}`).includes(n));
}

const teamOf = (d: LeagueData, id: number) => d.teams.find((t) => t.id === id);
const teamLabel = (t: Team | undefined) => (t ? `${t.city} ${t.name}` : "Free agent");

// ---------- /league: the same commands for any league you're in ----------

const LEAGUE_PICK_CMDS = new Set(["player", "contract", "cap", "team", "players", "rookie", "expiring", "tws", "stats", "funfact", "standings", "playoffs", "scores", "pack", "packs", "sync", "info"]);
// Boxes that are a command themselves, and which plain-command option their value becomes.
const BOX_CMDS: [box: string, cmd: string, as: string][] = [["tws", "tws", "team"], ["stats", "stats", "category"], ["cap", "cap", "team"], ["contract", "contract", "player"], ["player", "player", "player"], ["team", "team", "team"]];
// Which helper boxes each command also reads.
const EXTRA: Record<string, string[]> = { players: ["group", "rating", "order"], tws: ["week"], stats: ["team"], cap: ["year"], scores: ["week"], rookie: ["team", "year"], expiring: ["team"], funfact: ["player", "team"] };

/**
 * /league league:<slug> <box>:<value> …  →  the plain command with its own options, plus the picked league.
 * The "more" box wins, then tws, stats, cap, contract, player, team; nothing filled shows the league's info.
 */
function unwrapLeague(i: Interaction): { cmd: string; pick: string; focused?: string; inner: Interaction } | null {
  if (i.data?.name !== "league") return null;
  const opts = (i.data.options || []).filter((o) => o.value !== "" && o.value != null || o.focused);
  const get = (n: string) => opts.find((o) => o.name === n);
  const pick = String(get("league")?.value ?? "").trim();
  if (i.type === 4) {
    // Autocomplete: tws/cap list teams, contract lists players, all from the picked league.
    const f = opts.find((o) => o.focused);
    const as = BOX_CMDS.find(([box]) => box === f?.name)?.[2] || f?.name || "";
    const inner = f ? [{ ...f, name: as }] : [];
    return { cmd: "", pick, focused: f?.name, inner: { ...i, data: { ...i.data, name: "league", options: inner } } };
  }
  const more = String(get("more")?.value ?? "");
  const box = more ? undefined : BOX_CMDS.find(([b]) => get(b));
  // The team box plus the group, rating or order box = that team's players (/players).
  // The group, rating or order box alone = league-wide /players.
  const listing = get("group") || get("rating") || get("order");
  const cmd = more || ((!box || box[0] === "team") && listing ? "players" : box?.[1]) || "info";
  const own = box ? [{ ...get(box[0])!, name: box[2] }] : [];
  const extra = opts.filter((o) => (EXTRA[cmd] || []).includes(o.name) && !own.some((x) => x.name === o.name));
  return { cmd, pick, inner: { ...i, data: { ...i.data, name: cmd, options: [...own, ...extra] } } };
}

const slugOf = (raw: string) => raw.toLowerCase().replace(/^.*\/l\//, "").replace(/[/?#].*$/, "").trim();

/** The picked league, if it's one of this person's leagues (by slug or name). */
async function pickedLeague(i: Interaction, pick: string): Promise<{ lg?: LinkedLeague; mine: LinkedLeague[]; connected: boolean }> {
  const { leagues: mine, connected } = await leaguesForDiscordUser(userId(i), i.guild_id);
  const n = slugOf(pick);
  const lg = n ? mine.find((l) => l.slug === n) || mine.find((l) => norm(l.name) === norm(pick)) : undefined;
  return { lg, mine, connected };
}

// ---------- autocomplete ----------

export async function autocomplete(i: Interaction): Promise<{ name: string; value: string }[]> {
  i = flattenSub(i);
  // The rating box (/players, /league): the same list for every league, no league needed.
  const fr = i.data?.options?.find((o) => o.focused);
  if (fr?.name === "rating") return sortRatingChoices(String(fr.value ?? ""));
  const w = unwrapLeague(i);
  if (w) {
    if (w.focused === "league") {
      // The league picker: every league this person is in, the one this server is linked to marked.
      const { leagues } = await leaguesForDiscordUser(userId(i), i.guild_id);
      const n = norm(w.pick);
      return leagues
        .filter((l) => !n || norm(`${l.name} ${l.slug}`).includes(n))
        .slice(0, 25)
        .map((l) => ({ name: `${l.name} (${l.slug})${l.why === "server" ? " · this server" : ""}`.slice(0, 100), value: l.slug }));
    }
    // Player/team names come from the picked league (nothing until one is picked).
    const { lg } = w.pick ? await pickedLeague(i, w.pick) : { lg: undefined };
    return lg ? autocomplete({ ...w.inner, forced: lg }) : [];
  }
  const lg = (await resolveLeague(i))?.lg;
  if (!lg) return [];
  const d = await getLeagueData(lg.slug);
  if (!d) return [];
  const focused = i.data?.options?.find((o) => o.focused);
  const q = String(focused?.value ?? "");
  if (focused?.name === "team") {
    const n = norm(q);
    return [...d.teams]
      .filter((t) => !n || norm(`${t.city} ${t.name} ${t.abbr}`).includes(n))
      .sort((a, b) => a.city.localeCompare(b.city))
      .slice(0, 25)
      .map((t) => ({ name: `${t.city} ${t.name} (${t.abbr})`, value: t.abbr }));
  }
  return searchPlayers(d, q).map((p) => ({
    name: `${fullName(p)} · ${p.pos} · ${p.ovr} OVR · ${teamOf(d, p.team)?.abbr || "FA"}`.slice(0, 100),
    value: String(p.id),
  }));
}

// ---------- commands ----------

export async function runCommand(i: Interaction, base: string): Promise<Message> {
  const w = unwrapLeague(i);
  if (w) {
    // /league league:<pick> command:<cmd> … (any league you're in, from any Discord)
    const { lg, mine, connected } = await pickedLeague(i, w.pick);
    if (!lg) {
      const list = mine.map((l) => `\`${l.slug}\` ${l.name}`).join("\n");
      return reply([
        w.pick ? `**${w.pick}** isn't one of your leagues.` : "Pick a league.",
        list ? `Your leagues:\n${list}` : "No leagues found for you.",
        connected ? "" : "Run `/connect` to link your Discord to your CFM Manager account, and every league you're in shows up here.",
      ].filter(Boolean).join("\n"));
    }
    if (!LEAGUE_PICK_CMDS.has(w.cmd)) return reply("Pick something from the list.");
    if (w.cmd === "scores" && Number(opt(w.inner, "week")) > 18) return reply("Scores go by regular-season week, 1 to 18.");
    i = { ...w.inner, forced: lg };
  }
  const name = i.data?.name || "";
  if (name === "myleague") return myLeague(i, base);
  if (name === "connect") {
    const who = i.member?.user || i.user;
    if (!who) return reply("Couldn't tell who you are.");
    const t = makeLinkToken(who.id, who.global_name || who.username);
    return reply(`Open this link while signed in to CFM Manager to link **${who.global_name || who.username}** (it works for 15 minutes, just for you):\n${base}/link-discord?t=${t}`);
  }
  const VIDEO_CMDS = ["alertvideo", "removealertvideo"];
  if (name === "link" || name === "unlink" || name === "notify" || VIDEO_CMDS.includes(name)) {
    if (!i.guild_id || i.context !== undefined && i.context !== 0) return reply("That command sets up a server. In DMs, use `/myleague` instead.");
    if (name === "link") return link(i, base);
    if (name === "unlink") return unlink(i);
  }

  const found = await resolveLeague(i);
  if (!found) {
    return reply(i.guild_id
      ? `No league set. Run \`/myleague league:<web address>\` to pick yours (the part after /l/ in ${base}/l/…), or a server admin can \`/link\` this server.`
      : `No league set. Run \`/myleague league:<web address>\` to pick yours (the part after /l/ in ${base}/l/…).`);
  }
  const { lg, via } = found;
  if (name === "notify" || VIDEO_CMDS.includes(name)) {
    if (via !== "server") return reply("Link this server first with `/link league:<web address>`.");
    return name === "notify" ? notify(i, lg) : alertVideo(i, lg);
  }

  if (name === "sync") return syncCmd(i, lg, base);

  const d = await getLeagueData(lg.slug);
  if (!d) return reply(`${lg.name} hasn't finished its first sync yet. Try again in a few minutes.`);
  const url = (path = "") => `${base}/l/${lg.slug}${path}`;
  const footer = { text: `${lg.name} · ${d.season.year} ${d.season.title}` };

  switch (name) {
    case "player": {
      const p = findPlayer(d, opt(i, "player"));
      if (!p) return reply("No player by that name. Pick one from the list as you type.");
      // The card says it all: front and back side by side, with a one-line caption.
      const t = teamOf(d, p.team);
      const flags = [p.ps && "practice squad", p.ir && "IR", p.injury > 0 && `injured ${p.injury} wk`].filter(Boolean).join(" · ");
      return { embeds: [{
        title: fullName(p), url: url(`/players/${p.id}`), color: hexColor(t?.primary), footer,
        description: `${p.pos} · ${teamLabel(t)} · ${p.ovr} OVR ${DEV_LABEL[p.dev]}${flags ? ` · ${flags}` : ""}`,
        image: { url: cardImageUrl(base, lg.slug, p.id, "both") },
      }] };
    }
    case "contract": {
      const p = findPlayer(d, opt(i, "player"));
      return p ? { embeds: [contractEmbed(d, p, url, footer)] } : reply("No player by that name. Pick one from the list as you type.");
    }
    case "cap": {
      const years = capYears(d);
      const y = Number(opt(i, "year")) || years[0];
      if (!years.includes(y)) return reply(`Pick a season from ${years[0]} to ${years[years.length - 1]}.`);
      const v = opt(i, "team");
      if (v != null && v !== "") {
        const t = findTeam(d, v);
        if (!t) return reply("No team by that name.");
        const { embed, over } = teamCapEmbed(d, t, url, footer, y);
        // Under water in the season shown: the league's over-the-cap video plays with it.
        const video = over ? discordOf(lg)?.videos?.overcap : undefined;
        return { embeds: [embed], video };
      }
      return { embeds: [leagueCapEmbed(d, url, footer, y)] };
    }
    case "team": {
      const t = findTeam(d, opt(i, "team"));
      return t ? { embeds: [teamEmbed(d, t, url, footer)] } : reply("No team by that name.");
    }
    case "players": {
      // Team optional: empty = every rostered player in the league (Nick, 2026-11-18).
      const tv = opt(i, "team");
      const t = tv != null && tv !== "" ? findTeam(d, tv) : undefined;
      if (tv != null && tv !== "" && !t) return reply("No team by that name.");
      const gv = String(opt(i, "group") ?? "");
      const g = gv ? DISCORD_POS_GROUPS.find((x) => x.key === gv) : undefined;
      if (gv && !g) return reply("Pick a position group (QB, RB, WR, TE, OL, DL, LB, DB, CB, S or K/P), or leave it empty for the whole roster.");
      const rv = String(opt(i, "rating") ?? ""), ov = String(opt(i, "order") ?? "");
      let sort: PlayerSort | undefined;
      if (rv || ov) {
        const r = findSortRating(rv);
        if (!r) return reply(`No rating called **${rv}**. Start typing in the rating box and pick one from the list.`);
        sort = { ...r, dir: ov === "asc" ? "asc" : "desc" };
      }
      if (!t) return { embeds: [leaguePlayersEmbed(d, g, url, footer, sort)] };
      return { embeds: [groupEmbed(d, t, g, url, footer, sort)] };
    }
    case "rookie": {
      const v = opt(i, "team");
      let t: Team | undefined;
      if (v != null && v !== "") {
        t = findTeam(d, v);
        if (!t) return reply("No team by that name.");
      }
      const y = Number(opt(i, "year")) || undefined;
      return { embeds: [rookiesEmbed(d, t, url, footer, y)] };
    }
    case "expiring": {
      const v = opt(i, "team");
      if (v == null || v === "") return reply("Pick a team: /expiring team:Eagles (or /league … more:Expiring contracts with the team box).");
      const t = findTeam(d, v);
      if (!t) return reply("No team by that name.");
      return { embeds: [expiringEmbed(d, t, url, footer)] };
    }
    case "tws": {
      const t = findTeam(d, opt(i, "team"));
      if (!t) return reply("No team by that name.");
      const w = Number(opt(i, "week")) || 0;
      return { embeds: [twsEmbed(d, t, url, footer, w || undefined, { base, slug: lg.slug })] };
    }
    case "marketchannels": {
      if (via !== "server") return reply("Run this in the league's own Discord server (linked with `/link`).");
      if (!(await isLeagueAdmin(i))) return reply(NOT_ADMIN);
      return reply(await rebuildMarketChannels(lg.slug));
    }
    case "marketupdate": {
      if (via !== "server") return reply("Run this in the league's own Discord server (linked with `/link`).");
      if (!(await isLeagueAdmin(i))) return reply(NOT_ADMIN);
      const st = lg.settings?.marketChannels as { categoryId?: string } | undefined;
      if (!st?.categoryId) return reply("Set up the Markets category first with /marketchannels.");
      return reply(await syncMarketChannels(lg.slug));
    }
    case "gamechannels": {
      if (via !== "server") return reply("Run this in the league's own Discord server (linked with `/link`).");
      if (!(await isLeagueAdmin(i))) return reply(NOT_ADMIN);
      if (opt(i, "action") === "remove") return reply(await removeGameChannels(lg.slug));
      return reply(await syncGameChannels(lg.slug, { year: Number(opt(i, "year")) || undefined, week: Number(opt(i, "week")) || undefined }));
    }
    case "trade": {
      if (via !== "server") return reply("Run /trade in the league's own Discord server (linked with `/link`).");
      return { ...(await tradeBuilderStart(lg)), flags: EPHEMERAL };
    }
    case "tradeblock": return tradeBlockCmd(i, lg, d, footer);
    case "auditchannels": {
      if (via !== "server") return reply("Run this in the league's own Discord server (linked with `/link`).");
      if (!(await isLeagueAdmin(i))) return reply(NOT_ADMIN);
      return reply(await auditChannelsCmd(lg.slug, opt(i, "action") === "remove"));
    }
    case "audit": {
      // Anyone can run it; the results go to the matching channel in the Audits category for everyone to see.
      if (via !== "server") return reply("Run this in the league's own Discord server (linked with `/link`).");
      const f = flattenSub(i);
      const kind = f.sub as AuditKind;
      if (!(kind in AUDIT_KINDS)) return reply("Pick abilities, games or players.");
      const tv = opt(f, "team");
      let t: Team | undefined;
      if (tv != null && tv !== "") {
        t = findTeam(d, tv);
        if (!t) return reply("No team by that name.");
      }
      const h = kind === "players" ? await getLeagueHistory(lg.slug).catch(() => null) : null;
      const r = runAudit(kind, d, h, lg.settings, t?.id);
      const msg = auditMessage(kind, r, d, { url, footer, team: t ? `${t.city} ${t.name}` : undefined });
      const posted = await postAudit(lg, kind, msg, `<@${userId(i)}>`);
      if ("error" in posted) return { ...msg, content: `Couldn't post in the Audits category (${posted.error}), so here are the results:`, flags: undefined };
      const v = r.findings.filter((x) => x.severity === "violation").length;
      return reply(`Posted in <#${posted.channelId}>: ${v ? `${v} violation${v === 1 ? "" : "s"}` : "no rule breaks"}${r.findings.length > v ? `, ${r.findings.length - v} to watch` : ""}.`);
    }
    case "tradechannels": {
      if (via !== "server") return reply("Run this in the league's own Discord server (linked with `/link`).");
      if (!(await isLeagueAdmin(i))) return reply(NOT_ADMIN);
      return reply(await tradeChannelsCmd(lg.slug, opt(i, "action") === "remove"));
    }
    case "transactionchannels": {
      if (via !== "server") return reply("Run this in the league's own Discord server (linked with `/link`).");
      if (!(await isLeagueAdmin(i))) return reply(NOT_ADMIN);
      const act = opt(i, "action");
      return reply(await txChannelsCmd(lg.slug, act === "remove" ? "remove" : act === "history" ? "history" : null, `discord:${i.member?.user?.id || i.user?.id || "?"}`));
    }
    case "kickoff": {
      if (via !== "server") return reply("Kickoff times can only be set in the league's own Discord server (linked with `/link`).");
      return kickoff(i, lg, d, url);
    }
    case "verifykickoff": {
      if (via !== "server") return reply("Run this in the league's own Discord server (linked with `/link`).");
      if (!(await isLeagueAdmin(i))) return reply(NOT_ADMIN);
      return verifyKickoffCmd(i, lg, d, url);
    }
    case "economy": {
      if (via !== "server") return reply("Run this in the league's own Discord server (linked with `/link`).");
      if (!(await isLeagueAdmin(i))) return reply(NOT_ADMIN);
      return reply(await economyCmd(i, lg), false);
    }
    case "betcap": {
      if (via !== "server") return reply("Run this in the league's own Discord server (linked with `/link`).");
      if (!(await isLeagueAdmin(i))) return reply(NOT_ADMIN);
      return reply(await betCapCmd(i, lg), false);
    }
    case "payouts": {
      if (via !== "server") return reply("Run this in the league's own Discord server (linked with `/link`).");
      if (!(await isLeagueAdmin(i))) return reply(NOT_ADMIN);
      return reply(await postPayoutsNow(lg.slug));
    }
    case "balance": return balanceCmd(i, lg);
    case "bets": return betsCmd(i, lg, d, url);
    case "packchannels": {
      if (via !== "server") return reply("Run this in the league's own Discord server (linked with `/link`).");
      if (!(await isLeagueAdmin(i))) return reply(NOT_ADMIN);
      return reply(await packChannelsCmd(lg.slug, opt(i, "action") === "remove"));
    }
    case "pack":
    case "packs": {
      // In the linked server, packs stay in the Packs category (/packchannels). The interactions route
      // normally catches this first and answers privately; this is the backup if that check was slow.
      if (i.guild_id) {
        const problem = packChannelProblem(await leagueForGuild(i.guild_id), i.guild_id, i.channel);
        if (problem) return reply(problem);
      }
      return name === "pack" ? openPackReply(i, lg, d, base, url, footer) : { embeds: [await packsLeaderboard(i, lg, d, footer)] };
    }
    case "funfact": {
      const pv = opt(i, "player"), tv = opt(i, "team");
      let p = pv != null && pv !== "" ? findPlayer(d, pv) : undefined;
      let t = !p && tv != null && tv !== "" ? findTeam(d, tv) : undefined;
      if (pv && !p) return reply("No player by that name. Pick one from the list as you type.");
      if (tv && !pv && !t) return reply("No team by that name.");
      if (!p && !t) {
        // Surprise me: a random team, or a random rostered player who has played this season.
        const pool = d.players.filter((x) => !x.gone && x.team && !x.ps && x.ovr >= 75);
        if (pool.length && randomInt(3) > 0) p = pool[randomInt(pool.length)];
        else t = d.teams[randomInt(d.teams.length)];
      }
      const facts = p ? playerFacts(d, p) : teamFacts(d, t!);
      // Skip what this player/team got recently (any wording), remembered in leagues.settings.
      const subject = p ? `p${p.id}` : `t${t!.id}`;
      const recentAll = (lg.settings?.funfactRecent || {}) as Record<string, string[]>;
      let f = pickFact(facts, Array.isArray(recentAll[subject]) ? recentAll[subject] : []);
      if (f) {
        const next = remember(recentAll[subject] || [], f, facts.length);
        // Fill in the quips, skipping ones the league saw recently.
        const q = resolveQuips(f.text, (lg.settings?.funfactQuips || {}) as QuipMemory);
        f = { ...f, text: q.text };
        await updateLeagueSettings(lg.id, (s) => {
          s.funfactQuips = mergeQuips(s.funfactQuips as QuipMemory | undefined, q.used);
          const cur = { ...((s.funfactRecent as Record<string, string[]>) || {}) };
          delete cur[subject]; // re-insert last so the oldest subjects drop off first
          cur[subject] = next;
          const keys = Object.keys(cur);
          for (const k of keys.slice(0, Math.max(0, keys.length - FUNFACT_SUBJECTS))) delete cur[k];
          s.funfactRecent = cur;
          return s;
        }).catch(() => {});
      }
      // Nick, 2026-11-18: every player fact has a small special chance of this instead.
      if (p && f && randomInt(100) < 4) f = { text: `${fullName(p)} had accident today. Number 2.`, weight: 0 };
      const who = p ? fullName(p) : `${t!.city} ${t!.name}`;
      const color = hexColor((p ? teamOf(d, p.team) : t)?.primary);
      if (!f) return { embeds: [{ title: `Fun fact: ${who}`, color, footer, description: "Not even enough here to roast yet. That alone is embarrassing. Check back after a few games." }] };
      return { embeds: [{
        title: `🤓 Fun fact: ${who}`, url: url(p ? `/players/${p.id}` : `/teams/${t!.abbr.toLowerCase()}`), color, footer: { text: `${footer.text} · /funfact again for another (${facts.length} on file)` },
        description: f.text,
      }] };
    }
    case "stats": {
      const cat = STAT_CATS.find((c) => c.key === opt(i, "category"));
      if (!cat) return reply("Pick a category from the list.");
      const v = opt(i, "team");
      const t = v != null && v !== "" ? findTeam(d, v) : undefined;
      if (v != null && v !== "" && !t) return reply("No team by that name.");
      // The chart picture carries the list; the text version stays as the caption-less fallback for preview.ts.
      const scope = t ? `${t.city} ${t.name}` : "League";
      return { embeds: [{
        title: `${scope} leaders: ${cat.label}`, url: url("/leaders"), color: t ? hexColor(t.primary) : BRAND, footer,
        image: { url: statsImageUrl(base, lg.slug, cat.key, t?.id) },
      }] };
    }
    case "standings": return { embeds: [standingsEmbed(d, url, footer)] };
    case "playoffs": return { embeds: [playoffsEmbed(d, url, footer)] };
    case "scores": {
      const w = Number(opt(i, "week"));
      const pick = w ? { stage: 1, week: w - 1 } : defaultScoresWeek(d);
      return { embeds: [scoresEmbed(d, pick.stage, pick.week, url, footer)] };
    }
    case "info":
    case "league": {
      // From /league: one of your own leagues, open to anyone (the old admin-only /league info is folded in here).
      if (!i.forced && i.guild_id && !(await isLeagueAdmin(i))) return reply(NOT_ADMIN);
      const ch = via === "server" ? discordOf(lg)?.channelId : null;
      return {
        embeds: [{
          title: lg.name, url: url(), color: BRAND, footer,
          description: [
            `**${d.season.year} ${d.season.title}** · data from ${new Date(d.pulledAt).toUTCString().replace(" GMT", " UTC")}`,
            `[Standings](${url("/standings")}) · [Cap](${url("/cap")}) · [Contract tool](${url("/contracts")}) · [Playoffs](${url("/playoffs")}) · [Draft](${url("/draft")})`,
            i.forced ? "Picked with `/league`." : via === "user" ? "This is your league (`/myleague`)." : ch ? `This server's league. Updates post in <#${ch}>.` : "This server's league. Updates aren't posting anywhere yet (`/notify`).",
          ].join("\n"),
        }],
      };
    }
  }
  return reply("I don't know that command yet.");
}

async function link(i: Interaction, base: string): Promise<Message> {
  if (!canManage(i)) return reply("Only people with **Manage Server** can link this server.");
  const raw = String(opt(i, "league") || "").trim().toLowerCase();
  const slug = raw.replace(/^.*\/l\//, "").replace(/[/?#].*$/, "");
  const lg = await leagueBySlug(slug);
  if (!lg) return reply(`No league at **${slug}**. Use the part after /l/ in the league's address, e.g. \`ncl\` for ${base}/l/ncl.`);
  if (!lg.is_public) return reply(`${lg.name} is private, so it can't be shown in Discord.`);
  // Linking decides which server's "admin" role runs the league's bot commands (/betcap, /economy,
  // /verifykickoff, payouts) and which server's UnbelievaBoat balances its Tickets bets use, and it moves
  // the league away from any server it was linked to. So it takes a member of the league (matched through
  // /connect), not just Manage Server in whatever server the command was run in.
  const linker = await userForDiscord(userId(i)).catch(() => null);
  if (!linker || !(await isMember(lg.id, linker).catch(() => false))) {
    return reply(`Only members of **${lg.name}** can link it to a Discord server. ${linker ? "Your CFM Manager account isn't in that league: add it from Connect EA on the site first." : "Run `/connect` first to link your Discord to your CFM Manager account, then run `/link` again."}`);
  }
  const current = await leagueForGuild(i.guild_id!);
  if (current && current.id !== lg.id) await setDiscord(current.id, null);
  // If the league was linked to another server, it moves here (and that server's update channel is dropped).
  const prev = discordOf(lg);
  const keepChannel = prev && prev.guildId === i.guild_id ? prev.channelId ?? null : null;
  // Moving to another server: forget the old server's Markets channels so the next /marketchannels builds them here.
  if (prev && prev.guildId !== i.guild_id) await clearMarketChannels(lg.id);
  await setDiscord(lg.id, { guildId: i.guild_id!, channelId: keepChannel, linkedBy: i.member?.user.id, linkedAt: new Date().toISOString() });
  return reply(`Linked to **${lg.name}** (${base}/l/${lg.slug}). Try \`/player\`, \`/cap\` or \`/playoffs\`. To get updates after each sync, run \`/notify channel:#your-channel\`.`, false);
}

async function myLeague(i: Interaction, base: string): Promise<Message> {
  const uid = userId(i);
  if (!uid) return reply("Couldn't tell who you are.");
  const raw = String(opt(i, "league") || "").trim().toLowerCase();
  if (!raw) {
    const cur = await leagueForUser(uid);
    return reply(cur ? `Your league is **${cur.name}** (${base}/l/${cur.slug}). Run \`/myleague league:<web address>\` to change it, or \`/myleague league:none\` to clear it.` : "You haven't picked a league. Run `/myleague league:<web address>`.");
  }
  if (raw === "none" || raw === "clear") {
    await setUserLeague(uid, null);
    return reply("Cleared your league.");
  }
  const slug = raw.replace(/^.*\/l\//, "").replace(/[/?#].*$/, "");
  const lg = await leagueBySlug(slug);
  if (!lg) return reply(`No league at **${slug}**. Use the part after /l/ in the league's address, e.g. \`ncl\` for ${base}/l/ncl.`);
  if (!lg.is_public) return reply(`${lg.name} is private, so it can't be shown in Discord.`);
  await setUserLeague(uid, lg.id);
  return reply(`Your league is now **${lg.name}**. \`/player\`, \`/cap\` and the rest use it in DMs, group DMs and any server that isn't linked to its own league.`);
}

async function unlink(i: Interaction): Promise<Message> {
  if (!canManage(i)) return reply("Only people with **Manage Server** can unlink this server.");
  const lg = await leagueForGuild(i.guild_id!);
  if (!lg) return reply("This server isn't linked to a league.");
  await setDiscord(lg.id, null);
  return reply(`Unlinked from **${lg.name}**.`, false);
}

async function notify(i: Interaction, lg: LinkedLeague): Promise<Message> {
  if (!canManage(i)) return reply("Only people with **Manage Server** can change where updates post.");
  const cur = discordOf(lg)!;
  const channel = opt(i, "channel");
  if (!channel) {
    await setDiscord(lg.id, { ...cur, channelId: null });
    return reply("League updates are off. Run `/notify channel:#channel` to turn them back on.", false);
  }
  const token = process.env.DISCORD_BOT_TOKEN;
  if (token) {
    const err = await postToChannel(token, String(channel), {
      embeds: [{ color: BRAND, title: `${lg.name} updates will post here`, description: "A message each time the league advances to a new week." }],
    });
    if (err) return reply(err);
  }
  await setDiscord(lg.id, { ...cur, channelId: String(channel) });
  return reply(`**${lg.name}** advance alerts will post in <#${channel}>.`);
}

async function alertVideo(i: Interaction, lg: LinkedLeague): Promise<Message> {
  // Only the bot's owner (whoever owns the app in the Discord developer portal) can add or remove clips.
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return reply("Alert videos aren't set up on the server yet.");
  if (!(await appOwnerIds(token)).includes(userId(i))) return reply("Only the bot's owner can add or remove alert videos.");
  const event = String(opt(i, "event")) as AlertEvent;
  if (!(event in ALERT_EVENTS)) return reply("Pick one of the listed events.");
  const label = ALERT_EVENTS[event].toLowerCase();
  const cur = discordOf(lg)!;
  const videos = { ...(cur.videos || {}) };
  const db = supabaseAdmin().storage.from("league-data");
  const attId = i.data?.name === "removealertvideo" ? undefined : opt(i, "video");
  if (i.data?.name === "alertvideo" && !attId) return reply("Attach the video in the `video` box.");

  if (!attId) {
    const old = videos[event];
    if (!old) return reply(`No video is set for when ${label}.`);
    delete videos[event];
    await setDiscord(lg.id, { ...cur, videos });
    await db.remove([old.path]).catch(() => {});
    return reply(`Removed the video for when ${label}.`);
  }

  const att = i.data?.resolved?.attachments?.[String(attId)];
  if (!att) return reply("Couldn't read that attachment. Try uploading it again.");
  const type = (att.content_type || "").split(";")[0];
  if (!type.startsWith("video/")) return reply("That isn't a video file. Use an MP4, MOV or WebM.");
  if (att.size > MAX_VIDEO_BYTES) return reply(`That video is ${(att.size / 1048576).toFixed(1)} MB. Discord lets bots post up to 10 MB, so trim or compress it first.`);
  const res = await fetch(att.url);
  if (!res.ok) return reply("Couldn't download the video from Discord. Try again.");
  const data = Buffer.from(await res.arrayBuffer());
  const ext = (att.filename.match(/\.([a-z0-9]{2,4})$/i)?.[1] || "mp4").toLowerCase();
  const path = `${lg.slug}/discord/${event}.${ext}`;
  const up = await db.upload(path, data, { contentType: type, upsert: true });
  if (up.error) return reply(`Couldn't save the video: ${up.error.message}`);
  const old = videos[event];
  if (old && old.path !== path) await db.remove([old.path]).catch(() => {});
  videos[event] = { path, filename: att.filename, contentType: type, size: data.length, setAt: new Date().toISOString() };
  await setDiscord(lg.id, { ...cur, videos });

  // Show it once in the update channel so everyone sees what it'll look like.
  if (cur.channelId) {
    const err = await postToChannel(token, cur.channelId, { embeds: [{ color: BRAND, title: `🎬 New alert video: ${label}`, description: "This plays with that update from now on." }] }, { data, filename: att.filename, contentType: type });
    if (err) return reply(`Saved, but the test post failed: ${err}`);
    return reply(`Saved. It'll post in <#${cur.channelId}> every time ${label}. I posted it there once so you can see it.`);
  }
  return reply(`Saved. It'll post every time ${label}, once updates are on: run \`/notify channel:#channel\`.`);
}

// ---------- packs ----------

const RARITY_COLOR = [0x9a6a3a, 0xc9d1e0, 0xf2c200, 0xe0115f];
const displayName = (i: Interaction) => {
  const u = i.member?.user || i.user;
  return u?.global_name || u?.username || "Someone";
};

async function openPackReply(i: Interaction, lg: LinkedLeague, d: LeagueData, base: string, url: Url, footer: Footer): Promise<Message> {
  const uid = userId(i);
  if (!uid) return reply("Couldn't tell who you are.");
  const stats = await loadPackStats(lg.slug);
  const cards = openPack(d);
  if (!cards.length) return reply("This league has no players to pull yet.");
  const pts = cards.map(cardPoints);
  const total = pts.reduce((a, b) => a + b, 0);
  const top = cards[cards.length - 1];
  const name = displayName(i);
  const u = stats.users[uid] || { name, points: 0, packs: 0, best: 0, legendaries: 0, last: "" };
  u.name = name;
  u.points += total;
  u.packs += 1;
  u.legendaries += cards.filter((c) => c.dev === 3).length;
  if (total > u.best) { u.best = total; u.bestPull = `${fullName(top)} (${RARITY[top.dev].name}, ${top.ovr})`; }
  u.last = new Date().toISOString();
  stats.users[uid] = u;
  const place = recordTopPack(stats, { uid, name, points: total, hits: packHits(cards), at: u.last });
  await savePackStats(lg.slug, stats);
  const league = footer.text.split(" · ")[0];
  const placeText = place === 1 ? `🏆 The craziest pack ever pulled in ${league}!`
    : place && place <= 10 ? `Pack #${place} all-time in ${league}.`
    : `Your best pack: ${u.best} pts.`;

  const lines = cards.map((p, k) => {
    const r = RARITY[p.dev];
    return `${r.emoji} **${r.name}** · ${p.pos} [${fullName(p)}](${url(`/players/${p.id}`)}) · ${p.ovr} · ${teamOf(d, p.team)?.abbr || "FA"} · **+${pts[k]}**`;
  });
  return {
    embeds: [{
      title: `${name} opened a pack: ${luckLabel(total)}`,
      color: RARITY_COLOR[top.dev] ?? BRAND,
      description: `${lines.join("\n")}\n\nPack total: **${total} pts** · ${placeText}`,
      image: { url: packImageUrl(base, lg.slug, cards.map((c) => c.id)) },
      footer: { text: `${name}: ${u.packs} pack${u.packs === 1 ? "" : "s"} opened · /packs for the leaderboard` },
    }],
  };
}

async function packsLeaderboard(i: Interaction, lg: LinkedLeague, d: LeagueData, footer: Footer): Promise<Embed> {
  const stats = await loadPackStats(lg.slug);
  if (!stats.top) recordTopPack(stats, { uid: "", name: "", points: -1, hits: "", at: "" }); // seeds older files; the dummy falls off below
  const top = (stats.top || []).filter((t) => t.points >= 0);
  const medal = ["🥇", "🥈", "🥉"];
  const board = top.slice(0, 10).map((t, k) => `${medal[k] || `**${k + 1}.**`} **${t.points} pts** · ${t.name} · ${luckLabel(t.points)}${t.hits ? `\n-# ${t.hits}` : ""}`);
  const uid = userId(i);
  const me = stats.users[uid];
  const myPlace = top.findIndex((t) => t.uid === uid) + 1;
  const counts = [0, 1, 2, 3].map((dev) => d.players.filter((p) => !p.gone && p.team && !p.ps && p.dev === dev).length);
  const odds = RARITY.map((r, k) => `${r.emoji} ${r.name} (${DEV_LABEL[k]}): ${(ODDS[k] / 10).toFixed(0)}% per card · ${r.points} pts · ${counts[k]} in the set`).join("\n");
  return {
    title: "Craziest packs pulled", color: BRAND, footer,
    description: board.join("\n") || "Nobody has opened a pack yet. Run `/pack`!",
    fields: [
      ...(me ? [{ name: "You", value: `Best pack ${me.best} pts${myPlace ? ` (#${myPlace} on the board)` : ""}${me.bestPull ? ` · top card ${me.bestPull}` : ""} · ${me.packs} packs opened${me.legendaries ? ` · ${me.legendaries}× 🟥` : ""}` }] : []),
      { name: `Odds (${PACK_SIZE} cards a pack)`, value: `${odds}\n-# Each card also gets +1 per 5 overall over 70 (up to +5), and 99s count double.` },
    ],
  };
}

// ---------- embeds ----------

type Url = (path?: string) => string;
type Footer = { text: string };

function statLine(d: LeagueData, p: Player): string | null {
  const t = seasonTotals(d, (l) => l.p === p.id).get(p.id);
  if (!t || !t.gp) return null;
  const n = (v: number) => v.toLocaleString("en-US");
  const parts: string[] = [];
  if (t.pa) parts.push(`${n(t.pc)}/${n(t.pa)}, ${n(t.py)} pass yds, ${t.ptd} TD, ${t.pint} INT`);
  if (t.ra >= 10 || (t.ra && !t.pa)) parts.push(`${n(t.ra)} rush, ${n(t.ry)} yds, ${t.rtd} TD`);
  if (t.rc) parts.push(`${t.rc} rec, ${n(t.rcy)} yds, ${t.rctd} TD`);
  if (t.tk || t.sk || t.int) parts.push(`${t.tk} tkl, ${t.sk} sacks, ${t.int} INT${t.pd ? `, ${t.pd} PD` : ""}`);
  if (t.fga) parts.push(`${t.fgm}/${t.fga} FG, long ${t.fglng}`);
  if (t.pnt) parts.push(`${t.pnt} punts, ${(t.pnty / t.pnt).toFixed(1)} avg`);
  return `${t.gp} games · ${parts.join(" · ") || "no stats yet"}`;
}

function capByYear(d: LeagueData, p: Player): string {
  if (!p.contract.length || !p.team) return "";
  const pr = projectPlayer(p, capSeason(d));
  const ys = capYears(d).filter((y) => pr.hits[y] != null || pr.dead[y]);
  if (!ys.length) return "";
  const rows = ys.map((y) => `${y}: **${money(pr.hits[y] ?? 0)}**${pr.dead[y] ? ` (+${money(pr.dead[y])} void)` : ""}`);
  const how = pr.source === "formula" ? "Future years are projected from his deal." : pr.source === "restructured" ? "Future years include his restructure." : "Future years follow his real NFL contract.";
  return `${rows.join("\n")}\n-# ${how}`;
}

function playerEmbed(d: LeagueData, p: Player, url: Url, footer: Footer): Embed {
  const t = teamOf(d, p.team);
  const c = p.contract;
  const flags = [p.ps && "Practice squad", p.ir && "IR", p.injury > 0 && `Injured (${p.injury} wk)`].filter(Boolean).join(" · ");
  const fields: Embed["fields"] = [];
  if (c.length && p.team) {
    fields.push({ name: "Contract", value: `${c.length} yrs, ${money(c.salary + c.bonus)} (${money(c.bonus)} bonus)\n${c.yearsLeft} year${c.yearsLeft === 1 ? "" : "s"} left`, inline: true });
    fields.push({ name: `${capSeason(d)} cap hit`, value: `**${money(c.capHit)}**\nCut: saves ${money(c.releaseSavings)}, ${money(c.releasePenalty)} dead`, inline: true });
    const cy = capByYear(d, p);
    if (cy) fields.push({ name: "Cap hit by year", value: cy });
  } else if (p.desired?.salary) {
    fields.push({ name: "Asking", value: `${p.desired.length} yr${p.desired.length === 1 ? "" : "s"}, ${money(p.desired.salary)} salary + ${money(p.desired.bonus)} bonus`, inline: true });
  }
  const s = statLine(d, p);
  if (s) fields.push({ name: `${d.season.year} regular season`, value: s });
  if (p.abilities.length) fields.push({ name: "Abilities", value: p.abilities.map((a) => `${a.title} (${a.tier})`).join(", ") });
  const img = standInArt(p);
  return {
    title: fullName(p), url: url(`/players/${p.id}`), color: hexColor(t?.primary), footer,
    description: [`**${p.pos} · ${teamLabel(t)}**${p.jersey ? ` · #${p.jersey}` : ""}`, `${p.ovr} OVR · ${DEV_LABEL[p.dev]} · Age ${p.age} · ${p.yearsPro ? `${p.yearsPro} yrs pro` : "Rookie"}`, flags].filter(Boolean).join("\n"),
    fields,
    thumbnail: img ? { url: img } : undefined,
  };
}

function contractEmbed(d: LeagueData, p: Player, url: Url, footer: Footer): Embed {
  const market = marketOf(d);
  const me = market.find((m) => m.id === p.id)!;
  const r = recommend(me, market);
  const t = teamOf(d, p.team);
  const embed: Embed = { title: `${fullName(p)}: next contract`, url: url(`/contracts?player=${p.id}`), color: hexColor(t?.primary), footer };
  if (!r) return { ...embed, description: `Not enough signed ${p.pos}s near ${p.ovr} OVR to price a deal.` };
  const peers = r.peers.slice(0, 4).map((m) => `${m.n} (${m.ovr}, age ${m.age}) ${money((m.c[2] + m.c[3]) / m.c[0])}/yr`).join("\n");
  return {
    ...embed,
    description: `${p.pos} · ${p.ovr} OVR · Age ${p.age} · ${teamLabel(t)}`,
    fields: [
      { name: "Likely ask", value: `**${r.length} yrs, ${money(r.total)}**\n${money(r.apy)}/yr · ${money(r.bonus)} bonus`, inline: true },
      ...(p.desired?.salary ? [{ name: "Madden's in-game ask", value: `${p.desired.length} yrs, ${money(p.desired.salary + p.desired.bonus)}`, inline: true }] : []),
      { name: `Market (${r.tierLabel})`, value: peers + (r.keepsOwn ? "\n-# He won't take less per year than his current deal." : "") },
    ],
  };
}

/** A team's cap, focused on one season (this season by default). over: negative space that season. */
function teamCapEmbed(d: LeagueData, t: Team, url: Url, footer: Footer, year = capSeason(d)): { embed: Embed; over: boolean } {
  const pr = teamCapProjection(d, t);
  const roster = teamPlayers(d, t.id);
  const focus = pr.totals.find((y) => y.year === year) || pr.totals[0];
  const now = focus.year === capSeason(d);
  const over = focus.space < 0;
  const years = pr.totals.map((y, i) => {
    const row = `${y.year}${i && !y.capSet ? " proj." : ""}: **${money(y.space)}** space (${money(y.committed)} of ${money(y.cap)}, ${y.players} signed)`;
    return y.year === focus.year ? `▶ ${row}` : row;
  });
  // The biggest cap hits in the season shown.
  const hits = pr.rows
    .map((r) => ({ p: r.p, hit: now ? r.p.contract.capHit : (r.hits[focus.year] || 0) + (r.dead[focus.year] || 0) }))
    .filter((r) => r.hit > 0).sort((a, b) => b.hit - a.hit).slice(0, 5)
    .map((r) => `${fullName(r.p)} (${r.p.pos}) ${money(r.hit)}`);
  const expiring = now
    ? roster.filter((p) => !p.ps && p.contract.yearsLeft <= 1).sort((a, b) => b.contract.capHit - a.contract.capHit)
    : pr.rows.filter((r) => r.hits[focus.year] != null && r.hits[focus.year + 1] == null).map((r) => r.p);
  const label = `${focus.year}${focus.capSet ? "" : " (projected)"}`;
  const embed: Embed = {
    title: `${teamLabel(t)}: ${label} cap`, url: url(`/teams/${t.abbr.toLowerCase()}?tab=cap`), color: over ? 0xff4d63 : hexColor(t.primary), footer,
    description: over
      ? `🚨 **${money(focus.space)}** in ${label}. That's ${money(-focus.space)} over a ${money(focus.cap)} cap with ${focus.players} players signed.`
      : `**${money(focus.space)}** in space for ${label} (${money(focus.committed)} of ${money(focus.cap)}, ${focus.players} players signed).`,
    fields: [
      { name: "Cap space by year", value: years.join("\n") + (now ? "" : `\n-# ${capNote(pr.totals)}`) },
      { name: `Biggest cap hits, ${focus.year}`, value: hits.join("\n") || "—", inline: true },
      { name: `Expiring after ${focus.year} (${expiring.length})`, value: expiring.slice(0, 5).map((p) => `${fullName(p)}${now ? ` ${money(p.contract.capHit)}` : ""}`).join("\n") || "None", inline: true },
      ...(now ? [{ name: "Dead money", value: money(inferredDeadCap(t, roster)), inline: true }] : []),
    ],
  };
  return { embed, over };
}

/** Footnote on how future seasons' cap space is worked out. */
function capNote(totals: { year: number; cap: number; capSet: boolean }[]): string {
  const set = totals.slice(1).filter((t) => t.capSet);
  const known = set.map((t) => `${t.year} uses Madden's actual ${money(t.cap)} cap. `).join("");
  return `From current contracts. ${known}${set.length ? "Later seasons assume" : "Assumes"} the cap grows $15M a season.`;
}

function leagueCapEmbed(d: LeagueData, url: Url, footer: Footer, year = capSeason(d)): Embed {
  if (year !== capSeason(d)) {
    // One future season: every team's projected space, most room first.
    const rows = d.teams.map((t) => ({ t, y: teamCapProjection(d, t).totals.find((x) => x.year === year)! })).sort((a, b) => b.y.space - a.y.space);
    const line = (r: (typeof rows)[number]) => `\`${r.t.abbr.padEnd(3)}\` ${money(r.y.space)} · ${r.y.players} signed`;
    const over = rows.filter((r) => r.y.space < 0);
    return {
      title: `${year} cap space${rows[0]?.y.capSet ? "" : " (projected)"}`, url: url(`/cap?year=${year}`), color: BRAND, footer,
      fields: [
        { name: "Most room", value: rows.slice(0, 8).map(line).join("\n") },
        { name: "Least room", value: rows.slice(-8).map(line).join("\n") },
        ...(over.length ? [{ name: `Over the cap in ${year}`, value: over.map((r) => `${teamLabel(r.t)} (${money(r.y.space)})`).join("\n") }] : []),
        { name: "\u200b", value: `-# ${capNote(teamCapProjection(d, d.teams[0]).totals)}` },
      ],
    };
  }
  const rows = d.teams.map((t) => ({ t, next: teamCapProjection(d, t).totals[1] })).sort((a, b) => b.t.cap.available - a.t.cap.available);
  const line = (r: (typeof rows)[number]) => `\`${r.t.abbr.padEnd(3)}\` ${money(r.t.cap.available)} now · ${money(r.next.space)} in ${r.next.year}`;
  const over = rows.filter((r) => r.t.cap.available < 0);
  return {
    title: "Cap space", url: url("/cap"), color: BRAND, footer,
    fields: [
      { name: "Most room", value: rows.slice(0, 8).map(line).join("\n") },
      { name: "Least room", value: rows.slice(-8).map(line).join("\n") },
      ...(over.length ? [{ name: "Over the cap", value: over.map((r) => `${teamLabel(r.t)} (${money(r.t.cap.available)})`).join("\n") }] : []),
    ],
  };
}

function teamEmbed(d: LeagueData, t: Team, url: Url, footer: Footer): Embed {
  const roster = teamPlayers(d, t.id).filter((p) => !p.ps);
  const best = [...roster].sort((a, b) => b.ovr - a.ovr).slice(0, 6).map((p) => `${p.pos} ${fullName(p)} **${p.ovr}**${p.dev ? ` · ${DEV_LABEL[p.dev]}` : ""}`);
  const next = d.games.find((g) => !g.final && (g.home === t.id || g.away === t.id) && g.home && g.away);
  const opp = next ? teamOf(d, next.home === t.id ? next.away : next.home) : undefined;
  return {
    title: teamLabel(t), url: url(`/teams/${t.abbr.toLowerCase()}`), color: hexColor(t.primary), footer,
    description: `${t.user ? `Run by **${t.user}**` : "CPU team"} · ${t.division} · ${t.ovr} OVR`,
    fields: [
      { name: "Record", value: `${record(t)} (${streakText(t.rec.streak)})\nDiv ${recText(t.rec.divW, t.rec.divL, t.rec.divT)} · PF ${t.rec.pf} PA ${t.rec.pa}`, inline: true },
      { name: "Cap space", value: `${money(t.cap.available)}\n${roster.length} on the active roster`, inline: true },
      ...(next && opp ? [{ name: "Next game", value: `${weekTitle(d, next.stage, next.week)}: ${next.home === t.id ? "vs" : "@"} ${teamLabel(opp)}`, inline: true }] : []),
      { name: "Best players", value: best.join("\n") || "—" },
    ],
  };
}

/** /players with no team: the league's top 25 rostered players (one position group or everyone) by a rating,
 *  OVR best to worst by default. Free agents left out; practice squad flagged. Nick, 2026-11-18. */
const LEAGUE_LIST = 25;
function leaguePlayersEmbed(d: LeagueData, g: DiscordPosGroup | undefined, url: Url, footer: Footer, sort?: PlayerSort): Embed {
  const s: PlayerSort = sort ?? { ...findSortRating("")!, dir: "desc" };
  const pool = d.players.filter((p) => p.team > 0 && !p.gone && (!g || g.positions.includes(p.pos)));
  const rated = pool.filter((p) => sortValue(p, s.key) != null);
  rated.sort((a, b) => {
    const va = sortValue(a, s.key)!, vb = sortValue(b, s.key)!;
    return (s.dir === "asc" ? va - vb : vb - va) || b.ovr - a.ovr;
  });
  const showVal = s.key !== "ovr";
  const line = (p: Player, k: number, link: boolean) => {
    const flags = [p.ps ? "PS" : "", p.ir ? "IR" : p.injury > 0 ? `inj ${p.injury} wk` : ""].filter(Boolean);
    const yl = p.contract.yearsLeft;
    return `${k + 1}. ${p.pos} ${link ? `[${fullName(p)}](${url(`/players/${p.id}`)})` : fullName(p)} · ${teamOf(d, p.team)?.abbr || "FA"}`
      + `${showVal ? ` · ${s.short} **${sortValue(p, s.key)}** · ${p.ovr} OVR` : ` · **${p.ovr}**`}`
      + `${p.dev ? ` · ${DEV_LABEL[p.dev]}` : ""} · age ${p.age}`
      + ` · ${money(p.contract.capHit)}, ${yl} yr${yl === 1 ? "" : "s"} left${flags.length ? ` · ${flags.join(" · ")}` : ""}`;
  };
  const top = rated.slice(0, LEAGUE_LIST);
  const head = `${s.dir === "asc" ? "Bottom" : "Top"} ${top.length} of ${rated.length} rostered ${g ? g.name : "players"} league-wide by ${s.label}, `
    + `${s.dir === "asc" ? "worst to best" : "best to worst"}.${rated.length < pool.length ? `\n-# ${pool.length - rated.length} without ratings in this build left out.` : ""}`;
  let desc = `${head}\n\n${top.map((p, k) => line(p, k, true)).join("\n")}`;
  if (desc.length > 4000) desc = `${head}\n\n${top.map((p, k) => line(p, k, false)).join("\n")}`;
  return {
    title: `League ${g ? g.label.toLowerCase() : "players"} by ${s.short}`,
    url: url("/players"), color: BRAND, footer,
    description: top.length ? desc : `No rostered ${g ? g.name : "players"} found.`,
  };
}

// Every position in depth-chart order, for /players with no group (the whole roster).
const ALL_POSITIONS = [...new Set(DISCORD_POS_GROUPS.flatMap((x) => x.positions))];

/** /players team [group] [rating] [order]: the team's players (one position group, or the whole roster when the
 *  group is empty), practice squad last. Default order is a depth chart (position, then OVR); with a rating or
 *  order picked it's that rating, best to worst or worst to best. A group also gets its league rank.
 *  Nick, 2026-11-18. */
function groupEmbed(d: LeagueData, t: Team, g: DiscordPosGroup | undefined, url: Url, footer: Footer, sort?: PlayerSort): Embed {
  const positions = g?.positions ?? ALL_POSITIONS;
  const order = (p: Player) => { const k = positions.indexOf(p.pos); return k < 0 ? 99 : k; };
  const val = (p: Player) => (sort ? sortValue(p, sort.key) : null);
  // Sorted: missing ratings (older builds) always go last, ties broken by OVR.
  const bySort = (a: Player, b: Player) => {
    const va = val(a), vb = val(b);
    if (va == null || vb == null) return va == null && vb == null ? b.ovr - a.ovr : va == null ? 1 : -1;
    return (sort!.dir === "asc" ? va - vb : vb - va) || b.ovr - a.ovr;
  };
  const all = teamPlayers(d, t.id).filter((p) => !g || g.positions.includes(p.pos))
    .sort((a, b) => Number(a.ps) - Number(b.ps) || (sort ? bySort(a, b) : order(a) - order(b) || b.ovr - a.ovr));
  const showVal = sort && sort.key !== "ovr";
  const line = (p: Player, k: number, link = true) => {
    const flags = [p.ir ? "IR" : p.injury > 0 ? `inj ${p.injury} wk` : ""].filter(Boolean);
    const yl = p.contract.yearsLeft;
    const v = val(p);
    return `${sort ? `${k + 1}. ` : ""}${p.pos} ${link ? `[${fullName(p)}](${url(`/players/${p.id}`)})` : fullName(p)}`
      + `${showVal ? ` · ${sort!.short} **${v ?? "–"}**` : ""} · ${showVal ? "" : "**"}${p.ovr}${showVal ? " OVR" : "**"}`
      + `${p.dev ? ` · ${DEV_LABEL[p.dev]}` : ""} · age ${p.age}`
      + ` · ${money(p.contract.capHit)}, ${yl} yr${yl === 1 ? "" : "s"} left${flags.length ? ` · ${flags.join(" · ")}` : ""}`;
  };
  const active = all.filter((p) => !p.ps), ps = all.filter((p) => p.ps);
  const cap = active.reduce((a, p) => a + p.contract.capHit, 0);
  const avg = active.length ? Math.round(active.reduce((a, p) => a + p.ovr, 0) / active.length) : 0;
  const sortNote = sort ? `\n-# Sorted by ${sort.label}, ${sort.dir === "asc" ? "worst to best" : "best to worst"}.` : "";
  const head = active.length
    ? `${active.length} on the active roster · avg ${avg} OVR · ${money(cap)} in cap hits this season${sortNote}`
    : `No ${g ? g.name : "players"} on the ${teamLabel(t)} active roster.`;
  // Where this group ranks: every team's starters in the group by average OVR (Nick, 2026-11-18). Groups only.
  let rankBlock = "";
  if (g) {
    const board = d.teams.map((x) => ({ t: x, ...groupStarters(teamPlayers(d, x.id), g) })).sort((a, b) => b.avg - a.avg);
    const rankOf = (k: number) => board.findIndex((r) => r.avg.toFixed(1) === board[k].avg.toFixed(1)) + 1; // ties share a rank
    const me = board.findIndex((r) => r.t.id === t.id);
    const whole = g.slots.every(([, n]) => n === 0);
    const starterNote = g.slots.map(([pos, n]) => `${n} ${pos.length > 1 && g.key !== "db" && g.key !== "s" ? g.name : pos.join("/")}`).join(" + ");
    const show = new Set([0, 1, 2, 3, 4, me - 1, me, me + 1, board.length - 1].filter((k) => k >= 0 && k < board.length));
    let prev = -1;
    const rows: string[] = [];
    for (const k of [...show].sort((a, b) => a - b)) {
      if (prev >= 0 && k > prev + 1) rows.push("-# …");
      const r = board[k], mine = k === me;
      const text = `${rankOf(k)}. ${r.t.abbr} · ${r.avg.toFixed(1)}`;
      rows.push(mine ? `**▶ ${text}**` : text);
      prev = k;
    }
    const rankHead = whole
      ? `**League rank: #${rankOf(me)} of ${board.length}** (room avg ${board[me].avg.toFixed(1)} OVR)`
        + `\n-# Every ${g.name} on each active roster (practice squad left out); an empty room counts as 40.`
      : `**League rank: #${rankOf(me)} of ${board.length}** (starters avg ${board[me].avg.toFixed(1)} OVR)`
        + `\n-# Starters: ${starterNote}, best OVR on the active roster; an empty spot counts as 40.`;
    rankBlock = `${rankHead}\n${rows.join("\n")}\n\n`;
  }

  // Player lines, then the practice squad. Discord caps a description at 4,096: if the list doesn't fit with
  // each name linked (a whole roster usually doesn't), names go unlinked; whatever still doesn't fit is "+N more".
  const build = (link: boolean) => {
    let out = `${rankBlock}${head}${active.length ? "\n" : ""}`, shown = 0;
    const rows = [...active.map((p, k) => line(p, k, link)), ...(ps.length ? ["", "**Practice squad**"] : []), ...ps.map((p, k) => line(p, k, link))];
    const budget = 4000 - 90; // room for the "+N more" line
    for (const l of rows) {
      if (out.length + l.length + 1 > budget) break;
      out += `\n${l}`;
      if (l && !l.startsWith("**Practice")) shown++;
    }
    return { out, left: all.length - shown };
  };
  let { out: desc, left } = build(true);
  if (left > 0) ({ out: desc, left } = build(false));
  if (left > 0) desc += `\n-# +${left} more on the [team page](${url(`/teams/${t.abbr.toLowerCase()}`)}).`;
  return {
    title: `${teamLabel(t)}: ${g ? g.label : "Roster"}${sort ? ` by ${sort.short}` : ""}`,
    url: url(`/teams/${t.abbr.toLowerCase()}`), color: hexColor(t.primary), footer,
    description: desc,
  };
}

const marketOf = (d: LeagueData): MarketPlayer[] => d.players.filter((x) => !x.gone).map((x) => ({
  id: x.id, n: fullName(x), pos: x.pos, t: x.team, age: x.age, ovr: x.ovr, ps: x.ps, yp: x.yearsPro,
  c: [x.contract.length, x.contract.yearsLeft, x.contract.salary, x.contract.bonus, x.contract.capHit],
}));

/** /expiring team: the team's 10 best players (by OVR) in the last year of their deal, with the projected ask
 *  (same market recommendation as /contract and the Contract tool) and Madden's in-game ask when exported. */
function expiringEmbed(d: LeagueData, t: Team, url: Url, footer: Footer): Embed {
  const all = d.players.filter((p) => p.team === t.id && !p.gone && !p.ps && p.contract.yearsLeft <= 1);
  const top = [...all].sort((a, b) => b.ovr - a.ovr || b.contract.capHit - a.contract.capHit).slice(0, 10);
  const market = marketOf(d);
  const byId = new Map(market.map((m) => [m.id, m]));
  const lines = top.map((p, k) => {
    const r = recommend(byId.get(p.id)!, market);
    const head = `**${k + 1}.** ${p.pos} [${fullName(p)}](${url(`/players/${p.id}`)}) · **${p.ovr}** · age ${p.age}${p.dev ? ` · ${DEV_LABEL[p.dev]}` : ""} · now ${money(p.contract.capHit)}`;
    const ds = p.desired && p.desired.length > 0 && p.desired.salary + p.desired.bonus > 0
      ? ` · Madden: ${money((p.desired.salary + p.desired.bonus) / p.desired.length)}/yr, ${p.desired.length} yrs` : "";
    const ask = r
      ? `-# Ask: **${money(r.apy)}/yr** · ${r.length} yr${r.length === 1 ? "" : "s"}, ${money(r.total)} (${money(r.bonus)} bonus)${ds}`
        + `\n-# Cap hit: ${askCapHits(r, capSeason(d) + p.contract.yearsLeft).map((h) => `${h.year} ${money(h.capHit)}`).join(" · ")}`
      : `-# Ask: not enough similar signed players to price a deal${ds}`;
    return `${head}\n${ask}`;
  });
  const freed = all.reduce((a, p) => a + p.contract.capHit, 0);
  const more = all.length > top.length ? `\n\n+${all.length - top.length} more on the [team page](${url(`/teams/${t.abbr.toLowerCase()}?tab=cap&view=expiring`)}).` : "";
  return {
    title: `${teamLabel(t)}: expiring contracts`,
    url: url(`/teams/${t.abbr.toLowerCase()}?tab=cap&view=expiring`),
    color: hexColor(t.primary), footer,
    description: top.length
      ? `${all.length} player${all.length === 1 ? "" : "s"} in the last year of his deal, ${money(freed)} of cap this season. Top 10 by overall:\n\n${lines.join("\n")}${more}`
      : `Nobody on the ${teamLabel(t)} is in the last year of his deal.`,
  };
}

/** Top 10 rookies of the newest draft class by overall (real dev traits, which Madden hides in game), league-wide
 *  (rostered players only) or one team's. */
function rookiesEmbed(d: LeagueData, t: Team | undefined, url: Url, footer: Footer, year?: number): Embed {
  // The newest draft class by EA's rookieYear, not "0 years pro": around the draft Madden may still show last
  // year's rookies at 0 years pro, which would mix two classes. Players without a rookieYear fall back to yearsPro.
  const newest = d.players.reduce((m, p) => (!p.gone && p.draft.year > m ? p.draft.year : m), 0);
  const cls = year || newest;
  // A past class (year given) matches by draft year only; the newest class also takes players with no rookieYear at 0 years pro.
  const isRookie = (p: Player) => (p.draft.year ? p.draft.year === cls : !year && p.yearsPro === 0);
  const rookies = d.players
    .filter((p) => isRookie(p) && !p.gone && (t ? p.team === t.id : p.team > 0))
    .sort((a, b) => b.ovr - a.ovr || b.dev - a.dev || a.draft.round - b.draft.round || a.draft.pick - b.draft.pick)
    .slice(0, 10);
  const pick = (p: Player) => (p.draft.round > 0 && p.draft.round < 8 ? `Rd ${p.draft.round}, #${p.draft.pick}` : "Undrafted");
  const lines = rookies.map((p, k) => {
    const team = t ? "" : ` · ${teamOf(d, p.team)?.abbr || "FA"}`;
    const extra = [p.dev ? DEV_LABEL[p.dev] : "", pick(p), p.ps ? "PS" : ""].filter(Boolean).join(" · ");
    return `**${k + 1}.** ${p.pos} [${fullName(p)}](${url(`/players/${p.id}`)})${team} · **${p.ovr}** · ${extra}`;
  });
  return {
    title: `${t ? `${teamLabel(t)}: top` : "Top"}${cls ? ` ${cls}` : ""} ${year && year !== newest ? "draft class" : "rookies"}${t ? "" : " in the league"}`,
    url: t ? url(`/teams/${t.abbr.toLowerCase()}`) : url(),
    color: t ? hexColor(t.primary) : BRAND, footer,
    description: lines.join("\n") || (year ? `No ${year} draft picks on ${t ? `the ${teamLabel(t)}` : "any roster"}.` : t ? `No rookies on the ${teamLabel(t)}.` : "No rookies on any roster yet."),
  };
}

/** pic: when given, the reply is a short caption plus the chart image (/api/discord/matchup) instead of text tables. */
function twsEmbed(d: LeagueData, t: Team, url: Url, footer: Footer, weekNum?: number, pic?: { base: string; slug: string }): Embed {
  let game, bye = false;
  if (weekNum) {
    const wi = weekIndex(weekNum);
    game = gameInWeek(d, t, wi);
    if (!game) return { title: `${teamLabel(t)}: ${weekTitle(d, 1, wi)}`, color: hexColor(t.primary), footer, description: `No ${t.abbr} game that week (a bye, or not scheduled yet).` };
  } else {
    ({ game, bye } = currentGame(d, t));
  }
  if (!game) return { title: `${teamLabel(t)}: no game scheduled`, color: hexColor(t.primary), footer, description: `Nothing left on the ${teamLabel(t)} schedule this season.` };
  const home = teamOf(d, game.home)!, away = teamOf(d, game.away)!;
  const opp = game.home === t.id ? away : home;
  const stats = teamStats(d);
  const ts = stats.get(t.id), os = stats.get(opp.id);
  const wk = weekTitle(d, game.stage, game.week);
  const rec = (x: Team) => `${record(x)}${x.rec.streak ? `, ${streakText(x.rec.streak)}` : ""}`;
  const lines = [
    bye ? `**${t.abbr} has no game this week.** Next up:` : "",
    `**${away.city} ${away.name}** (${rec(away)}) @ **${home.city} ${home.name}** (${rec(home)})`,
    game.final ? `Final: ${away.abbr} ${game.as}, ${home.abbr} ${game.hs}${game.simmed ? " (sim)" : ""} · [box score](${url(`/games/${game.id}`)})` : "",
    [away, home].map((x) => (x.user ? `${x.abbr}: ${x.user}` : `${x.abbr}: CPU`)).join(" · "),
  ].filter(Boolean);
  // Earlier meetings this season.
  const met = d.games.filter((g) => g.final && g.id !== game.id && g.stage === 1 && ((g.home === t.id && g.away === opp.id) || (g.home === opp.id && g.away === t.id)));
  if (met.length) lines.push(`Other meetings: ${met.map((g) => `${teamOf(d, g.away)?.abbr} ${g.as} @ ${teamOf(d, g.home)?.abbr} ${g.hs} (${weekTitle(d, g.stage, g.week)})`).join("; ")}`);
  const embed: Embed = { title: `${wk}: ${t.abbr} vs ${opp.abbr}`, url: url(`/teams/${t.abbr.toLowerCase()}?tab=schedule`), color: hexColor(t.primary), footer, description: lines.join("\n") };
  if (pic) {
    // The chart carries the matchup or box score; the text keeps only what the picture doesn't show.
    const caption = [
      bye ? `**${t.abbr} has no game this week.** Next up:` : "",
      game.final ? `[Box score](${url(`/games/${game.id}`)})` : `[Game page](${url(`/games/${game.id}`)})`,
      met.length ? `Other meetings: ${met.map((g) => `${teamOf(d, g.away)?.abbr} ${g.as} @ ${teamOf(d, g.home)?.abbr} ${g.hs} (${weekTitle(d, g.stage, g.week)})`).join("; ")}` : "",
    ].filter(Boolean);
    if (!game.final) {
      const e = ts && os ? edges(t, ts, opp, os) : [];
      if (e.length) caption.push(e.join("\n"));
    }
    return { ...embed, url: url(`/games/${game.id}`), description: caption.join("\n"), image: { url: matchupImageUrl(pic.base, pic.slug, game.id) } };
  }
  // A finished game: the box score instead of the season matchup.
  if (game.final) {
    const table = gameTable(d, game, away, home);
    embed.url = url(`/games/${game.id}`);
    embed.fields = [
      ...(table ? [{ name: "Team stats", value: table }] : []),
      { name: `${away.abbr} leaders`, value: gameLeaders(d, game, away), inline: true },
      { name: `${home.abbr} leaders`, value: gameLeaders(d, game, home), inline: true },
    ];
    if (!table) embed.fields.unshift({ name: "Team stats", value: "No team stats for this game (simmed games before syncing started can be missing)." });
    return embed;
  }
  if (!ts || !os) return { ...embed, fields: [{ name: "Matchup stats", value: "Not enough games played yet this season." }] };
  const e = edges(t, ts, opp, os);
  embed.fields = [
    { name: `${t.abbr} offense vs ${opp.abbr} defense`, value: sideTable(t, ts, opp, os) },
    { name: `${opp.abbr} offense vs ${t.abbr} defense`, value: sideTable(opp, os, t, ts) },
    ...(e.length ? [{ name: "Biggest mismatches", value: e.join("\n") }] : []),
    { name: "\u200b", value: `-# Per game, ${d.season.year} regular season + playoffs (${t.abbr} ${ts.gp} games, ${opp.abbr} ${os.gp}). #1 = best in the league. Turnovers: given up on offense, forced on defense. Sacks: allowed on offense, made on defense.` },
  ];
  return embed;
}

function statsEmbed(d: LeagueData, cat: StatCat, t: Team | undefined, url: Url, footer: Footer): Embed {
  const { rows, total } = statLeaders(d, cat, t?.id);
  const medal = ["🥇", "🥈", "🥉"];
  const lines = rows.map((r) => {
    const p = r.player;
    const who = p ? `[${fullName(p)}](${url(`/players/${p.id}`)})` : "Unknown player";
    const team = t ? "" : ` · ${teamOf(d, r.team)?.abbr || "FA"}`;
    return `${medal[r.rank - 1] || `\`${String(r.rank).padStart(2)}.\``} ${p?.pos || ""} ${who}${team} · **${r.value}**${r.detail ? ` (${r.detail})` : ""}`;
  });
  const scope = t ? `${t.city} ${t.name}` : "League";
  return {
    title: `${scope} leaders: ${cat.label}`,
    url: url("/leaders"),
    color: t ? hexColor(t.primary) : BRAND,
    footer,
    description: (lines.join("\n") || "Nobody has a stat in this category yet.")
      + `\n\n-# ${d.season.year} regular season${cat.minNote ? ` · minimum ${cat.minNote}` : ""}${total > rows.length ? ` · ${total} players qualify` : ""}`,
  };
}

function standingsEmbed(d: LeagueData, url: Url, footer: Footer): Embed {
  const fields = standings(d).flatMap((c) => c.divisions.map((dv) => ({
    name: dv.div,
    value: dv.teams.map((t) => `\`${t.abbr.padEnd(3)}\` ${record(t)}`).join("\n"),
    inline: true,
  })));
  return { title: "Standings", url: url("/standings"), color: BRAND, footer, fields };
}

function playoffsEmbed(d: LeagueData, url: Url, footer: Footer): Embed {
  const pic = playoffPicture(d);
  const fields = Object.entries(pic.conf).map(([conf, seeds]) => ({
    name: conf,
    value: seeds.slice(0, 7).map((s) => `${s.seed}. ${s.c.abbr} ${recText(s.c.w, s.c.l, s.c.t)}${s.mark ? ` ${s.mark}` : ""}`).join("\n")
      + "\n-# In the hunt: " + (seeds.slice(7, 10).map((s) => `${s.c.abbr} ${recText(s.c.w, s.c.l, s.c.t)}`).join(", ") || "—"),
    inline: true,
  }));
  return {
    title: pic.regularSeasonDone ? "Playoff seeds" : `Playoff picture through week ${pic.throughWeek}`, url: url("/playoffs"), color: BRAND, footer, fields,
    description: "-# * #1 seed · z division · x playoff spot · e eliminated. NFL tiebreakers; tie notes on the site.",
  };
}

function scoresEmbed(d: LeagueData, stage: number, week: number, url: Url, footer: Footer): Embed {
  const games = gamesForWeek(d, stage, week).filter((g) => g.home && g.away);
  const name = (id: number) => teamOf(d, id)?.abbr || "TBD";
  const lines = games.map((g) => {
    if (!g.final) return `${name(g.away)} @ ${name(g.home)} · not played yet`;
    const awayWon = g.as > g.hs;
    const a = `${name(g.away)} ${g.as}`, h = `${name(g.home)} ${g.hs}`;
    return `${awayWon ? `**${a}**` : a} @ ${!awayWon && g.hs !== g.as ? `**${h}**` : h}${g.simmed ? " · sim" : ""}`;
  });
  return { title: `Scores: ${weekTitle(d, stage, week)}`, url: url("/scores"), color: BRAND, footer, description: lines.join("\n") || "No games this week." };
}

/** For scripts/discord/preview.ts: the embeds without Discord or the database. */
export const _preview = { leaguePlayersEmbed, statsEmbed, twsEmbed, playerEmbed, contractEmbed, teamCapEmbed, leagueCapEmbed, teamEmbed, groupEmbed, standingsEmbed, playoffsEmbed, scoresEmbed, autocompletePlayers: searchPlayers };

// ---------- /kickoff: when betting closes on a game (Nick, 2026-11-13) ----------
// The two teams' managers (linked with /connect) or an admin can set it; once it has
// passed only an admin can change it. Every change is kept and shown publicly.
async function kickoff(i: Interaction, lg: LinkedLeague, d: LeagueData, url: (p?: string) => string): Promise<Message> {
  if (!(await marketsShared())) return reply("League betting isn't switched on yet (the commissioner needs to run the markets setup in Supabase).");
  const tv = opt(i, "team");
  const timeRaw = String(opt(i, "time") ?? "").trim();
  const closes = await closeTimes(lg.id, d.season.year);
  const name = (t?: Team) => (t ? `${t.city} ${t.name}` : "TBD");
  const teams = new Map(d.teams.map((t) => [t.id, t]));
  const line = (g: (typeof d.games)[number]) => {
    const c = closes.get(g.id);
    const status = g.final ? "final" : c ? (Date.parse(c.closeAt) <= Date.now() ? `closed ${fmtET(c.closeAt)}` : `closes **${fmtET(c.closeAt)}** (set by ${c.by})`) : "no kickoff set";
    return `${teams.get(g.away)?.abbr ?? "?"} @ ${teams.get(g.home)?.abbr ?? "?"}: ${status}`;
  };
  if (!tv) {
    if (timeRaw) return reply("Pick a team too, e.g. `/kickoff team:Bears time:9pm`.");
    const week = d.games.filter((g) => g.stage === d.season.stage && g.week === d.season.week && g.home && g.away);
    if (!week.length) return reply("No games this week.");
    return reply(`**Kickoffs, ${d.season.title}**\n${week.map(line).join("\n")}\n${url("/markets?cat=games")}`, false);
  }
  const t = findTeam(d, tv);
  if (!t) return reply("No team by that name.");
  const g = teamGameThisWeek(d, t.id);
  const problem = kickoffProblem(d, g);
  if (problem) return reply(problem);
  if (!timeRaw) return reply(line(g!), false);
  const caller = await userForDiscord(userId(i)).catch(() => null);
  const denied = kickoffPermission({
    admin: await isLeagueAdmin(i), userTeam: caller ? await teamsOfUser(lg.id, caller).catch(() => null) : null,
    homeAbbr: teams.get(g!.home)?.abbr || "", awayAbbr: teams.get(g!.away)?.abbr || "", current: closes.get(g!.id),
  });
  if (denied) return reply(caller ? denied : `${denied} If you run one of these teams, link your Discord first with /connect.`);
  const tz = TIMEZONES[String(opt(i, "timezone") ?? "ET")] || TIMEZONES.ET;
  const when = parseKickoff(timeRaw, tz);
  if (!when) return reply("I couldn't read that time. Try `9pm`, `tomorrow 8:30pm`, `sat 7pm`, `in 45m` or `now` (within the next two weeks).");
  const who = i.member?.user || i.user;
  await setCloseTime(lg.id, d.season.year, g!.id, when, { kind: "discord", id: who?.id || "", name: who?.global_name || who?.username || "Discord user" });
  await refreshGame(lg.slug, g!.id).catch(() => {});
  const now = when.getTime() <= Date.now() + 60_000;
  return reply(`${now ? "🔒 Betting is now **closed**" : "⏰ Betting closes"} on **${name(teams.get(g!.away))} at ${name(teams.get(g!.home))}**${now ? "" : ` at **${fmtET(when)}**`} (game and player-prop markets). Set by ${who?.global_name || who?.username}; logged publicly. ${url(`/markets/game-${g!.id}`)}`, false);
}

// ---------- /verifykickoff: an admin checks a finished game's real kickoff (Nick, 2026-11-14) ----------
// Records the verified kickoff and voids every bet (and cancel) on that game placed at or after it.
async function verifyKickoffCmd(i: Interaction, lg: LinkedLeague, d: LeagueData, url: (p?: string) => string): Promise<Message> {
  if (!(await marketsShared())) return reply("League betting isn't switched on yet.");
  const t = findTeam(d, opt(i, "team"));
  if (!t) return reply("No team by that name.");
  const wk = Number(opt(i, "week")) || 0;
  const g = wk ? gameInWeek(d, t, weekIndex(wk))
    : [...d.games].filter((x) => x.stage === 1 && x.final && (x.home === t.id || x.away === t.id)).sort((a, b) => b.week - a.week)[0] || null;
  if (!g) return reply(wk ? "That team has no game that week." : "That team has no finished game yet.");
  const tz = TIMEZONES[String(opt(i, "timezone") ?? "ET")] || TIMEZONES.ET;
  const when = parseKickoffPast(String(opt(i, "time") ?? ""), tz);
  if (!when) return reply("I couldn't read that time. Try `9pm`, `sat 7pm`, `yesterday 8:30pm` or `2h ago` (the real kickoff, in the last 3 weeks).");
  const tickets = Boolean(await ticketsConfig(lg.slug).catch(() => null));
  const who = i.member?.user || i.user;
  const r = await verifyKickoff({ leagueId: lg.id, season: d.season.year, d, book: marketBook(d), gameId: g.id, kickoff: when, tickets, by: { kind: "discord", id: who?.id || "", name: who?.global_name || who?.username || "Admin" } });
  if (!r.ok) return reply(r.error);
  const teams = new Map(d.teams.map((x) => [x.id, x]));
  const game = `${teams.get(g.away)?.abbr} @ ${teams.get(g.home)?.abbr}`;
  if (!r.voided.length) return reply(`✅ Kickoff for **${game}** verified as **${fmtET(when)}**. No bets were placed after it.`, false);
  const names = await memberNames([...new Set(r.voided.map((v) => v.user_id))]);
  const lines = r.voided.slice(0, 15).map((v) => `• ${names.get(v.user_id) || "Member"}: ${v.kind === "buy" ? "bet" : "cancel"} ${Math.round(Number(v.qty))} ${v.side === "yes" ? "Yes" : "No"} (${v.market_key}) at ${fmtET(v.created_at)}`);
  return reply(`⛔ Kickoff for **${game}** verified as **${fmtET(when)}**. Voided ${r.voided.length} bet${r.voided.length === 1 ? "" : "s"} placed after it:\n${lines.join("\n")}${r.voided.length > 15 ? `\n…and ${r.voided.length - 15} more` : ""}\nThe corrections show up in the next payouts report (and in the trade log: ${url("/markets/activity")}).`, false);
}

// ---------- /balance and /bets (Tickets) ----------
/** /tradeblock: the list (team/position filters), or a manager adding/removing one of his players. */
async function tradeBlockCmd(i: Interaction, lg: LinkedLeague, d: LeagueData, footer: Footer): Promise<Message> {
  const action = String(opt(i, "action") ?? "");
  const tv = opt(i, "team"), gv = String(opt(i, "position") ?? "");
  const group = gv ? DISCORD_POS_GROUPS.find((g) => g.key === gv) : undefined;
  if (!action) {
    let t: Team | undefined;
    if (tv != null && tv !== "") { t = findTeam(d, tv); if (!t) return reply("No team by that name."); }
    if (opt(i, "player") != null) return reply("To add or remove a player, pick an action too: `/tradeblock action:Add a player player:<name>`.");
    return { embeds: [tradeBlockEmbed(d, lg.slug, blockStateOf(lg.settings), { teamId: t?.id, group }, footer)] };
  }
  const p = findPlayer(d, opt(i, "player"));
  if (!p) return reply("Pick the player too (start typing his name in the player box).");
  if (!p.team || p.gone) return reply(`${fullName(p)} isn't on a team, so he can't go on the trade block.`);
  const t = teamOf(d, p.team);
  // Same lock as nicknames: the person running his team (EA account linked to their Discord with /connect).
  // Admins can do CPU teams' players, and can take anyone off (cleanup).
  const caller = await userForDiscord(userId(i)).catch(() => null);
  const mine = caller ? await teamsOfUser(lg.id, caller).catch(() => [] as string[]) : [];
  const manager = Boolean(t && mine.some((a) => a.toLowerCase() === t.abbr.toLowerCase()));
  const admin = !manager && (await isLeagueAdmin(i));
  const allowed = manager || (admin && (!t?.user || action === "remove"));
  if (!allowed) {
    return reply(caller
      ? `Only the person running the ${teamLabel(t)} can put their players on or off the trade block.`
      : `Only the person running the ${teamLabel(t)} can do that. If that's you, link your Discord first with /connect.`);
  }
  const who = `<@${userId(i)}>`;
  const r = await setManualBlock(lg, d, p, action === "add", { by: `discord:${userId(i)}`, who, note: String(opt(i, "note") ?? "") });
  return reply(r.ok ? r.text : r.error);
}

async function linkedUser(i: Interaction) {
  const uid = await userForDiscord(userId(i)).catch(() => null);
  return uid;
}
async function balanceCmd(i: Interaction, lg: LinkedLeague): Promise<Message> {
  const cfg = await ticketsConfig(lg.slug).catch(() => null);
  if (!cfg) return reply("This league bets play money on the site, not Tickets.");
  const uid = await linkedUser(i);
  if (!uid) return reply("Link your Discord to your CFM Manager account first: run /connect.");
  const disc = await discordOfUser(uid).catch(() => null);
  try {
    const b = await ticketsAvailable(lg.id, uid, cfg, disc?.id || userId(i));
    const n = (x: number) => Math.round(x).toLocaleString("en-US");
    return reply(`🎟️ **${n(b.available)} Tickets** free to bet\n• UnbelievaBoat balance: ${n(b.ub)}${b.open > 0.5 ? `\n• Older bets not yet taken from UnbelievaBoat: −${n(b.open)}` : ""}\n• Results not added in UnbelievaBoat yet: ${b.pending >= 0 ? "+" : "−"}${n(Math.abs(b.pending))}\nStakes leave UnbelievaBoat when you bet; cancels and cash-outs come straight back; admins add winnings from #previous-week-payouts.`);
  } catch {
    return reply("Couldn't read your Tickets from UnbelievaBoat right now. Try again in a minute.");
  }
}
/** The "🎟️ My bets" button on game channels, #futures and #market-feed ("mkmy"): the same private list as /bets.
 *  (Private replies vanish when you leave the channel, so this is the way back to a Cancel button.) */
export async function myBets(i: Interaction, base: string): Promise<Message> {
  const lg = i.guild_id ? await leagueForGuild(i.guild_id) : null;
  if (!lg) return reply("This server isn't linked to a league (/link).");
  const d = await getLeagueData(lg.slug);
  if (!d) return reply("No league data yet.");
  return betsCmd(i, lg, d, (path = "") => `${base}/l/${lg.slug}${path}`);
}
async function betsCmd(i: Interaction, lg: LinkedLeague, d: LeagueData, url: (p?: string) => string): Promise<Message> {
  const uid = await linkedUser(i);
  if (!uid) return reply("Link your Discord to your CFM Manager account first: run /connect.");
  const tickets = Boolean(await ticketsConfig(lg.slug).catch(() => null));
  const key = bookKey(d.season.year, tickets);
  const { data } = await admin2().from("market_positions").select("market_key, outcome_id, side, qty, cost").eq("league_id", lg.id).eq("season", key).eq("user_id", uid);
  const pos = data || [];
  if (!pos.length) return reply(`You have no open bets. ${url("/markets")}`);
  const view = await marketsForDiscord(lg.slug, marketBook(d), d.season.year, d.season, d);
  const raw = marketBook(d);
  const eco = await economyOf(lg.id).catch(() => undefined);
  const n = (x: number) => (tickets ? `${Math.round(x).toLocaleString("en-US")} Tickets` : `$${x.toFixed(2)}`);
  const lines: string[] = [];
  const buttons: Record<string, unknown>[] = [];
  for (const [ix, p] of pos.slice(0, 20).entries()) {
    const m = view?.book.markets.find((x) => x.key === p.market_key);
    const o = m?.outcomes.find((x) => x.id === p.outcome_id);
    const shut = !m || m.closed || m.settled || o?.state !== "open";
    const rawM = withAwardPlayers(raw, d, [[p.market_key, p.outcome_id]]).markets.find((x) => x.key === p.market_key);
    const ext = (ids: string[]) => withAwardPlayers(raw, d, ids.map((id) => [p.market_key, id] as [string, string])).markets.find((x) => x.key === p.market_key);
    const back = !shut && rawM ? await cancelValue(lg.id, key, rawM, p.outcome_id, p.side, { qty: Number(p.qty), cost: Number(p.cost) }, tickets, ext, eco).catch(() => null) : null;
    const fut = isFutures(p.market_key);
    lines.push(`**${ix + 1}.** ${p.side === "yes" ? "Yes" : "No"} · ${o?.label ?? p.outcome_id} (${m?.title ?? p.market_key}) · ${Math.round(Number(p.qty))} for ${n(Number(p.cost))}${o?.state === "open" ? ` · now ${Math.round((p.side === "yes" ? o.p : 1 - o.p) * 100)}%` : ""}${shut ? " · locked" : back != null ? ` · ${fut ? "cash out" : "cancel"} → ${n(back)}` : ""}`);
    if (!shut && buttons.length < 20) buttons.push({ type: 2, style: 4, label: `${fut ? "Cash out" : "Cancel"} #${ix + 1}`, custom_id: `mkc|${p.market_key}|${p.outcome_id}|${p.side}`.slice(0, 100) });
  }
  const rows = [];
  for (let k = 0; k < buttons.length; k += 5) rows.push({ type: 1, components: buttons.slice(k, k + 5) });
  return {
    content: `**Your open bets**${pos.length > 20 ? ` (first 20 of ${pos.length})` : ""}\n${lines.join("\n")}\nGame and prop bets cancel for what they cost (or what they're worth now, if less) until kickoff. Futures cash out at what they're worth now, less the cash-out fee. ${url("/markets")}`,
    flags: EPHEMERAL,
    components: rows,
  };
}

// ---------- /betcap (Nick, 2026-11-14): per-bet and per-member-per-market caps ----------
async function betCapCmd(i: Interaction, lg: LinkedLeague): Promise<string> {
  const tickets = Boolean(await ticketsConfig(lg.slug).catch(() => null));
  const perBet = opt(i, "per_bet"), perUser = opt(i, "per_user");
  const fmt = (n: number | null) => (n == null ? "no cap" : tickets ? `${n.toLocaleString("en-US")} Tickets` : `$${n.toLocaleString("en-US")}`);
  if (perBet != null || perUser != null) {
    const r = await updateLeagueSettings(lg.id, (settings) => {
      const cur = { ...((settings.betCaps as Record<string, unknown>) || {}) };
      if (perBet != null) cur.perBet = Number(perBet) || null;          // 0 → no cap
      if (perUser != null) cur.perUserWeek = Number(perUser) || null;
      settings.betCaps = cur;
      return settings;
    });
    if (!r.ok) return `Couldn't save that: ${r.error}`;
  }
  const c = await betCaps(lg.id, tickets);
  const who = i.member?.user.global_name || i.member?.user.username || "An admin";
  return `${perBet != null || perUser != null ? `🔒 **${who}** set the bet caps.` : "**Bet caps**"}\n• Per bet: **${fmt(c.perBet)}**\n• Per user per Madden week (all their bets that week; cancels and cash-outs give room back; resets when the league advances): **${fmt(c.perUserWeek)}**\n-# Applies to new bets on the site and in Discord. Change with /betcap per_bet:… per_user:… (0 = no cap).`;
}

// ---------- /economy (Nick, 2026-11-14): house cut, price floor, cash-out fee ----------
async function economyCmd(i: Interaction, lg: LinkedLeague): Promise<string> {
  const cut = opt(i, "cut"), floor = opt(i, "floor"), fee = opt(i, "cashout_fee");
  const changed = cut != null || floor != null || fee != null;
  if (changed) {
    const r = await updateLeagueSettings(lg.id, (settings) => {
      const cur = { ...((settings.economy as Record<string, unknown>) || {}) };
      if (cut != null) cur.cut = Number(cut) / 100;
      if (floor != null) cur.floor = Number(floor) / 100;
      if (fee != null) cur.cashoutFee = Number(fee) / 100;
      settings.economy = cur;
      return settings;
    });
    if (!r.ok) return `Couldn't save that: ${r.error}`;
  }
  const e = await economyOf(lg.id);
  const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
  const who = i.member?.user.global_name || i.member?.user.username || "An admin";
  return `${changed ? `🏦 **${who}** changed the house rules.` : "**House rules**"}
• House cut: **${pct(e.cut)}** of a winning bet's profit (a bet that pays 1,000 on a 400 stake keeps ${Math.round(600 * (1 - e.cut)).toLocaleString("en-US")} of the 600 profit)
• Lowest price: **${pct(e.floor)}**${e.floor > 0 ? ` (a long shot pays at most ${Math.floor(1 / e.floor)}x)` : ""}
• Futures cash-out fee: **${pct(e.cashoutFee)}**
• Always on: nobody can bet on their own game (either team or its props), or against their own team.
-# Change with /economy cut:… floor:… cashout_fee:… (whole percents).`;
}

// /sync (Nick, 2026-11-16): the site's "Sync now" from Discord. Same full pull and the same 15-minute
// cooldown per league (requestSync), so it can't be spammed between the site and the bot. The reply is
// public so the chat sees it, then edited when the run finishes (the worker usually takes 2-4 min; the
// interactions route allows 300 s, so we wait up to ~4.5 min and otherwise leave it at "started").
async function syncCmd(i: Interaction, lg: LinkedLeague, base: string): Promise<Message> {
  const who = i.member?.user || i.user;
  const name = who ? who.global_name || who.username : "someone";
  const url = `${base}/l/${lg.slug}`;
  const r = await requestSync(lg.slug, { minGapMs: MANUAL_COOLDOWN_MS, mode: "full", by: `discord:${who?.id || ""}` });
  if (!r.started) {
    if (r.reason === "recent") {
      const mins = Math.max(1, Math.ceil(((r.nextAt || Date.now()) - Date.now()) / 60_000));
      return reply(`**${lg.name}** synced or was asked to sync in the last 15 minutes. Try again in ${mins} min.`, false);
    }
    if (r.reason === "not-configured") return reply("On-demand syncing isn't set up on the site yet (GITHUB_DISPATCH_TOKEN), so the league syncs on its schedule.", false);
    return reply("Couldn't start the sync. Try again in a few minutes.", false);
  }
  const startedAt = Date.now();
  const started = `🔄 **${lg.name}** sync started by ${name}. Pulling from EA, usually 2–4 minutes…`;
  return {
    content: started,
    followUp: async () => {
      const db = admin2();
      const deadline = startedAt + 270_000;
      while (Date.now() < deadline) {
        await new Promise((res) => setTimeout(res, 15_000));
        const { data: run } = await db.from("sync_runs").select("started_at, finished_at, result")
          .eq("league_id", lg.id).gte("started_at", new Date(startedAt - 5_000).toISOString())
          .order("started_at", { ascending: false }).limit(1).maybeSingle();
        if (!run?.finished_at) continue;
        if (run.result === "failed") return { content: `⚠️ **${lg.name}** sync failed (EA may be down or the login expired). Try again later, or check the league page: ${url}` };
        const secs = Math.round((Date.parse(run.finished_at) - Date.parse(run.started_at)) / 1000);
        return {
          content: run.result === "unchanged"
            ? `✅ **${lg.name}** is up to date: nothing changed in EA since the last sync (${secs}s). ${url}`
            : `✅ **${lg.name}** synced (${secs}s). New data shows on the site within ~2 minutes and in bot commands right after. ${url}`,
        };
      }
      return { content: `${started}\nStill running; the site updates when it's done. ${url}` };
    },
  };
}
