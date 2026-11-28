// The trade block in Discord (Nick, 2026-11-18):
//  - Trades › #trade-block: an open channel (anyone can talk). The bot posts players going on the block
//    (Madden's flag after each sync, or a manager adding one by hand) and coming off it.
//  - /tradeblock [team] [position]: who's on the block, filtered by team and/or position group.
//    /tradeblock action:Add|Remove player:<name> [note]: the team's manager (linked with /connect) or an admin.
// The list itself lives in src/lib/league/tradeBlock.ts so the site and the bot agree.
import type { LeagueData, Player } from "@/lib/league/types";
import { devMark } from "./devEmoji";
import { fullName } from "@/lib/league/derive";
import { money } from "@/lib/league/format";
import { gradePlayers } from "@/lib/league/tradeData";
import { blockRows, cleanBlockNote, entryLive, type BlockEntry, type BlockRow, type TradeBlockState } from "@/lib/league/tradeBlock";
import { updateLeagueSettings } from "@/lib/leagueSettings";
import { hexColor, postToChannel, type Embed, type Message } from "./api";
import type { DiscordPosGroup } from "./posGroups";
import type { LinkedLeague } from "./links";
import type { TradeChannels } from "./tradeChannels";

const APP_URL = (process.env.APP_URL || "https://cfm-manager-delta.vercel.app").replace(/\/$/, "");
export const blockStateOf = (settings: Record<string, unknown> | null | undefined) => (settings?.tradeBlock as TradeBlockState | undefined) || null;

const teamAbbr = (d: LeagueData, id: number) => d.teams.find((t) => t.id === id)?.abbr || "FA";
const yrs = (n: number) => `${n} yr${n === 1 ? "" : "s"}`;

/** One player's line: pos, linked name, team, OVR, UR, dev, age, cap hit and years left. */
export function blockLine(d: LeagueData, p: Player, slug: string, ur?: number, showTeam = true) {
  const c = p.contract;
  return `${p.pos} [${fullName(p)}](${APP_URL}/l/${slug}/players/${p.id})${showTeam ? ` · ${teamAbbr(d, p.team)}` : ""} · **${p.ovr}**`
    + `${ur ? ` · UR ${ur}` : ""}${devMark(p.dev)} · age ${p.age} · ${money(c.capHit)}, ${yrs(c.yearsLeft)} left`
    + `${p.ir ? " · IR" : p.injury > 0 ? ` · inj ${p.injury} wk` : ""}`;
}

const urOf = (d: LeagueData) => gradePlayers(d.players.filter((p) => !p.gone && p.team));

/** /tradeblock [team] [position]: the list. */
export function tradeBlockEmbed(d: LeagueData, slug: string, st: TradeBlockState | null, f: { teamId?: number; group?: DiscordPosGroup }, footer: { text: string }): Embed {
  const ur = urOf(d);
  const team = f.teamId ? d.teams.find((t) => t.id === f.teamId) : undefined;
  let rows = blockRows(d, st);
  if (team) rows = rows.filter((r) => r.p.team === team.id);
  if (f.group) rows = rows.filter((r) => f.group!.positions.includes(r.p.pos));
  const what = [team ? `${team.city} ${team.name}` : "", f.group?.label || ""].filter(Boolean).join(": ");
  const title = `Trade block${what ? `: ${what}` : ""}`;
  const src = (r: BlockRow) => (r.manual ? `-# 📝 ${r.manual.note ? `"${r.manual.note}"` : "added by his manager"}${r.madden ? " · also on Madden's block" : ""}` : "");
  const lines = rows.map((r) => [blockLine(d, r.p, slug, ur.get(r.p.id)?.ur, !team), src(r)].filter(Boolean).join("\n"));
  let desc = "";
  let shown = 0;
  for (const l of lines) {
    if (desc.length + l.length + 40 > 3900) break;
    desc += (desc ? "\n" : "") + l;
    shown++;
  }
  if (shown < lines.length) desc += `\n…and ${lines.length - shown} more`;
  if (!rows.length) {
    desc = `Nobody${what ? ` (${what})` : ""} is on the trade block right now.`
      + (d.blockKey ? "" : "\n-# Madden's own trade block isn't in EA's data for this league, so only players added by their managers show here.");
  }
  desc += `\n\n-# Managers: \`/tradeblock action:Add player:<name>\` to put one of yours on it (link your Discord with /connect first).`;
  return { title, url: `${APP_URL}/l/${slug}/trades${team ? `?a=${team.abbr}` : ""}`, color: hexColor(team?.primary), footer, description: desc };
}

