// Betting from Discord (Nick, 2026-11-13): every bet line in the Markets channels has
// Yes / No buttons (custom_id "mk|<market>|<outcome>|<side>"). A tap opens a box asking
// how much; submitting it (custom_id "mkb|…") places the bet exactly like the site does.
import { leagueForGuild } from "./links";
import { executeTrade } from "@/lib/marketTrade";
import { userForDiscord } from "@/lib/tickets";
import type { Interaction } from "./handlers";

export type ComponentInteraction = Interaction & {
  data?: { custom_id?: string; components?: { components?: { custom_id: string; value: string }[] }[] };
  message?: { content?: string };
};

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
      components: [{ type: 1, components: [{ type: 4, custom_id: "amount", style: 1, label: "How much to bet (Tickets)", placeholder: "e.g. 1000", required: true, min_length: 1, max_length: 9 }] }],
    },
  };
}

/** Places the bet from the amount box. Returns the private reply text. */
export async function placeFromModal(i: ComponentInteraction): Promise<string> {
  const [, market, outcome, sideRaw] = String(i.data?.custom_id || "").split("|");
  const side = sideRaw === "no" ? "no" : "yes";
  const raw = i.data?.components?.[0]?.components?.find((c) => c.custom_id === "amount")?.value || "";
  const amount = Number(raw.replace(/[^\d.]/g, ""));
  if (!(amount > 0)) return "Enter a number of Tickets, e.g. 1000.";
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
  return `✅ Bet placed: ${r.qty} **${side === "yes" ? "Yes" : "No"}** · ${r.outcomeLabel} for **${money}** (avg ${Math.round((r.amount / r.qty / (r.tickets ? 100 : 1)) * 100)}¢). Pays **${pays}** if right. The price moved ${Math.round(r.before * 100)}¢ → ${Math.round(r.after * 100)}¢.`;
}
