// Trades in Discord (Nick, 2026-11-17). A "Trades" category with three channels:
//  - #trade-proposals (only the bot posts): two managers agree, one enters the trade in the site's
//    Trade Tool and hits Submit; the bot posts it with the trade picture (tradeImage.tsx) and
//    Approve / Reject buttons. Only league admins (the server's "admin" role, isLeagueAdmin) can vote.
//    3 approvals passes it; 3 rejections turns it down. Votes can be changed until then.
//  - #trade-approvals (anyone can talk): the bot reposts each approved trade there.
//  - #trade-transactions (only the bot posts): when a trade shows up in a sync, the worker posts the
//    Madden transaction (tradeTransactions.ts), linked to the approved proposal it matches.
//
// Made by /tradechannels (admins), or on the first submit if missing.
// State: leagues.settings.tradeChannels (TradeChannels below).
import { updateLeagueSettings } from "@/lib/leagueSettings";
import { getLeagueData } from "@/lib/league/load";
import { buildTradeData, parseTrade } from "@/lib/league/tradeData";
import { pickSpotText, ROUND, scoreTrade, type Pick } from "@/lib/league/tradeMath";
import { money } from "@/lib/league/format";
import { discordOf, leagueBySlug, leagueForGuild, type LinkedLeague } from "./links";
import { hexColor, type Embed } from "./api";
import { channelGone, dc } from "./rest";
import { renderTrade } from "./tradeImage";
import { teamRoles } from "./gameChannels";
import { isLeagueAdmin } from "./admin";
import type { ComponentInteraction } from "./marketButtons";

const API = "https://discord.com/api/v10";
const APP_URL = (process.env.APP_URL || "https://cfm-manager-delta.vercel.app").replace(/\/$/, "");
/** Admin votes that decide a trade (Nick: "once 3/5 admins approve a trade it passes"). */
export const VOTES_NEEDED = 3;
const KEEP_PROPOSALS = 60;

export type TradeProposal = {
  id: string; at: string; query: Record<string, string>;
  a: string; b: string;                       // team abbreviations
  pa: number[]; pb: number[];                 // players each side sends
  by: string;                                 // submitter: Discord id, or a name
  picks?: { a: string[]; b: string[] };       // picks each side sends, with their spot ("2028 1st round pick (#23, 23rd overall …)")
  messageId: string | null;
  yes: string[]; no: string[];                // Discord ids of the admins who voted
  status: "open" | "approved" | "rejected";
  decidedAt?: string;
  approvalUrl?: string;                       // link to the #trade-approvals post
};
export type TradeChannels = {
  categoryId: string;
  channelId: string;                          // #trade-proposals
  approvalsId?: string;                       // #trade-approvals
  transactionsId?: string;                    // #trade-transactions
  recent?: Record<string, string>;
  proposals?: Record<string, TradeProposal>;
};

const stateOf = (lg: LinkedLeague) => (lg.settings?.tradeChannels as TradeChannels | undefined) || null;

// Permission bits
const bit = (n: number) => BigInt(2) ** BigInt(n);
const VIEW = bit(10), SEND = bit(11), EMBED = bit(14), ATTACH = bit(15), HISTORY = bit(16);
const PUB_THREADS = bit(35), PRIV_THREADS = bit(36), THREAD_SEND = bit(38);

let botId: string | null = null;
async function botUserId() {
  if (botId) return botId;
  const r = await dc("GET", "/users/@me");
  botId = r.ok ? String(r.data.id) : null;
  return botId;
}
/** The bot's server-wide permissions (roles + @everyone), or null if Discord won't say. */
async function botGuildPerms(guildId: string): Promise<bigint | null> {
  const me = await botUserId();
  if (!me) return null;
  const [member, roles] = await Promise.all([dc("GET", `/guilds/${guildId}/members/${me}`), dc("GET", `/guilds/${guildId}/roles`)]);
  if (!member.ok || !roles.ok || !Array.isArray(roles.data)) return null;
  const mine = new Set([guildId, ...((member.data.roles as string[]) || [])]);
  let p = BigInt(0);
  for (const r of roles.data as unknown as { id: string; permissions: string }[]) if (mine.has(r.id)) p |= BigInt(r.permissions);
  if (p & bit(3)) return ~BigInt(0); // Administrator
  return p;
}

