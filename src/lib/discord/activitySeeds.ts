// Activity from before the bot tracked it, for #activity-tracker-cycle (Nick, 2026-11-19: "i have attached
// the existing seasons activity tracking as well so it can be current"). From NCL's activity sheet:
// 17 games a season for every user; misses per season. Matched to teams by nickname (the sheet's ARZ is
// Madden's ARI). Applied once, when /activitychannels runs in that league; the team's EA user at that
// moment is recorded, so the counts stay with the person if they later move teams.
// left: the user is gone; his numbers stay under his name and never grow.
// teamNames: a new user on a team, starting at 0; every game of that team from now on counts for him,
// whatever EA account runs it. Bump `version` after a change so a league already set up picks it up.
// games: per column, when a column isn't one full season each (users who joined partway).
// count: how many league seasons the columns cover, when it isn't one column per season.
export type SeedRow = { name: string; team: string; misses: number[]; games?: number[]; left?: boolean };
export type Seed = { version: number; seasons: string[]; count?: number; gamesPerSeason: number; rows: SeedRow[]; teamNames?: Record<string, string> };

/** misses: [Season 1, Season 2] */
const NCL: Seed = {
  version: 2,
  // 2026-11-19 (Nick): "new saints user is Lee and he is getting starting at 0 and all games with the saints
  // going forward should track for him and melo's stays stagnant"
  teamNames: { Saints: "Lee" },
  seasons: ["Season 1", "Season 2"],
  gamesPerSeason: 17,
  rows: [
    { name: "Link", team: "Ravens", misses: [0, 0] },
    { name: "Gene*", team: "Bears", misses: [0, 0] },
    { name: "Gabe", team: "Bengals", misses: [0, 0] },
    { name: "BrotherG", team: "Cowboys", misses: [0, 0] },
    { name: "Kris*", team: "Rams", misses: [0, 0] },
    { name: "Supreme*", team: "Eagles", misses: [0, 0] },
    { name: "Nick", team: "Seahawks", misses: [0, 0] },
    { name: "Joey", team: "Titans", misses: [0, 0] },
    { name: "Mike*", team: "Commanders", misses: [0, 0] },
    { name: "Chase", team: "Colts", misses: [0, 1] },
    { name: "Tommy", team: "Jets", misses: [0, 1] },
    { name: "Matt*", team: "Browns", misses: [1, 0] },
    { name: "Austin*", team: "Chargers", misses: [1, 0] },
    { name: "Isaac", team: "Raiders", misses: [1, 0] },
    { name: "Nate*", team: "Patriots", misses: [1, 0] },
    { name: "Chris", team: "Bills", misses: [0, 2] },
    { name: "Devin*", team: "Texans", misses: [0, 2] },
    { name: "SlimGenzy", team: "Jaguars", misses: [0, 2] },
    { name: "Theron", team: "Chiefs", misses: [0, 2] },
    { name: "Hodge", team: "Giants", misses: [0, 2] },
    { name: "Charon*", team: "Cardinals", misses: [0, 3] },
    { name: "Dylan*", team: "Dolphins", misses: [1, 2] },
    { name: "Mayhem*", team: "Packers", misses: [2, 1] },
    { name: "Jamarri*", team: "Buccaneers", misses: [2, 1] },
    { name: "Mental", team: "Falcons", misses: [0, 4] },
    { name: "Melo*", team: "Saints", misses: [2, 3], left: true },
    { name: "OMy", team: "Broncos", misses: [3, 2] },
    { name: "KennyG*", team: "Panthers", misses: [4, 1] },
    { name: "Ordo*", team: "49ers", misses: [3, 3] },
    { name: "Sal", team: "Lions", misses: [2, 5] },
    { name: "Dish", team: "Steelers", misses: [2, 5] },
    { name: "Shon*", team: "Vikings", misses: [4, 6] },
  ],
};

/** EML's sheet (Nick, 2026-11-25: "This is their season 1 and 2, the 49ers user left in the offseason so the
 *  current ones tracking is correct through 2 weeks"). The sheet only has totals over both seasons (34 games
 *  for a full-time user; fewer for users who joined partway), so it's one "Seasons 1–2" column. No 49ers row:
 *  that user left, and the new one is tracked by the bot from this season. */
const r = (name: string, team: string, misses: number, games = 34): SeedRow => ({ name, team, misses: [misses], games: [games] });
const EML: Seed = {
  version: 1,
  seasons: ["Seasons 1–2"],
  count: 2,
  gamesPerSeason: 17,
  rows: [
    r("MATT", "Bears", 0), r("MIKE", "Jets", 0), r("AUSTIN", "Ravens", 0), r("CHRIS FRAZ", "Browns", 0),
    r("GENE", "Chiefs", 0), r("LINK", "Raiders", 0), r("KRIS", "Falcons", 0), r("SAMMY", "Bills", 0, 12),
    r("BISHOP", "Cardinals", 1), r("DJFC", "Bengals", 1), r("VIBE", "Broncos", 2), r("BLUTO", "Packers", 2),
    r("MAYHEM", "Seahawks", 2), r("BRYCE", "Texans", 2), r("JORDAN", "Vikings", 2, 24), r("CODY", "Eagles", 3),
    r("ORDO", "Patriots", 3), r("CHARON", "Commanders", 3), r("SHON", "Saints", 4), r("SUPE", "Chargers", 4),
    r("SAM", "Colts", 4), r("GENZY", "Giants", 5), r("JOEY", "Jaguars", 5), r("DECK", "Dolphins", 5),
    r("MAINE", "Panthers", 6), r("TRAW", "Buccaneers", 6), r("RED", "Cowboys", 6, 29), r("KENNY", "Lions", 8),
    r("SAL", "Steelers", 10, 32), r("YUNGLAW", "Titans", 6, 19),
  ],
};

/** The seed for a league, by slug (or a league name with NCL in it). */
export function seedFor(slug: string, name: string): Seed | null {
  if (slug === "ncl" || /\bncl\b/i.test(name)) return NCL;
  if (/^eml/i.test(slug) || /\beml/i.test(name)) return EML;
  return null;
}
