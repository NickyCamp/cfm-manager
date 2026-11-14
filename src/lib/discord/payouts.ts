// "Previous Week Payouts" (Nick, 2026-11-14): the bot no longer moves Tickets itself.
// After each advance it posts a fresh #previous-week-payouts channel in the Markets
// category: one message per member who bet, with every settled bet, its net gain/loss,
// a ready-to-copy UnbelievaBoat command, and an Applied button for admins. Lines not
// applied by the next advance carry over into the next report (nothing is lost when the
// old channel is replaced). The site already counts every result in members' balances,
// so it's right even before admins apply them.
import { supabaseAdmin } from "@/lib/supabase/server";
import { allRows, closeTimes, fmtET, ledgerRows, memberNames, type LedgerRow } from "@/lib/marketStore";
import { discordOfUser, type TicketsConfig } from "@/lib/tickets";
import type { LeagueData } from "@/lib/league/types";
import type { MarketBook } from "@/lib/league/marketTypes";
import { BRAND, clip, type Embed } from "./api";
import { dc, sleep } from "./rest";

const APP_URL = (process.env.APP_URL || "https://cfm-manager-delta.vercel.app").replace(/\/$/, "");
export type PayoutState = { channelId?: string; reportKey?: string; since?: string };
const GREEN_C = 0x2e7d32;
const n0 = (x: number) => Math.round(x).toLocaleString("en-US");
const signed = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${n0(Math.abs(x))}`;

function lineFor(r: LedgerRow): string {
  const side = r.side ? `${r.side === "yes" ? "Yes" : "No"} · ` : "";
  const amt = `**${signed(r.amount)}**`;
  if (r.kind === "result") {
    const icon = r.note.startsWith("Void") ? "↩️" : r.note.startsWith("Won") ? "✅" : "❌";
    return `${icon} ${side}${r.note} · staked ${n0(r.cost || 0)}, paid ${n0(r.payout || 0)} · ${amt}`;
  }
  if (r.kind === "cashout") return `💵 ${side}cashed out (${r.market}) · staked ${n0(r.cost || 0)}, got ${n0(r.payout || 0)} · ${amt}`;
  if (r.kind === "cancel") return `✂️ ${side}cancelled after the price fell (${r.market}) · staked ${n0(r.cost || 0)}, refunded ${n0(r.payout || 0)} · ${amt}`;
  if (r.kind === "void") return `⛔ ${side}bet voided: ${r.note} (${r.market}) · ${amt}`;
  return `💳 ${r.note} · ${amt}`;
}

const gameOf = (k: string | null) => Number(/^(?:game|props)-(\d+)/.exec(k || "")?.[1] || 0) || null;

/** Builds and posts the report. Returns the new state (channel, report key) and a summary line. */
export async function postPayoutReport(a: {
  slug: string; leagueId: string; guildId: string; categoryId: string; d: LeagueData; book: MarketBook; tickets: TicketsConfig; prev?: PayoutState; title?: string;
}): Promise<{ state: PayoutState; text: string }> {
  const db = supabaseAdmin();
  const now = new Date();
  const reportKey = `${a.d.season.year}-${a.d.season.stage}-${a.d.season.week}.${now.getTime().toString(36)}`;
  const since = a.prev?.since || new Date(now.getTime() - 8 * 86400_000).toISOString();
  const rows = (await ledgerRows(a.leagueId, { unapplied: true })).reverse();

  // who bet since the last report, and everyone's open bets (shown, not counted yet)
  const [recent, open] = await Promise.all([
    allRows<{ user_id: string }>((f, t) => db.from("market_trades").select("user_id").eq("league_id", a.leagueId).eq("kind", "buy").gte("created_at", since).order("id").range(f, t)),
    allRows<{ user_id: string; season: number; market_key: string; cost: number }>((f, t) => db.from("market_positions").select("user_id, season, market_key, cost").eq("league_id", a.leagueId).order("user_id").range(f, t)),
  ]);
  const openBy = new Map<string, { n: number; cost: number }>();
  for (const p of open) {
    if (Number(p.season) % 10 !== 1) continue;
    const o = openBy.get(p.user_id) || { n: 0, cost: 0 };
    o.n++; o.cost += Number(p.cost); openBy.set(p.user_id, o);
  }
  const users = [...new Set([...rows.map((r) => r.userId), ...recent.map((r) => r.user_id)])];
  const names = await memberNames(users);
  const { data: mem } = await db.from("league_members").select("user_id, team_abbr").eq("league_id", a.leagueId);
  const teamOf = new Map((mem || []).map((r) => [r.user_id, r.team_abbr || ""]));

  // kickoff check: listed kickoff vs. each member's last bet on that game
  const gameIds = [...new Set(rows.map((r) => gameOf(r.market)).filter((x): x is number => Boolean(x)))];
  const closes = await closeTimes(a.leagueId, a.d.season.year);
  const lastBet = new Map<string, string>(); // `${user}|${game}` -> iso
  if (gameIds.length) {
    const tr = await allRows<{ user_id: string; market_key: string; created_at: string }>((f, t) => db.from("market_trades").select("user_id, market_key, created_at")
      .eq("league_id", a.leagueId).eq("kind", "buy").or(gameIds.map((g) => `market_key.eq.game-${g},market_key.like.props-${g}-*`).join(",")).order("id").range(f, t));
    for (const t of tr) { const k = `${t.user_id}|${gameOf(t.market_key)}`; if (!lastBet.has(k) || lastBet.get(k)! < t.created_at) lastBet.set(k, t.created_at); }
  }
  const teams = new Map(a.d.teams.map((t) => [t.id, t.abbr]));
  const gameName = (id: number) => { const g = a.d.games.find((x) => x.id === id); return g ? `${teams.get(g.away) ?? "?"} @ ${teams.get(g.home) ?? "?"}` : `game ${id}`; };

  // a fresh channel (the old one's lines that weren't applied are in `rows` again)
  if (a.prev?.channelId) { await dc("DELETE", `/channels/${a.prev.channelId}`); await sleep(300); }
  const ch = await dc("POST", `/guilds/${a.guildId}/channels`, {
    name: "previous-week-payouts", type: 0, parent_id: a.categoryId,
    topic: `Market results to add/remove in UnbelievaBoat, then tap Applied · ${APP_URL}/l/${a.slug}/markets/activity`,
  });
  if (!ch.ok) return { state: a.prev || {}, text: ch.status === 403 ? "The bot needs Manage Channels to post the payouts report." : `Discord said ${ch.status} creating the payouts channel.` };
  const channelId = String(ch.data.id);

  type Card = { userId: string; name: string; net: number; embed: Embed; ids: number[] };
  const cards: Card[] = [];
  for (const uid of users) {
    const mine = rows.filter((r) => r.userId === uid);
    const net = Math.round(mine.reduce((s, r) => s + r.amount, 0));
    const disc = await discordOfUser(uid).catch(() => null);
    const name = names.get(uid) || "Member";
    const lines = mine.map(lineFor);
    let desc = "";
    for (let i = 0; i < lines.length; i++) {
      const next = `${desc}${lines[i]}\n`;
      if (next.length > 3300) { desc += `…and ${lines.length - i} more on the site.\n`; break; }
      desc = next;
    }
    if (!mine.length) desc = "No bets settled since the last report.\n";
    const fields: Embed["fields"] = [];
    const checks = [...new Set(mine.map((r) => gameOf(r.market)).filter((x): x is number => Boolean(x)))].map((g) => {
      const c = closes.get(g), lb = lastBet.get(`${uid}|${g}`);
      const late = c && lb && Date.parse(lb) >= Date.parse(c.closeAt);
      return `${late ? "⚠️ " : ""}${gameName(g)}: kickoff ${c ? `${c.kind === "verified" ? "verified" : "listed"} ${fmtET(c.closeAt)}` : "not set"} · last bet ${lb ? fmtET(lb) : "—"}`;
    });
    if (checks.length) fields.push({ name: "Kickoff check", value: clip(checks.join("\n"), 1024) });
    const ob = openBy.get(uid);
    if (ob) fields.push({ name: "Still open (not counted yet)", value: `${ob.n} bet${ob.n === 1 ? "" : "s"}, ${n0(ob.cost)} Tickets staked` });
    const who = disc ? `<@${disc.id}>` : `${name} (no Discord linked)`;
    const cmd = net === 0 ? "Nothing to add or remove." : disc
      ? `\`\`\`\n!${net > 0 ? "add" : "remove"}-money ${a.tickets.field} <@${disc.id}> ${Math.abs(net)}\n\`\`\``
      : `${net > 0 ? "Add" : "Remove"} ${n0(Math.abs(net))} Tickets ${net > 0 ? "to" : "from"} ${name} by hand.`;
    cards.push({
      userId: uid, name, net, ids: mine.map((r) => r.id),
      embed: {
        title: clip(`${name}${teamOf.get(uid) ? ` · ${teamOf.get(uid)}` : ""} · ${net === 0 ? "even" : `${signed(net)} Tickets`}`, 256),
        color: net > 0 ? GREEN_C : net < 0 ? 0xc62828 : BRAND,
        description: `${who}\n${desc}\n**Net: ${signed(net)} Tickets**\n${cmd}`,
        fields,
        footer: { text: net === 0 ? "Nothing to apply" : "Not applied yet" },
      },
    });
  }
  cards.sort((x, y) => x.name.localeCompare(y.name));

  const add = cards.filter((c) => c.net > 0).reduce((s, c) => s + c.net, 0);
  const remove = cards.filter((c) => c.net < 0).reduce((s, c) => s - c.net, 0);
  await dc("POST", `/channels/${channelId}/messages`, {
    allowed_mentions: { parse: [] },
    embeds: [{
      title: `Previous week payouts · ${a.title || a.d.season.title}`,
      url: `${APP_URL}/l/${a.slug}/markets/activity`,
      color: BRAND,
      description: [
        `The bot doesn't move Tickets. For each member below, run the command in UnbelievaBoat (or add/remove the amount by hand), then tap **Applied**.`,
        `Members' balances on the site already count these results, so nothing needs to wait on you.`,
        `**Kickoff check:** each card shows the kickoff on record and the member's last bet on that game. If a kickoff was wrong, run \`/verifykickoff team time\` with the real kickoff: bets placed after it are voided and the correction shows up in the next report.`,
        cards.length ? `**${cards.length}** member${cards.length === 1 ? "" : "s"} · add **${n0(add)}** · remove **${n0(remove)}** Tickets in total.` : "Nobody bet since the last report.",
      ].join("\n\n"),
      footer: { text: `Report ${reportKey} · posted ${fmtET(now)}` },
    }],
  });

  // mark which report each line was shown in; lines that net to zero need nothing from admins
  const allIds = cards.flatMap((c) => c.ids);
  for (let i = 0; i < allIds.length; i += 200) await db.from("market_ledger").update({ report_key: reportKey }).in("id", allIds.slice(i, i + 200));
  const zero = cards.filter((c) => c.net === 0).flatMap((c) => c.ids);
  for (let i = 0; i < zero.length; i += 200) await db.from("market_ledger").update({ applied_at: now.toISOString(), applied_by: "nothing to apply (net 0)" }).in("id", zero.slice(i, i + 200));

  for (const c of cards) {
    await dc("POST", `/channels/${channelId}/messages`, {
      embeds: [c.embed], allowed_mentions: { parse: [] },
      components: c.net === 0 ? [] : [{ type: 1, components: [appliedButton(reportKey, c.userId, false)] }],
    });
    await sleep(250);
  }
  return { state: { channelId, reportKey, since: now.toISOString() }, text: `Payouts report posted: ${cards.length} member${cards.length === 1 ? "" : "s"}, add ${n0(add)}, remove ${n0(remove)} Tickets.` };
}

