import { teamLogo } from "./logos";
// Turns a Player into the props for his trading card.
import type { PlayerCardProps } from "@/components/league/CardFront";
import { cardStats, seasonCardStats } from "./cardStats";
import { seasonTotals } from "./derive";
import { cardArt } from "./cardArt";
import { isCutoutUrl } from "./headshots";
import { heightText } from "./format";
import type { LeagueData, Player, Team } from "./types";

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function cardProps(d: LeagueData, slug: string, p: Player, team: Team | undefined, art?: string): PlayerCardProps {
  return {
    first: p.nick ? `${p.first} "${p.nick}"` : p.first, last: p.last, pos: p.pos, jersey: p.jersey, ovr: p.ovr, dev: p.dev,
    rookie: p.yearsPro === 0,
    teamAbbr: team?.abbr ?? "FA", teamLogo: teamLogo(team), primary: team?.primary || "#33415c", secondary: team?.secondary || "#c9d1e0",
    setLabel: `${d.season.year} ${slug.length <= 5 ? slug.toUpperCase() : "Series"}`,
    exp: p.yearsPro === 0 ? "Rookie" : `${ordinal(p.yearsPro + 1)} yr`,
    age: p.age, height: heightText(p.height), weight: p.weight, college: p.college,
    draft: p.draft.round >= 1 && p.draft.round <= 7 ? `R${p.draft.round} #${p.draft.pick}${p.draft.year ? `, ${p.draft.year}` : ""}` : "Undrafted",
    art: art ?? cardArt(slug, p.id),
    cutout: isCutoutUrl(art),
    abilities: p.abilities,
    stats: cardStats(p),
  };
}

// Every player's season totals, worked out once per loaded league (the ranks need all of them).
const totalsCache = new WeakMap<LeagueData, { all: ReturnType<typeof seasonTotals>; posOf: Map<number, string> }>();
function leagueTotals(d: LeagueData) {
  let t = totalsCache.get(d);
  if (!t) { t = { all: seasonTotals(d), posOf: new Map(d.players.map((x) => [x.id, x.pos])) }; totalsCache.set(d, t); }
  return t;
}

/** The card back's season stats and contract, for cards that can be flipped. */
export function cardBackProps(d: LeagueData, p: Player): Pick<PlayerCardProps, "season" | "deal"> {
  const c = p.contract;
  return {
    season: { year: d.season.year, items: seasonCardStats(p, leagueTotals(d).all, leagueTotals(d).posOf) },
    deal: p.team && c.length ? { capHit: c.capHit, yearsLeft: c.yearsLeft, length: c.length, total: c.salary + c.bonus } : null,
  };
}
