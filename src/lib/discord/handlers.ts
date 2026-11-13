// What each slash command answers. Everything reads the same league data file
// and helpers the website uses, so the bot and the site always agree.
import { getLeagueData } from "@/lib/league/load";
import type { LeagueData, Player, Team } from "@/lib/league/types";
import { DEV_LABEL } from "@/lib/league/types";
import {
  capYears, fullName, gamesForWeek, inferredDeadCap, record, seasonTotals, standings, streakText,
  teamCapProjection, teamPlayers, weekTitle, defaultScoresWeek,
} from "@/lib/league/derive";
import { money } from "@/lib/league/format";
import { projectPlayer } from "@/lib/league/projection";
import { playoffPicture, recText } from "@/lib/league/playoffs";
import { recommend, type MarketPlayer } from "@/lib/league/recommend";
import { headshotUrl } from "@/lib/league/headshots";
import { cardImageUrl, packImageUrl } from "./cardLink";
import { ODDS, PACK_SIZE, RARITY, cardPoints, luckLabel, openPack, packHits, recordTopPack } from "./packs";
import { loadPackStats, savePackStats } from "./packStore";
import { currentGame, edges, gameInWeek, gameLeaders, gameTable, sideTable, teamStats, weekIndex } from "./matchup";
import { ALERT_EVENTS, BRAND, EPHEMERAL, MAX_VIDEO_BYTES, appOwnerIds, hexColor, postToChannel, type AlertEvent, type Embed, type Message } from "./api";
import { supabaseAdmin } from "@/lib/supabase/server";
import { discordOf, leagueBySlug, leagueForGuild, leagueForUser, setDiscord, setUserLeague, type LinkedLeague } from "./links";

export type Option = { name: string; type: number; value?: string | number | boolean; focused?: boolean; options?: Option[] };
export type Interaction = {
  type: number;
  id: string;
  application_id: string;
  token: string;
  guild_id?: string;
  member?: { user: { id: string; username: string; global_name?: string | null }; permissions?: string };
  user?: { id: string; username: string; global_name?: string | null };   // set instead of member in DMs
  context?: number;                           // 0 server, 1 bot DM, 2 group DM / other DM
  data?: { name: string; options?: Option[]; resolved?: { attachments?: Record<string, { url: string; filename: string; size: number; content_type?: string }> } };
};

const userId = (i: Interaction) => i.member?.user.id || i.user?.id || "";

/** The server's league if this server is linked, otherwise the person's own league (/myleague). */
async function resolveLeague(i: Interaction): Promise<{ lg: LinkedLeague; via: "server" | "user" } | null> {
  if (i.guild_id) {
    const lg = await leagueForGuild(i.guild_id);
    if (lg) return { lg, via: "server" };
  }
  const uid = userId(i);
  const lg = uid ? await leagueForUser(uid) : null;
  return lg ? { lg, via: "user" } : null;
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
    const full = norm(`${p.first} ${p.last}`), last = norm(p.last);
    const s = full === n ? 0 : last === n ? 1 : full.startsWith(n) ? 2 : last.startsWith(n) ? 3 : full.includes(n) ? 4 : -1;
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

// ---------- autocomplete ----------

export async function autocomplete(i: Interaction): Promise<{ name: string; value: string }[]> {
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
    name: `${p.first} ${p.last} · ${p.pos} · ${p.ovr} OVR · ${teamOf(d, p.team)?.abbr || "FA"}`.slice(0, 100),
    value: String(p.id),
  }));
}

// ---------- commands ----------

