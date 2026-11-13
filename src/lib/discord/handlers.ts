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
import { cardImageUrl } from "./cardLink";
import { currentGame, edges, sideTable, teamStats } from "./matchup";
import { BRAND, EPHEMERAL, hexColor, postToChannel, type Embed, type Message } from "./api";
import { discordOf, leagueBySlug, leagueForGuild, leagueForUser, setDiscord, setUserLeague, type LinkedLeague } from "./links";

export type Option = { name: string; type: number; value?: string | number | boolean; focused?: boolean; options?: Option[] };
export type Interaction = {
  type: number;
  id: string;
  application_id: string;
  token: string;
  guild_id?: string;
  member?: { user: { id: string; username: string }; permissions?: string };
  user?: { id: string; username: string };   // set instead of member in DMs
  context?: number;                           // 0 server, 1 bot DM, 2 group DM / other DM
  data?: { name: string; options?: Option[] };
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
  if (name === "link" || name === "unlink" || name === "notify") {
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
  if (name === "notify") {
    if (via !== "server") return reply("Link this server first with `/link league:<web address>`.");
    return notify(i, lg);
  }

  const d = await getLeagueData(lg.slug);
  if (!d) return reply(`${lg.name} hasn't finished its first sync yet. Try again in a few minutes.`);
  const url = (path = "") => `${base}/l/${lg.slug}${path}`;
  const footer = { text: `${lg.name} · ${d.season.year} ${d.season.title}` };

  switch (name) {
    case "player": {
      const p = findPlayer(d, opt(i, "player"));
      if (!p) return reply("No player by that name. Pick one from the list as you type.");
      const embed = playerEmbed(d, p, url, footer);
      // The full trading card (uploaded art, else the headshot, else the jersey number), shown big.
      embed.image = { url: cardImageUrl(base, lg.slug, p.id) };
      delete embed.thumbnail;
      return { embeds: [embed] };
    }
    case "contract": {
      const p = findPlayer(d, opt(i, "player"));
      return p ? { embeds: [contractEmbed(d, p, url, footer)] } : reply("No player by that name. Pick one from the list as you type.");
    }
    case "cap": {
      const v = opt(i, "team");
      if (v != null && v !== "") {
        const t = findTeam(d, v);
        return t ? { embeds: [teamCapEmbed(d, t, url, footer)] } : reply("No team by that name.");
      }
      return { embeds: [leagueCapEmbed(d, url, footer)] };
    }
    case "team": {
      const t = findTeam(d, opt(i, "team"));
      return t ? { embeds: [teamEmbed(d, t, url, footer)] } : reply("No team by that name.");
    }
    case "tws": {
      const t = findTeam(d, opt(i, "team"));
      return t ? { embeds: [twsEmbed(d, t, url, footer)] } : reply("No team by that name.");
    }
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

function teamCapEmbed(d: LeagueData, t: Team, url: Url, footer: Footer): Embed {
  const pr = teamCapProjection(d, t);
  const roster = teamPlayers(d, t.id);
  const years = pr.totals.map((y, i) => `${y.year}${i ? " proj." : ""}: **${money(y.space)}** space (${money(y.committed)} of ${money(y.cap)}, ${y.players} signed)`);
  const top = pr.rows.slice(0, 5).map((r) => `${fullName(r.p)} (${r.p.pos}) ${money(r.p.contract.capHit)}`);
  const expiring = roster.filter((p) => !p.ps && p.contract.yearsLeft <= 1).sort((a, b) => b.contract.capHit - a.contract.capHit);
  return {
    title: `${teamLabel(t)}: cap`, url: url(`/teams/${t.abbr.toLowerCase()}?tab=cap`), color: hexColor(t.primary), footer,
    fields: [
      { name: "Cap space by year", value: years.join("\n") },
      { name: "Biggest cap hits", value: top.join("\n") || "—", inline: true },
      { name: `Expiring (${expiring.length})`, value: expiring.slice(0, 5).map((p) => `${fullName(p)} ${money(p.contract.capHit)}`).join("\n") || "None", inline: true },
      { name: "Dead money", value: money(inferredDeadCap(t, roster)), inline: true },
    ],
  };
}

function leagueCapEmbed(d: LeagueData, url: Url, footer: Footer): Embed {
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

function twsEmbed(d: LeagueData, t: Team, url: Url, footer: Footer): Embed {
  const { game, bye } = currentGame(d, t);
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
  if (met.length) lines.push(`Earlier: ${met.map((g) => `${teamOf(d, g.away)?.abbr} ${g.as} @ ${teamOf(d, g.home)?.abbr} ${g.hs} (${weekTitle(d, g.stage, g.week)})`).join("; ")}`);
  const embed: Embed = { title: `${wk}: ${t.abbr} vs ${opp.abbr}`, url: url(`/teams/${t.abbr.toLowerCase()}?tab=schedule`), color: hexColor(t.primary), footer, description: lines.join("\n") };
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