/** The #trade-block post for players going on (or coming off) the block. */
function blockPost(d: LeagueData, slug: string, kind: "on" | "off", items: { p: Player; note?: string; by?: string; moved?: boolean }[], from: "madden" | "manual"): Message[] {
  if (!items.length) return [];
  const ur = urOf(d);
  const lines = items.map(({ p, note, by, moved }) => {
    if (kind === "off") {
      const where = moved ? (p.team ? ` · now on ${teamAbbr(d, p.team)}` : " · no longer on the team") : "";
      return `~~${p.pos} ${fullName(p)}~~ · ${p.ovr} OVR${where}`;
    }
    return blockLine(d, p, slug, ur.get(p.id)?.ur) + (note ? `\n-# 📝 "${note}"` : "") + (by ? `\n-# added by ${by}` : "");
  });
  const out: Message[] = [];
  for (let k = 0; k < lines.length; k += 15) {
    const chunk = lines.slice(k, k + 15);
    const head = kind === "on"
      ? (from === "madden" ? `📣 On the trade block in Madden` : `📣 On the trade block`)
      : (from === "madden" ? `Off the trade block in Madden` : `Off the trade block`);
    const solo = items.length === 1 ? items[0].p : null;
    const color = solo ? hexColor(d.teams.find((t) => t.id === solo.team)?.primary) : 0xf2c200;
    out.push({ embeds: [{ title: k ? `${head} (cont.)` : head, color: kind === "off" ? 0x6b7280 : color, description: chunk.join("\n") }], allowed_mentions: { parse: [] } });
  }
  return out;
}

export const maddenBlockPosts = (d: LeagueData, slug: string, on: Player[], off: { p: Player; moved: boolean }[]) =>
  [...blockPost(d, slug, "on", on.map((p) => ({ p })), "madden"), ...blockPost(d, slug, "off", off, "madden")];

/** Adds or removes a player by hand, then posts it in #trade-block. `who` is how the post names the person. */
export async function setManualBlock(lg: LinkedLeague, d: LeagueData, p: Player, on: boolean, o: { by: string; who: string; note?: string }): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  if (on && (!p.team || p.gone)) return { ok: false, error: "Only players on a team can go on the trade block." };
  const note = cleanBlockNote(o.note);
  const key = String(p.id);
  let changed = false;
  const r = await updateLeagueSettings(lg.id, (s) => {
    const st = { ...((s.tradeBlock as TradeBlockState | undefined) || {}) };
    const manual = { ...(st.manual || {}) };
    // Drop entries for players who've since moved, so the list doesn't grow forever.
    for (const [id, e] of Object.entries(manual)) {
      const x = d.players.find((y) => String(y.id) === id);
      if (!entryLive(x, e)) delete manual[id];
    }
    if (on) {
      const prevNote = manual[key]?.note;
      changed = !manual[key] || prevNote !== (note || undefined);
      manual[key] = { team: p.team, by: o.by, at: new Date().toISOString(), ...(note ? { note } : {}) } satisfies BlockEntry;
    } else if (manual[key]) {
      delete manual[key];
      changed = true;
    }
    st.manual = manual;
    s.tradeBlock = st;
    return s;
  });
  if (!r.ok) return { ok: false, error: "Couldn't save that. Try again." };
  const name = `${p.pos} ${fullName(p)} (${teamAbbr(d, p.team)})`;
  if (!on && !changed) {
    return p.block
      ? { ok: false, error: `${name} is on the block in Madden itself. Take him off there and he drops off here after the next sync.` }
      : { ok: false, error: `${name} isn't on the trade block.` };
  }
  // Post it (not when only re-saving the same thing, and not "off" while Madden still lists him).
  const chan = (lg.settings?.tradeChannels as TradeChannels | undefined)?.blockId;
  const token = process.env.DISCORD_BOT_TOKEN;
  let posted = "";
  if (changed && chan && token && (on || !p.block)) {
    const msgs = blockPost(d, lg.slug, on ? "on" : "off", [{ p, note: note || undefined, by: o.who }], "manual");
    for (const m of msgs) {
      const err = await postToChannel(token, chan, m).catch((e) => (e as Error).message);
      if (err) { posted = ` (Couldn't post in #trade-block: ${err})`; break; }
    }
    if (!posted) posted = ` Posted in <#${chan}>.`;
  }
  const extra = !on && p.block ? " He's still on Madden's own trade block, so he stays listed until he's off it in Madden." : "";
  return { ok: true, text: `${on ? (changed ? "Added" : "Already on the block:") : "Removed"} ${name}${on && note ? ` with the note "${note}"` : ""}.${posted}${extra}` };
}
