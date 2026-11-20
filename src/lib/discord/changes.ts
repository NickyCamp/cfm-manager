// What the sync worker posts to the league's update channel (/notify) after each
// pull. Only league advances post there (Nick, 2026-11-18); scores, moves and the
// rest go to the Transactions channels.
import type { LeagueData } from "../league/types";
import type { Message } from "./api";

export function leagueChanges(prev: LeagueData | null, next: LeagueData, leagueName: string, base: string, slug: string): Message[] {
  if (!prev) return [];
  const url = (path = "") => `${base}/l/${slug}${path}`;
  const out: Message[] = [];
  // The league advanced.
  const moved = prev.season.year !== next.season.year || prev.season.stage !== next.season.stage || prev.season.week !== next.season.week;
  if (moved) {
    // Nick (2026-11-20): a plain @everyone message with the week and the site link.
    out.push({
      event: "advance",
      content: `@everyone **${leagueName}** has advanced to **${next.season.year} ${next.season.title}**!\n${url()}`,
      allowed_mentions: { parse: ["everyone"] },
    });
  }
  return out;
}