const appliedButton = (key: string, userId: string, applied: boolean) => applied
  ? { type: 2, style: 2, label: "Undo applied", custom_id: `mpu|${key}|${userId}` }
  : { type: 2, style: 3, label: "Applied ✓", custom_id: `mpa|${key}|${userId}` };

/** An admin tapped Applied (mpa) or Undo (mpu) on a member's card. Returns the message update (type 7). */
export async function payoutButton(leagueId: string, customId: string, by: string, embeds: Embed[]) {
  const [kind, key, userId] = customId.split("|");
  const apply = kind === "mpa";
  const db = supabaseAdmin();
  let q = db.from("market_ledger").update(apply ? { applied_at: new Date().toISOString(), applied_by: by.slice(0, 64) } : { applied_at: null, applied_by: null })
    .eq("league_id", leagueId).eq("user_id", userId).eq("report_key", key);
  q = apply ? q.is("applied_at", null) : q.not("applied_at", "is", null);
  const { error } = await q;
  if (error) return { type: 4, data: { content: `Couldn't save that: ${error.message}`, flags: 1 << 6 } };
  const e = { ...(embeds[0] || {}) };
  e.footer = { text: apply ? `✅ Applied by ${by} · ${fmtET(new Date())}` : "Not applied yet" };
  return { type: 7, data: { embeds: [e], components: [{ type: 1, components: [appliedButton(key, userId, apply)] }], allowed_mentions: { parse: [] } } };
}
