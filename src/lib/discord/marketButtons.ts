// Betting from Discord (Nick, 2026-11-13): every bet line in the Markets channels has
// Yes / No buttons (custom_id "mk|<market>|<outcome>|<side>"). A tap opens a box asking
// how much; submitting it (custom_id "mkb|…") places the bet exactly like the site does.
import { leagueForGuild } from "./links";
import { executeTrade } from "@/lib/marketTrade";
import { userForDiscord } from "@/lib/tickets";
import type { Interaction } from "./handlers";
import type { Embed } from "./api";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getLeagueData } from "@/lib/league/load";
import { searchAwardPlayers } from "@/lib/league/markets";
import { bookKey, ticketsConfig } from "@/lib/tickets";
import { payoutButton } from "./payouts";
import { isLeagueAdmin, NOT_ADMIN } from "./admin";

export type ComponentInteraction = Interaction & {
  data?: { custom_id?: string; values?: string[]; components?: { components?: { custom_id: string; value: string }[] }[] };
  message?: { content?: string; embeds?: Embed[]; components?: { components?: { custom_id?: string; options?: { label: string; value: string }[] }[] }[] };
};

/** "1000", "1,000", "1k", "2.5k", "1m" → Tickets; anything else (negative, words) → NaN. */
export function parseAmount(raw: string): number {
  const m = /^\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*([km])?\s*$/i.exec(raw);
  if (!m) return NaN;
  const n = Number(m[1].replace(/,/g, "")) * (m[2]?.toLowerCase() === "k" ? 1_000 : m[2]?.toLowerCase() === "m" ? 1_000_000 : 1);
  return Math.floor(n);
}

/** The amount box Discord shows when a Yes/No button is tapped (must answer within 3 seconds, so no lookups). */
export function betModal(i: ComponentInteraction) {
  const [, market, outcome, side, team] = String(i.data?.custom_id || "").split("|");
  const what = (i.message?.content || "").match(/\*\*(.+?)\*\*/)?.[1] || "this line";
  const title = (team ? `${team} to win` : `${side === "no" ? "No" : "Yes"} · ${what}`).slice(0, 45);
  return {
    type: 9,
    data: {
      custom_id: `mkb|${market}|${outcome}|${side}`.slice(0, 100),
      title,
      components: [{ type: 1, components: [{ type: 4, custom_id: "amount", style: 1, label: "How much to bet (Tickets)", placeholder: "e.g. 1000 or 2.5k", required: true, min_length: 1, max_length: 9 }] }],
    },
  };
}

/** Places the bet from the amount box. Returns the private reply text. */
export async function placeFromModal(i: ComponentInteraction): Promise<string> {
  const [, market, outcome, sideRaw] = String(i.data?.custom_id || "").split("|");
  const side = sideRaw === "no" ? "no" : "yes";
  const raw = i.data?.components?.[0]?.components?.find((c) => c.custom_id === "amount")?.value || "";
  const amount = parseAmount(raw);
  if (!(amount > 0)) return "Enter a number of Tickets, e.g. 1000 or 2.5k.";
  if (!i.guild_id) return "Bet from the league's Discord server.";
  const lg = await leagueForGuild(i.guild_id);
  if (!lg) return "This server isn't linked to a league (/link).";
  const discordId = i.member?.user.id || i.user?.id || "";
  const userId = discordId ? await userForDiscord(discordId) : null;
  if (!userId) return "Link your Discord to your CFM Manager account first: run /connect and open the link it gives you.";
  // The game-winner message's "Yes" button carries the team as the outcome.
  const r = await executeTrade({ slug: lg.slug, leagueId: lg.id, userId, market, outcome, side, kind: "buy", amount });
  if (!r.ok) return r.error;
  const money = r.tickets ? `${Math.round(r.amount).toLocaleString("en-US")} Tickets` : `$${r.amount.toFixed(2)}`;
  const pays = r.tickets ? `${(r.qty * 100).toLocaleString("en-US")} Tickets` : `$${r.qty.toFixed(2)}`;
  return `✅ Bet placed: ${r.qty} **${side === "yes" ? "Yes" : "No"}** · ${r.outcomeLabel} for **${money}** (avg ${Math.round((r.amount / r.qty / (r.tickets ? 100 : 1)) * 100)}%). Pays **${pays}** if right. The price moved ${Math.round(r.before * 100)}% → ${Math.round(r.after * 100)}%.`;
}

/** "Cancel #n" / "Cash out #n" from /bets (custom_id "mkc|<market>|<outcome>|<side>"): sells the whole position. */
export async function cancelFromButton(i: ComponentInteraction): Promise<string> {
  const [, market, outcome, sideRaw] = String(i.data?.custom_id || "").split("|");
  const side = sideRaw === "no" ? "no" : "yes";
  if (!i.guild_id) return "Cancel from the league's Discord server.";
  const lg = await leagueForGuild(i.guild_id);
  if (!lg) return "This server isn't linked to a league (/link).";
  const discordId = i.member?.user.id || i.user?.id || "";
  const userId = discordId ? await userForDiscord(discordId) : null;
  if (!userId) return "Link your Discord to your CFM Manager account first: run /connect.";
  const d = await getLeagueData(lg.slug);
  if (!d) return "No league data yet.";
  const tickets = Boolean(await ticketsConfig(lg.slug).catch(() => null));
  const { data } = await supabaseAdmin().from("market_positions").select("qty").eq("league_id", lg.id).eq("season", bookKey(d.season.year, tickets))
    .eq("user_id", userId).eq("market_key", market).eq("outcome_id", outcome).eq("side", side).maybeSingle();
  if (!data) return "That bet isn't open any more.";
  const r = await executeTrade({ slug: lg.slug, leagueId: lg.id, userId, market, outcome, side, kind: "sell", qty: Math.floor(Number(data.qty)) });
  if (!r.ok) return r.error;
  const money = r.tickets ? `${Math.round(r.amount).toLocaleString("en-US")} Tickets` : `$${r.amount.toFixed(2)}`;
  return `${r.cashout ? "💵 Cashed out" : "↩️ Cancelled"} ${r.qty} **${side === "yes" ? "Yes" : "No"}** · ${r.outcomeLabel}: **${money}** back.`;
}

