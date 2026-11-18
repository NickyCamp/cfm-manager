// What the sync worker posts to the league's update channel (/notify) after each
// pull. Only league advances post there (Nick, 2026-11-18); scores, moves and the
// rest go to the Transactions channels.
import type { LeagueData } from "../league/types";
import { BRAND, type Message } from "./api";

export function leagueChanges(prev: LeagueData | null, next: LeagueData, leagueName: string, base: string, slug: string): Message[] {
  if (!prev) return [];
  const url = (path = "") => `${base}/l/${slug}${path}`;
  const out: Message[] = [];
  const footer = { text: `${leagueName} · ${next.season.year} ${next.season.title}` };

  // The league advanced.
  const moved = prev.season.year !== next.season.year || prev.season.stage !== next.season.stage || prev.season.week !== next.season.week;
  if (moved) {
    out.push({ event: "advance", embeds: [{ color: BRAND, title: `${leagueName} advanced to ${next.season.year} ${next.season.title}`, url: url(), footer }] });
  }
  return out;
}