/** Read-only for everyone (no messages, no threads); the bot can post.
 *  Discord refuses an overwrite that allows or denies a permission the bot doesn't have itself
 *  (403 Missing Permissions), so only the bits the bot holds are included. */
export async function botOnly(guildId: string) {
  const me = await botUserId();
  const has = (await botGuildPerms(guildId)) ?? ~BigInt(0);
  const deny = (SEND | PUB_THREADS | PRIV_THREADS | THREAD_SEND) & has;
  const allow = (VIEW | SEND | EMBED | ATTACH | HISTORY) & has;
  return [
    { id: guildId, type: 0, deny: String(deny), allow: "0" },
    ...(me ? [{ id: me, type: 1, allow: String(allow), deny: "0" }] : []),
  ];
}
/** The smallest lock: @everyone can't send, the bot can view and send. A fallback when the full one is refused. */
async function minimalLock(guildId: string) {
  const me = await botUserId();
  return [
    { id: guildId, type: 0, deny: String(SEND), allow: "0" },
    ...(me ? [{ id: me, type: 1, allow: String(VIEW | SEND), deny: "0" }] : []),
  ];
}
/** Makes a text channel, locked if asked. Falls back to a smaller lock, then to unlocked, when Discord refuses. */
export async function makeChannel(guildId: string, body: Record<string, unknown>, lock: unknown[] | null) {
  let r = await dc("POST", `/guilds/${guildId}/channels`, { ...body, ...(lock ? { permission_overwrites: lock } : {}) });
  if (r.ok || !lock || r.status !== 403) return { ...r, unlocked: false };
  r = await dc("POST", `/guilds/${guildId}/channels`, { ...body, permission_overwrites: await minimalLock(guildId) });
  if (r.ok) return { ...r, unlocked: false };
  r = await dc("POST", `/guilds/${guildId}/channels`, body);
  return { ...r, unlocked: r.ok };
}
const why = (r: { data: Record<string, unknown> }) => (r.data?.message ? ` (Discord: ${String(r.data.message)})` : "");

/** Makes (or finds again) the Trades category and its three channels. Returns the state or an error. */
export async function ensureTradeChannels(lg: LinkedLeague): Promise<(TradeChannels & { unlocked?: string[] }) | string> {
  const guildId = discordOf(lg)?.guildId;
  if (!guildId) return "This league isn't linked to a Discord server yet (an admin runs /link there).";
  const old = stateOf(lg);
  let moved = false;
  if (old?.approvalsId && old.transactionsId) {
    // Saved channels from another server (the league was /linked somewhere new) don't count.
    const c = await dc("GET", `/channels/${old.categoryId}`);
    const here = c.ok && String(c.data.guild_id) === guildId;
    const gone = !here ? [true] : await Promise.all([old.categoryId, old.channelId, old.approvalsId, old.transactionsId].map((id) => channelGone(id)));
    if (!gone.some(Boolean)) return old;
    if (!here) { moved = true; old.recent = undefined; old.proposals = undefined; }
  }
  const list = await dc("GET", `/guilds/${guildId}/channels`);
  const chans = (Array.isArray(list.data) ? list.data : []) as unknown as { id: string; name: string; type: number; parent_id?: string }[];
  let cat = chans.find((c) => c.type === 4 && c.name.toLowerCase() === "trades")?.id;
  if (!cat) {
    const r = await dc("POST", `/guilds/${guildId}/channels`, { name: "Trades", type: 4 });
    if (!r.ok) return r.status === 403 ? "The bot needs the Manage Channels permission in the server to make the Trades category." : `Discord said ${r.status}: ${String(r.data.message || "")}`;
    cat = String(r.data.id);
  }
  const locked = await botOnly(guildId);
  const want: { key: "channelId" | "approvalsId" | "transactionsId"; name: string; topic: string; lock: boolean }[] = [
    { key: "channelId", name: "trade-proposals", lock: true, topic: "Agreed trades from the CFM Manager Trade Tool. Admins vote with the buttons; 3 approvals passes a trade." },
    { key: "approvalsId", name: "trade-approvals", lock: false, topic: "Trades the admins approved. Talk about them here." },
    { key: "transactionsId", name: "trade-transactions", lock: true, topic: "Trades as they happened in Madden, posted after each sync." },
  ];
  const state: TradeChannels = { categoryId: cat, channelId: "", recent: old?.recent, proposals: old?.proposals };
  const unlocked: string[] = [];
  for (const w of want) {
    const found = chans.find((c) => c.type === 0 && c.parent_id === cat && c.name === w.name)?.id;
    if (found) {
      if (w.lock) {
        // An older #trade-proposals was open to everyone: lock it (needs Manage Roles).
        const r = await dc("PATCH", `/channels/${found}`, { permission_overwrites: locked, topic: w.topic });
        if (!r.ok && r.status === 403) return `I couldn't make #${w.name} bot-only${why(r)}. Give the bot the Manage Roles permission, or turn off Send Messages for @everyone in that channel yourself, then run /tradechannels again.`;
      }
      state[w.key] = found;
      continue;
    }
    const r = await makeChannel(guildId, { name: w.name, type: 0, parent_id: cat, topic: w.topic }, w.lock ? locked : null);
    if (!r.ok) return r.status === 403 ? `The bot couldn't make #${w.name}: it needs Manage Channels, and View Channels in the Trades category${why(r)}.` : `Discord said ${r.status} making #${w.name}${why(r)}.`;
    if (r.unlocked) unlocked.push(w.name);
    state[w.key] = String(r.data.id);
  }
  await updateLeagueSettings(lg.id, (s) => {
    const cur = (s.tradeChannels as TradeChannels | undefined) || {};
    s.tradeChannels = moved ? state : { ...cur, ...state, recent: (cur as TradeChannels).recent, proposals: (cur as TradeChannels).proposals };
    return s;
  });
  return unlocked.length ? { ...state, unlocked } : state;
}