export async function runCommand(i: Interaction, base: string): Promise<Message> {
  const name = i.data?.name || "";
  if (name === "myleague") return myLeague(i, base);
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
    case "tws": {
      const t = findTeam(d, opt(i, "team"));
      if (!t) return reply("No team by that name.");
      const w = Number(opt(i, "week")) || 0;
      return { embeds: [twsEmbed(d, t, url, footer, w || undefined)] };
    }
    case "pack": return openPackReply(i, lg, d, base, url, footer);
    case "packs": return { embeds: [await packsLeaderboard(i, lg, d, footer)] };
    case "standings": return { embeds: [standingsEmbed(d, url, footer)] };
    case "playoffs": return { embeds: [playoffsEmbed(d, url, footer)] };
    case "scores": {
      const w = Number(opt(i, "week"));
      const pick = w ? { stage: 1, week: w - 1 } : defaultScoresWeek(d);
      return { embeds: [scoresEmbed(d, pick.stage, pick.week, url, footer)] };
    }
    case "league": {
      const ch = via === "server" ? discordOf(lg)?.channelId : null;
      return {
        embeds: [{
          title: lg.name, url: url(), color: BRAND, footer,
          description: [
            `**${d.season.year} ${d.season.title}** · data from ${new Date(d.pulledAt).toUTCString().replace(" GMT", " UTC")}`,
            `[Standings](${url("/standings")}) · [Cap](${url("/cap")}) · [Contract tool](${url("/contracts")}) · [Playoffs](${url("/playoffs")}) · [Draft](${url("/draft")})`,
            via === "user" ? "This is your league (`/myleague`)." : ch ? `This server's league. Updates post in <#${ch}>.` : "This server's league. Updates aren't posting anywhere yet (`/notify`).",
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
  const current = await leagueForGuild(i.guild_id!);
  if (current && current.id !== lg.id) await setDiscord(current.id, null);
  // If the league was linked to another server, it moves here (and that server's update channel is dropped).
  const prev = discordOf(lg);
  const keepChannel = prev && prev.guildId === i.guild_id ? prev.channelId ?? null : null;
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
      embeds: [{ color: BRAND, title: `${lg.name} updates will post here`, description: "After each sync: league advances, final scores, signings, releases, trades, extensions, and teams over the cap." }],
    });
    if (err) return reply(err);
  }
  await setDiscord(lg.id, { ...cur, channelId: String(channel) });
  return reply(`Updates for **${lg.name}** will post in <#${channel}>.`);
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
  const pr = projectPlayer(p, d.season.year);
  const ys = capYears(d).filter((y) => pr.hits[y] != null || pr.dead[y]);
  if (!ys.length) return "";
  const rows = ys.map((y) => `${y}: **${money(pr.hits[y] ?? 0)}**${pr.dead[y] ? ` (+${money(pr.dead[y])} void)` : ""}`);
  const how = pr.source === "formula" ? "Future years are projected from his deal." : "Future years follow his real NFL contract.";
  return `${rows.join("\n")}\n-# ${how}`;
}

function playerEmbed(d: LeagueData, p: Player, url: Url, footer: Footer): Embed {
  const t = teamOf(d, p.team);
  const c = p.contract;
  const flags = [p.ps && "Practice squad", p.ir && "IR", p.injury > 0 && `Injured (${p.injury} wk)`].filter(Boolean).join(" · ");
  const fields: Embed["fields"] = [];
  if (c.length && p.team) {
    fields.push({ name: "Contract", value: `${c.length} yrs, ${money(c.salary + c.bonus)} (${money(c.bonus)} bonus)\n${c.yearsLeft} year${c.yearsLeft === 1 ? "" : "s"} left`, inline: true });
    fields.push({ name: `${d.season.year} cap hit`, value: `**${money(c.capHit)}**\nCut: saves ${money(c.releaseSavings)}, ${money(c.releasePenalty)} dead`, inline: true });
    const cy = capByYear(d, p);
    if (cy) fields.push({ name: "Cap hit by year", value: cy });
  } else if (p.desired?.salary) {
    fields.push({ name: "Asking", value: `${p.desired.length} yr${p.desired.length === 1 ? "" : "s"}, ${money(p.desired.salary)} salary + ${money(p.desired.bonus)} bonus`, inline: true });
  }
  const s = statLine(d, p);
  if (s) fields.push({ name: `${d.season.year} regular season`, value: s });
  if (p.abilities.length) fields.push({ name: "Abilities", value: p.abilities.map((a) => `${a.title} (${a.tier})`).join(", ") });
  const img = headshotUrl(p);
  return {
    title: fullName(p), url: url(`/players/${p.id}`), color: hexColor(t?.primary), footer,
    description: [`**${p.pos} · ${teamLabel(t)}**${p.jersey ? ` · #${p.jersey}` : ""}`, `${p.ovr} OVR · ${DEV_LABEL[p.dev]} · Age ${p.age} · ${p.yearsPro ? `${p.yearsPro} yrs pro` : "Rookie"}`, flags].filter(Boolean).join("\n"),
    fields,
    thumbnail: img ? { url: img } : undefined,
  };
}

function contractEmbed(d: LeagueData, p: Player, url: Url, footer: Footer): Embed {
  const market: MarketPlayer[] = d.players.filter((x) => !x.gone).map((x) => ({
    id: x.id, n: fullName(x), pos: x.pos, t: x.team, age: x.age, ovr: x.ovr, ps: x.ps, yp: x.yearsPro,
    c: [x.contract.length, x.contract.yearsLeft, x.contract.salary, x.contract.bonus, x.contract.capHit],
  }));
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
function teamCapEmbed(d: LeagueData, t: Team, url: Url, footer: Footer, year = d.season.year): { embed: Embed; over: boolean } {
  const pr = teamCapProjection(d, t);
  const roster = teamPlayers(d, t.id);
  const focus = pr.totals.find((y) => y.year === year) || pr.totals[0];
  const now = focus.year === d.season.year;
  const over = focus.space < 0;
  const years = pr.totals.map((y, i) => {
    const row = `${y.year}${i ? " proj." : ""}: **${money(y.space)}** space (${money(y.committed)} of ${money(y.cap)}, ${y.players} signed)`;
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
  const label = `${focus.year}${now ? "" : " (projected)"}`;
  const embed: Embed = {
    title: `${teamLabel(t)}: ${label} cap`, url: url(`/teams/${t.abbr.toLowerCase()}?tab=cap`), color: over ? 0xff4d63 : hexColor(t.primary), footer,
    description: over
      ? `🚨 **${money(focus.space)}** in ${label}. That's ${money(-focus.space)} over a ${money(focus.cap)} cap with ${focus.players} players signed.`
      : `**${money(focus.space)}** in space for ${label} (${money(focus.committed)} of ${money(focus.cap)}, ${focus.players} players signed).`,
    fields: [
      { name: "Cap space by year", value: years.join("\n") + (now ? "" : "\n-# Future years are projected from current contracts against a cap $15M higher each season.") },
      { name: `Biggest cap hits, ${focus.year}`, value: hits.join("\n") || "—", inline: true },
      { name: `Expiring after ${focus.year} (${expiring.length})`, value: expiring.slice(0, 5).map((p) => `${fullName(p)}${now ? ` ${money(p.contract.capHit)}` : ""}`).join("\n") || "None", inline: true },
      ...(now ? [{ name: "Dead money", value: money(inferredDeadCap(t, roster)), inline: true }] : []),
    ],
  };
  return { embed, over };
}

function leagueCapEmbed(d: LeagueData, url: Url, footer: Footer, year = d.season.year): Embed {
  if (year !== d.season.year) {
    // One future season: every team's projected space, most room first.
    const rows = d.teams.map((t) => ({ t, y: teamCapProjection(d, t).totals.find((x) => x.year === year)! })).sort((a, b) => b.y.space - a.y.space);
    const line = (r: (typeof rows)[number]) => `\`${r.t.abbr.padEnd(3)}\` ${money(r.y.space)} · ${r.y.players} signed`;
    const over = rows.filter((r) => r.y.space < 0);
    return {
      title: `${year} cap space (projected)`, url: url(`/cap?year=${year}`), color: BRAND, footer,
      fields: [
        { name: "Most room", value: rows.slice(0, 8).map(line).join("\n") },
        { name: "Least room", value: rows.slice(-8).map(line).join("\n") },
        ...(over.length ? [{ name: `Over the cap in ${year}`, value: over.map((r) => `${teamLabel(r.t)} (${money(r.y.space)})`).join("\n") }] : []),
        { name: "\u200b", value: "-# Projected from current contracts against a cap $15M higher each season." },
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

function twsEmbed(d: LeagueData, t: Team, url: Url, footer: Footer, weekNum?: number): Embed {
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
export const _preview = { twsEmbed, playerEmbed, contractEmbed, teamCapEmbed, leagueCapEmbed, teamEmbed, standingsEmbed, playoffsEmbed, scoresEmbed, autocompletePlayers: searchPlayers };