/** Applied / Undo on a #previous-week-payouts card: the server's admin role only. */
export async function payoutFromButton(i: ComponentInteraction) {
  if (!(await isLeagueAdmin(i))) return { type: 4, data: { content: NOT_ADMIN, flags: 1 << 6 } };
  const lg = i.guild_id ? await leagueForGuild(i.guild_id) : null;
  if (!lg) return { type: 4, data: { content: "This server isn't linked to a league.", flags: 1 << 6 } };
  const who = i.member?.user;
  return payoutButton(lg.id, String(i.data?.custom_id || ""), who?.global_name || who?.username || "Admin", i.message?.embeds || []);
}

// ---------------------------------------------------------------- #futures pickers (Nick, 2026-11-14)

/** A team/player picked from a #futures menu ("mksel|<market>…"): opens the same amount box as a Yes button. */
export function selectModal(i: ComponentInteraction) {
  const market = String(i.data?.custom_id || "").split("|")[1];
  const outcome = i.data?.values?.[0] || "";
  const label = i.message?.components?.flatMap((r) => r.components || []).flatMap((c) => c.options || []).find((o) => o.value === outcome)?.label || "";
  return betModal({ ...i, data: { ...i.data, custom_id: `mk|${market}|${outcome}|yes|${label}`.slice(0, 100) } } as ComponentInteraction);
}

/** "Any other player…" on an award ("mkany|<market>"): asks for a name and an amount. */
export function anyPlayerModal(i: ComponentInteraction) {
  const market = String(i.data?.custom_id || "").split("|")[1];
  const title = (i.message?.content || "").match(/\*\*(.+?)\*\*/)?.[1] || "this award";
  return {
    type: 9,
    data: {
      custom_id: `mkp|${market}`,
      title: clip(`Any player · ${title}`, 45),
      components: [
        { type: 1, components: [{ type: 4, custom_id: "player", style: 1, label: "Player (first and last name)", placeholder: "e.g. Josh Allen", required: true, min_length: 2, max_length: 60 }] },
        { type: 1, components: [{ type: 4, custom_id: "amount", style: 1, label: "How much to bet (Tickets)", placeholder: "e.g. 1000 or 2.5k", required: true, min_length: 1, max_length: 9 }] },
      ],
    },
  };
}
const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/** Places an "Any other player" award bet. Returns the private reply text. */
export async function placeAnyPlayer(i: ComponentInteraction): Promise<string> {
  const market = String(i.data?.custom_id || "").split("|")[1];
  const field = (id: string) => i.data?.components?.flatMap((r) => r.components || []).find((c) => c.custom_id === id)?.value || "";
  const name = field("player").trim();
  const amount = parseAmount(field("amount"));
  if (!(amount > 0)) return "Enter a number of Tickets, e.g. 1000 or 2.5k.";
  if (!i.guild_id) return "Bet from the league's Discord server.";
  const lg = await leagueForGuild(i.guild_id);
  if (!lg) return "This server isn't linked to a league (/link).";
  const discordId = i.member?.user.id || i.user?.id || "";
  const userId = discordId ? await userForDiscord(discordId) : null;
  if (!userId) return "Link your Discord to your CFM Manager account first: run /connect and open the link it gives you.";
  const d = await getLeagueData(lg.slug);
  if (!d) return "No league data yet.";
  const found = searchAwardPlayers(d, market, name, 6);
  if (!found.length) return `No eligible player matches "${name}" for this award (it needs ${/roy$/.test(market) ? "a rookie " : ""}${/dpoy|droy/.test(market) ? "defensive player" : "QB, HB, FB, WR or TE"} on a team).`;
  const full = (p: (typeof found)[number]) => `${p.first} ${p.last}`.toLowerCase();
  const exact = found.filter((p) => full(p) === name.toLowerCase());
  const pick = exact.length === 1 ? exact[0] : found.length === 1 ? found[0] : null;
  if (!pick) {
    const teams = new Map(d.teams.map((t) => [t.id, t.abbr]));
    return `More than one player matches "${name}". Try again with the full name:\n${found.map((p) => `• ${p.first} ${p.last} (${p.pos}, ${teams.get(p.team) ?? "FA"})`).join("\n")}`;
  }
  const r = await executeTrade({ slug: lg.slug, leagueId: lg.id, userId, market, outcome: String(pick.id), side: "yes", kind: "buy", amount });
  if (!r.ok) return r.error;
  const money = r.tickets ? `${Math.round(r.amount).toLocaleString("en-US")} Tickets` : `$${r.amount.toFixed(2)}`;
  const pays = r.tickets ? `${(r.qty * 100).toLocaleString("en-US")} Tickets` : `$${r.qty.toLocaleString("en-US")}`;
  return `✅ Bet placed: ${r.qty} **Yes** · ${r.outcomeLabel} for **${money}**. Pays **${pays}** if he wins it. The price moved ${Math.round(r.before * 100)}% → ${Math.round(r.after * 100)}%.`;
}
