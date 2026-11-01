// Turns a Player into the props for his trading card.
import type { PlayerCardProps } from "@/components/league/CardFront";
import { cardStats } from "./cardStats";
import { cardArt } from "./cardArt";
import { heightText } from "./format";
import type { LeagueData, Player, Team } from "./types";

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function cardProps(d: LeagueData, slug: string, p: Player, team: Team | undefined, art?: string): PlayerCardProps {
  return {
    first: p.first, last: p.last, pos: p.pos, jersey: p.jersey, ovr: p.ovr, dev: p.dev,
    rookie: p.yearsPro === 0,
    teamAbbr: team?.abbr ?? "FA", primary: team?.primary || "#33415c", secondary: team?.secondary || "#c9d1e0",
    setLabel: `${d.season.year} ${slug.length <= 5 ? slug.toUpperCase() : "Series"}`,
    exp: p.yearsPro === 0 ? "Rookie" : `${ordinal(p.yearsPro + 1)} yr`,
    age: p.age, height: heightText(p.height), weight: p.weight, college: p.college,
    draft: p.draft.round >= 1 && p.draft.round <= 7 ? `R${p.draft.round} #${p.draft.pick}${p.draft.year ? `, ${p.draft.year}` : ""}` : "Undrafted",
    art: art ?? cardArt(slug, p.id),
    abilities: p.abilities,
    stats: cardStats(p),
  };
}
