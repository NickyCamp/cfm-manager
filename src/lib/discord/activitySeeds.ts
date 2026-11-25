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
 *  current ones tracking is correct through 2 weeks", then the sheet's Season 1 and Season 2 miss columns).
 *  Users who joined partway have fewer games; the sheet only gives their total, so the short season is taken
 *  to be Season 1 (Sammy's 12 games are Season 2: he has no Season 1). No 49ers row: that user left (Mega is
 *  the new one). No Rams row: CPU team. */
const r = (name: string, team: string, s1: number, s2: number, games: [number, number] = [17, 17]): SeedRow => ({ name, team, misses: [s1, s2], games });
const EML: Seed = {
  version: 1,
  // 2026-11-25 (Nick): "add mega as SF" (new 49ers user, starting at 0; every 49ers game this season counts for
  // him). The Rams are a CPU team with no user, so their games count for no one.
  teamNames: { "49ers": "Mega" },
  seasons: ["Season 1", "Season 2"],
  gamesPerSeason: 17,
  rows: [
    r("MATT", "Bears", 0, 0), r("MIKE", "Jets", 0, 0), r("AUSTIN", "Ravens", 0, 0), r("CHRIS FRAZ", "Browns", 0, 0),
    r("GENE", "Chiefs", 0, 0), r("LINK", "Raiders", 0, 0), r("KRIS", "Falcons", 0, 0), r("SAMMY", "Bills", 0, 0, [0, 12]),
    r("BISHOP", "Cardinals", 1, 0), r("DJFC", "Bengals", 0, 1), r("VIBE", "Broncos", 2, 0), r("BLUTO", "Packers", 0, 2),
    r("MAYHEM", "Seahawks", 1, 1), r("BRYCE", "Texans", 1, 1), r("JORDAN", "Vikings", 1, 1, [7, 17]), r("CODY", "Eagles", 0, 3),
    r("ORDO", "Patriots", 1, 2), r("CHARON", "Commanders", 1, 2), r("SHON", "Saints", 0, 4), r("SUPE", "Chargers", 1, 3),
    r("SAM", "Colts", 1, 3), r("GENZY", "Giants", 2, 3), r("JOEY", "Jaguars", 3, 2), r("DECK", "Dolphins", 2, 3),
    r("MAINE", "Panthers", 1, 5), r("TRAW", "Buccaneers", 1, 5), r("RED", "Cowboys", 3, 3, [12, 17]), r("KENNY", "Lions", 4, 4),
    r("SAL", "Steelers", 5, 5, [15, 17]), r("YUNGLAW", "Titans", 0, 6, [2, 17]),
  ],
};

/** The seed for a league, by slug (or a league name with NCL in it). */
export function seedFor(slug: string, name: string): Seed | null {
  if (slug === "ncl" || /\bncl\b/i.test(name)) return NCL;
  if (/^eml/i.test(slug) || /\beml/i.test(name)) return EML;
  return null;
}
