// NFL team logos for signed-in visitors only (Nick's call, 2026-11-13), like card art.
// Hotlinked from ESPN's CDN via nflverse's teams_colors_logos.csv (team_logo_espn), never
// committed to this public repo.
// Matched by nickname, so a relocated/custom franchise
// team gets no logo and keeps its abbreviation badge.
import type React from "react";
import type { Team } from "./types";

const LOGOS: Record<string, string> = {
  "49ers": "https://a.espncdn.com/i/teamlogos/nfl/500/sf.png",
  "bears": "https://a.espncdn.com/i/teamlogos/nfl/500/chi.png",
  "bengals": "https://a.espncdn.com/i/teamlogos/nfl/500/cin.png",
  "bills": "https://a.espncdn.com/i/teamlogos/nfl/500/buf.png",
  "broncos": "https://a.espncdn.com/i/teamlogos/nfl/500/den.png",
  "browns": "https://a.espncdn.com/i/teamlogos/nfl/500/cle.png",
  "buccaneers": "https://a.espncdn.com/i/teamlogos/nfl/500/tb.png",
  "cardinals": "https://a.espncdn.com/i/teamlogos/nfl/500/ari.png",
  "chargers": "https://a.espncdn.com/i/teamlogos/nfl/500/lac.png",
  "chiefs": "https://a.espncdn.com/i/teamlogos/nfl/500/kc.png",
  "colts": "https://a.espncdn.com/i/teamlogos/nfl/500/ind.png",
  "commanders": "https://a.espncdn.com/i/teamlogos/nfl/500/wsh.png",
  "cowboys": "https://a.espncdn.com/i/teamlogos/nfl/500/dal.png",
  "dolphins": "https://a.espncdn.com/i/teamlogos/nfl/500/mia.png",
  "eagles": "https://a.espncdn.com/i/teamlogos/nfl/500/phi.png",
  "falcons": "https://a.espncdn.com/i/teamlogos/nfl/500/atl.png",
  "giants": "https://a.espncdn.com/i/teamlogos/nfl/500/nyg.png",
  "jaguars": "https://a.espncdn.com/i/teamlogos/nfl/500/jax.png",
  "jets": "https://a.espncdn.com/i/teamlogos/nfl/500/nyj.png",
  "lions": "https://a.espncdn.com/i/teamlogos/nfl/500/det.png",
  "packers": "https://a.espncdn.com/i/teamlogos/nfl/500/gb.png",
  "panthers": "https://a.espncdn.com/i/teamlogos/nfl/500-dark/car.png",
  "patriots": "https://a.espncdn.com/i/teamlogos/nfl/500/ne.png",
  "raiders": "https://a.espncdn.com/i/teamlogos/nfl/500/lv.png",
  "rams": "https://a.espncdn.com/i/teamlogos/nfl/500/lar.png",
  "ravens": "https://a.espncdn.com/i/teamlogos/nfl/500/bal.png",
  "saints": "https://a.espncdn.com/i/teamlogos/nfl/500/no.png",
  "seahawks": "https://a.espncdn.com/i/teamlogos/nfl/500/sea.png",
  "steelers": "https://a.espncdn.com/i/teamlogos/nfl/500/pit.png",
  "texans": "https://a.espncdn.com/i/teamlogos/nfl/500/hou.png",
  "titans": "https://a.espncdn.com/i/teamlogos/nfl/500/ten.png",
  "vikings": "https://a.espncdn.com/i/teamlogos/nfl/500/min.png",
};

export const teamLogo = (team: Pick<Team, "name"> | undefined): string | undefined =>
  team ? LOGOS[team.name.trim().toLowerCase()] : undefined;

/** Inline style that hands the logo to CSS; it's only drawn under .logos-on (signed in), so signed-out visitors never load it. */
export const logoVar = (url: string | undefined) => (url ? ({ "--logo": `url("${url}")` } as React.CSSProperties) : undefined);
