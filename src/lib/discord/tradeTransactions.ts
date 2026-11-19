// #trade-transactions (Nick, 2026-11-17): after each sync, the trades that happened in Madden,
// one post per trade, linked to the admin-approved proposal it matches (or flagged when none does).
// A trade = players who moved directly between the same two teams since the last sync. EA's export
// has no draft-pick list, so picks only appear through the matched proposal. Pure: the worker posts.
import type { LeagueData, Player } from "../league/types";
import { DEV_LABEL } from "../league/types";
import { money } from "../league/format";
import { hexColor, type Message } from "./api";
import type { TradeChannels, TradeProposal } from "./tradeChannels";

const ROUND = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th"];

/** Trades seen in this sync (players who moved directly between the same two teams), each with the
 *  admin-approved proposal it matches, if any. Also used by the worker to give the pick tracker their picks. */
export function syncedTrades(prev: LeagueData | null, next: LeagueData, proposals: TradeChannels["proposals"]) {
  if (!prev || prev.pulledAt === next.pulledAt) return [];
  const before = new Map(prev.players.filter((p) => !p.gone).map((p) => [p.id, p]));
  const teams = new Map(next.teams.map((t) => [t.id, t]));
  const groups = new Map<string, { a: number; b: number; toA: Player[]; toB: Player[] }>();
  for (const p of next.players) {
    const o = before.get(p.id);
    if (p.gone || !o || !o.team || !p.team || o.team === p.team) continue;
    const [a, b] = [o.team, p.team].sort((x, y) => x - y);
    const key = `${a}-${b}`;
    if (!groups.has(key)) groups.set(key, { a, b, toA: [], toB: [] });
    const g = groups.get(key)!;
    (p.team === a ? g.toA : g.toB).push(p);
  }
  const approved = Object.values(proposals || {}).filter((p) => p.status === "approved").sort((x, y) => (y.decidedAt || "").localeCompare(x.decidedAt || ""));
  const out = [];
  for (const g of groups.values()) {
    const ta = teams.get(g.a), tb = teams.get(g.b);
    if (!ta || !tb) continue;
    const moved = new Set([...g.toA, ...g.toB].map((p) => p.id));
    // The approved proposal between these two teams whose players all moved.
    const match: TradeProposal | undefined = approved.find((p) => {
      const pair = [p.a, p.b].sort().join("|") === [ta.abbr, tb.abbr].sort().join("|");
      const ids = [...p.pa, ...p.pb];
      return pair && ids.length > 0 && ids.every((id) => moved.has(id));
    });
    // key: the transaction log's id for this trade (history.ts tradeKey: sync time, then the team ids).
    out.push({ ...g, ta, tb, match, key: `${next.pulledAt}:${g.a}-${g.b}` });
  }
  return out;
}

export function tradeTransactionPosts(prev: LeagueData | null, next: LeagueData, st: TradeChannels, guildId: string | undefined, appUrl: string, slug: string): Message[] {
  const line = (p: Player) => `${p.pos} **${p.first} ${p.last}** · ${p.ovr} OVR${p.dev ? ` ${DEV_LABEL[p.dev]}` : ""} · ${money(p.contract.capHit)}${p.contract.yearsLeft ? `, ${p.contract.yearsLeft} yr${p.contract.yearsLeft === 1 ? "" : "s"}` : ""}`;
  const out: Message[] = [];
  for (const g of syncedTrades(prev, next, st.proposals)) {
    const { ta, tb, match } = g;
    const picks = (abbr: string) => {
      if (!match) return [];
      // what this team received = what the other side sent
      if (match.picks) return match.a === abbr ? match.picks.b : match.picks.a;
      const k = match.a === abbr ? match.query.kb : match.query.ka;
      return (k || "").split(",").filter(Boolean).map((x) => { const [y, r, n] = x.split("-").map(Number); return `${y} ${ROUND[r] || r} round pick${n ? ` (#${n})` : ""}`; });
    };
    const got = (t: typeof ta, ps: Player[]) => ([...ps.sort((x, y) => y.ovr - x.ovr).map(line), ...picks(t.abbr)].join("\n") || "Draft picks (EA's data doesn't list picks; a commissioner can add them on the Transactions tab)").slice(0, 1024);
    const proposalLink = match?.messageId && guildId ? `https://discord.com/channels/${guildId}/${st.channelId}/${match.messageId}` : null;
    const status = match
      ? `✅ Matches the trade the admins approved ${match.yes.length}–${match.no.length}${match.approvalUrl ? ` · [approval](${match.approvalUrl})` : proposalLink ? ` · [proposal](${proposalLink})` : ""}`
      : "⚠️ No admin-approved trade proposal matches this trade.";
    out.push({
      content: "",
      embeds: [{
        title: `🔁 Trade: ${ta.abbr} ⇄ ${tb.abbr}`,
        url: `${appUrl}/l/${slug}/transactions`,
        color: hexColor(ta.primary),
        description: `${next.season.year} ${next.season.title} · seen in the sync of ${new Date(next.pulledAt).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ET`,
        fields: [
          { name: `${ta.city} ${ta.name} got`, value: got(ta, g.toA), inline: true },
          { name: `${tb.city} ${tb.name} got`, value: got(tb, g.toB), inline: true },
          { name: "Approval", value: status },
        ],
        footer: { text: "Draft picks come from the approved proposal (EA's export doesn't list picks); the league's pick tracker moves them." },
      }],
    });
  }
  return out;
}