/** /tradechannels: make the category; action remove deletes it. */
export async function tradeChannelsCmd(slug: string, remove: boolean): Promise<string> {
  const lg = await leagueBySlug(slug);
  if (!lg) return "This league isn't linked to a Discord server (/link).";
  if (remove) {
    const st = stateOf(lg);
    if (!st) return "There's no Trades category to remove.";
    for (const id of [st.channelId, st.approvalsId, st.transactionsId, st.categoryId]) if (id) await dc("DELETE", `/channels/${id}`);
    await updateLeagueSettings(lg.id, (s) => { delete s.tradeChannels; return s; });
    return "Trades category removed. Run /tradechannels again any time to bring it back.";
  }
  const st = await ensureTradeChannels(lg);
  if (typeof st === "string") return st;
  return [
    `Trades category ready:`,
    `• <#${st.channelId}>: agreed trades from the Trade Tool (${APP_URL}/l/${slug}/trades). Only the bot posts; admins vote with the buttons, ${VOTES_NEEDED} approvals passes a trade.`,
    `• <#${st.approvalsId}>: approved trades, open for everyone to talk.`,
    `• <#${st.transactionsId}>: trades as they happened in Madden, after each sync. Only the bot posts.`,
    ...(st.unlocked?.length ? [`⚠️ Discord wouldn't let me make ${st.unlocked.map((n) => `#${n}`).join(" and ")} bot-only, so anyone can type there for now. Give the CFM Manager role Manage Roles (or Administrator) and run /tradechannels again.`] : []),
  ].join("\n");
}

// ---------------------------------------------------------------- the proposal post

const voters = (ids: string[]) => (ids.length ? ids.map((id) => `<@${id}>`).join(" ") : "none yet");
function voteField(p: TradeProposal) {
  const head = p.status === "approved" ? "✅ **Approved**" : p.status === "rejected" ? "❌ **Rejected**" : `Needs ${VOTES_NEEDED} admin approvals`;
  return { name: "Admin votes", value: `${head}\n✅ ${p.yes.length}/${VOTES_NEEDED}: ${voters(p.yes)}\n❌ ${p.no.length}/${VOTES_NEEDED}: ${voters(p.no)}${p.approvalUrl ? `\n[Approval post](${p.approvalUrl})` : ""}` };
}
function voteButtons(slug: string, p: TradeProposal) {
  const done = p.status !== "open";
  return [{
    type: 1, components: [
      { type: 2, style: 3, label: `Approve (${p.yes.length}/${VOTES_NEEDED})`, emoji: { name: "✅" }, custom_id: `tv|${slug}|${p.id}|y`, disabled: done },
      { type: 2, style: 4, label: `Reject (${p.no.length}/${VOTES_NEEDED})`, emoji: { name: "❌" }, custom_id: `tv|${slug}|${p.id}|n`, disabled: done },
    ],
  }];
}

/**
 * Posts a trade from the Trade Tool (query: a, b, pa, pb, ka, kb as in the tool's URL) in #trade-proposals.
 * `by`: who submitted it (Discord id if linked, else their name). Throws with a user-facing reason.
 */
export async function postTradeProposal(slug: string, query: Record<string, string>, by: { discordId?: string; name: string }) {
  const lg = await leagueBySlug(slug);
  if (!lg || !discordOf(lg)?.guildId) throw new Error("This league isn't linked to a Discord server yet. An admin runs /link in the league's server first.");
  const d = await getLeagueData(slug);
  if (!d) throw new Error("No league data yet.");
  const td = buildTradeData(d);
  const { a, b } = parseTrade(td, query);
  if (!a.team || !b.team || a.team === b.team) throw new Error("Pick two different teams.");
  if (!a.players.length && !a.picks.length && !b.players.length && !b.picks.length) throw new Error("Add what each team sends first.");
  const s = scoreTrade({ players: td.players, teams: td.teams, years: td.years, firstDraft: td.firstDraft, a, b, orderFinal: td.orderFinal });
  if (!s) throw new Error("Couldn't score that trade.");

  // The same trade twice within 10 minutes is a double tap.
  const key = [query.a, query.b, a.players.join(","), b.players.join(","), a.picks.map((k) => `${k.y}-${k.r}-${k.s ?? ""}`).join(","), b.picks.map((k) => `${k.y}-${k.r}-${k.s ?? ""}`).join(",")].join("|");
  const prev = stateOf(lg)?.recent?.[key];
  if (prev && Date.now() - Date.parse(prev) < 10 * 60_000) throw new Error("This exact trade was just posted.");

  const st = await ensureTradeChannels(lg);
  if (typeof st === "string") throw new Error(st);

  const ta = d.teams.find((t) => t.id === a.team)!, tb = d.teams.find((t) => t.id === b.team)!;
  const img = await renderTrade(d, s, td.players, lg.name || slug.toUpperCase());
  const png = Buffer.from(await img.arrayBuffer());

  const roles = await teamRoles(discordOf(lg)!.guildId, d.teams).catch(() => new Map<number, string>());
  const tag = (t: typeof ta) => (roles.get(t.id) ? `<@&${roles.get(t.id)}>` : `**${t.name}**`);
  const byId = new Map(td.players.map((p) => [p.id, p]));
  const ownerOf = new Map(td.teams.map((t) => [t.id, t]));
  const pickText = (k: Pick, from: number) => `${k.y} ${ROUND[k.r]} round pick · ${pickSpotText(k, ownerOf.get(from) || { slot: 16 }, td.firstDraft, td.orderFinal)}`;
  const list = (ids: number[], picks: Pick[], from: number) =>
    [...ids.map((id) => { const p = byId.get(id)!; return `${p.pos} ${p.n} (${p.ovr} OVR, ${p.ur} UR, ${money(p.hits[0])})`; }), ...picks.map((k) => pickText(k, from))].join("\n") || "Nothing";
  const link = `${APP_URL}/l/${slug}/trades?${new URLSearchParams(Object.entries(query).filter(([, v]) => v)).toString()}`;
  const proposal: TradeProposal = {
    id: Date.now().toString(36), at: new Date().toISOString(), query, a: ta.abbr, b: tb.abbr, pa: a.players, pb: b.players,
    by: by.discordId || by.name, picks: { a: a.picks.map((k) => pickText(k, a.team!)), b: b.picks.map((k) => pickText(k, b.team!)) }, messageId: null, yes: [], no: [], status: "open",
  };
  const embed: Embed = {
    title: `${ta.abbr} ⇄ ${tb.abbr}: ${s.verdict} (${ta.abbr} ${s.score} · ${100 - s.score} ${tb.abbr})`,
    url: link,
    color: hexColor(s.favored?.primary || ta.primary),
    fields: [
      { name: `${ta.name} get (grade ${s.a.grade})`, value: list(b.players, b.picks, b.team).slice(0, 1024), inline: true },
      { name: `${tb.name} get (grade ${s.b.grade})`, value: list(a.players, a.picks, a.team).slice(0, 1024), inline: true },
      voteField(proposal),
    ],
    image: { url: "attachment://trade.png" },
    footer: { text: `${s.a.capNow.after < 0 || s.b.capNow.after < 0 ? "⚠ A team would be over the cap; Madden won't accept it yet. · " : ""}Proposal ${proposal.id}` },
  };
  const payload = {
    content: `📨 Trade proposal: ${tag(ta)} ⇄ ${tag(tb)}, submitted by ${by.discordId ? `<@${by.discordId}>` : `**${by.name}**`}. Admins, vote below.`,
    embeds: [embed],
    components: voteButtons(slug, proposal),
    allowed_mentions: { roles: [roles.get(ta.id), roles.get(tb.id)].filter((r): r is string => Boolean(r)), users: by.discordId ? [by.discordId] : [] },
    attachments: [{ id: 0, filename: "trade.png" }],
  };
  const res = await postWithImage(st.channelId, payload, png);
  if (!res.ok) throw new Error(res.status === 403 ? "The bot can't post in #trade-proposals. Give it View Channel, Send Messages, Embed Links and Attach Files there." : `Discord said ${res.status}.`);
  proposal.messageId = res.id;

  await updateLeagueSettings(lg.id, (set) => {
    const cur = (set.tradeChannels as TradeChannels | undefined) || st;
    const recent = Object.fromEntries([...Object.entries(cur.recent || {}), [key, new Date().toISOString()]].slice(-30));
    const proposals = Object.fromEntries([...Object.entries(cur.proposals || {}), [proposal.id, proposal]].slice(-KEEP_PROPOSALS));
    set.tradeChannels = { ...cur, recent, proposals };
    return set;
  });
  return `Posted in #trade-proposals for the admins to vote on (${VOTES_NEEDED} approvals passes it): ${s.verdict}.`;
}

async function postWithImage(channelId: string, payload: object, png: Buffer): Promise<{ ok: boolean; status: number; id: string | null }> {
  const form = new FormData();
  form.append("payload_json", JSON.stringify(payload));
  form.append("files[0]", new Blob([new Uint8Array(png)], { type: "image/png" }), "trade.png");
  const res = await fetch(`${API}/channels/${channelId}/messages`, { method: "POST", headers: { authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` }, body: form });
  const j = (await res.json().catch(() => ({}))) as { id?: string };
  if (!res.ok) console.error("trade post", channelId, res.status, JSON.stringify(j).slice(0, 300));
  return { ok: res.ok, status: res.status, id: j.id ? String(j.id) : null };
}

// ---------------------------------------------------------------- votes

type VoteResult = { reply?: string; message?: { content?: string; embeds: Embed[]; components: unknown[] } };

/** An Approve / Reject tap ("tv|slug|id|y|n"). Returns the edited proposal message, or a private reply. */
export async function tradeVote(i: ComponentInteraction): Promise<VoteResult> {
  const [, slug, id, yn] = String(i.data?.custom_id || "").split("|");
  const voter = i.member?.user.id;
  if (!voter || !i.guild_id) return { reply: "Vote in the league's server." };
  const lg = await leagueForGuild(i.guild_id).catch(() => null);
  if (!lg || lg.slug !== slug) return { reply: "This trade belongs to a league that isn't linked to this server any more." };
  if (!(await isLeagueAdmin(i))) return { reply: "Only league admins (the server's **admin** role) can vote on trades." };

  let after: TradeProposal | null = null, why = "", justDecided = false;
  const r = await updateLeagueSettings(lg.id, (s) => {
    const st = s.tradeChannels as TradeChannels | undefined;
    const p = st?.proposals?.[id];
    if (!p) { why = "I can't find this proposal any more."; return null; }
    if (p.status !== "open") { why = `This trade was already ${p.status}.`; after = p; return null; }
    const yes = p.yes.filter((x) => x !== voter), no = p.no.filter((x) => x !== voter);
    (yn === "y" ? yes : no).push(voter);
    const next: TradeProposal = { ...p, yes, no };
    if (yes.length >= VOTES_NEEDED) next.status = "approved";
    else if (no.length >= VOTES_NEEDED) next.status = "rejected";
    if (next.status !== "open") { next.decidedAt = new Date().toISOString(); justDecided = true; }
    st!.proposals![id] = next;
    after = next;
    return s;
  });
  if (!r.ok && !after) return { reply: "Couldn't save your vote. Try again." };
  const p = after as TradeProposal | null;
  if (!p) return { reply: why || "Couldn't save your vote." };

  if (justDecided && p.status === "approved") {
    const url = await postApproval(lg, p, i).catch((e) => { console.error("trade approval post", e); return null; });
    if (url) {
      p.approvalUrl = url;
      await updateLeagueSettings(lg.id, (s) => {
        const pr = (s.tradeChannels as TradeChannels | undefined)?.proposals?.[id];
        if (!pr) return null;
        pr.approvalUrl = url;
        return s;
      });
    }
  }
  const old = i.message?.embeds?.[0] || {};
  // The picture stays the message's own attachment.
  const embed: Embed = { ...old, image: { url: "attachment://trade.png" }, fields: [...(old.fields || []).filter((f) => f.name !== "Admin votes"), voteField(p)] };
  const extra = why ? { reply: why } : {};
  return { ...extra, message: { embeds: [embed], components: voteButtons(slug, p) } };
}

/** Reposts an approved trade (same picture) in #trade-approvals. Returns the post's link. */
async function postApproval(lg: LinkedLeague, p: TradeProposal, i: ComponentInteraction): Promise<string | null> {
  const st = stateOf((await leagueBySlug(lg.slug)) || lg);
  if (!st?.approvalsId) return null;
  const guildId = discordOf(lg)!.guildId;
  const msg = i.message as (ComponentInteraction["message"] & { attachments?: { url: string; filename: string }[] }) | undefined;
  const att = msg?.attachments?.find((x) => x.filename === "trade.png") || msg?.attachments?.[0];
  const png = att ? Buffer.from(await (await fetch(att.url)).arrayBuffer()) : null;
  const d = await getLeagueData(lg.slug).catch(() => null);
  const teams = d?.teams || [];
  const ta = teams.find((t) => t.abbr === p.a), tb = teams.find((t) => t.abbr === p.b);
  const roles = d ? await teamRoles(guildId, teams).catch(() => new Map<number, string>()) : new Map<number, string>();
  const tag = (t: typeof ta, abbr: string) => (t && roles.get(t.id) ? `<@&${roles.get(t.id)}>` : `**${abbr}**`);
  const old = msg?.embeds?.[0] || {};
  const proposalUrl = p.messageId ? `https://discord.com/channels/${guildId}/${st.channelId}/${p.messageId}` : undefined;
  const embed: Embed = {
    ...old,
    fields: [...(old.fields || []).filter((f) => f.name !== "Admin votes"), { name: "Approved by", value: `${voters(p.yes)}${p.no.length ? `\nAgainst: ${voters(p.no)}` : ""}${proposalUrl ? `\n[Proposal](${proposalUrl})` : ""}` }],
    ...(png ? { image: { url: "attachment://trade.png" } } : {}),
  };
  const payload = {
    content: `✅ Trade approved (${p.yes.length}–${p.no.length}): ${tag(ta, p.a)} ⇄ ${tag(tb, p.b)}. Make it in Madden; it shows up in <#${st.transactionsId}> after the next sync.`,
    embeds: [embed],
    allowed_mentions: { roles: [ta, tb].map((t) => (t ? roles.get(t.id) : undefined)).filter((r): r is string => Boolean(r)), users: [] as string[] },
    ...(png ? { attachments: [{ id: 0, filename: "trade.png" }] } : {}),
  };
  const res = png ? await postWithImage(st.approvalsId, payload, png) : await (async () => {
    const r = await dc("POST", `/channels/${st.approvalsId}/messages`, payload);
    return { ok: r.ok, status: r.status, id: r.ok ? String(r.data.id) : null };
  })();
  return res.ok && res.id ? `https://discord.com/channels/${guildId}/${st.approvalsId}/${res.id}` : null;
}
