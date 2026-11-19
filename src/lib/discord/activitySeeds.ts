// Activity from before the bot tracked it, for #activity-tracker-cycle (Nick, 2026-11-19: "i have attached
// the existing seasons activity tracking as well so it can be current"). From NCL's activity sheet:
// 17 games a season for every user; misses per season. Matched to teams by nickname (the sheet's ARZ is
// Madden's ARI). Applied once, when /activitychannels runs in that league; the team's EA user at that
// moment is recorded, so the counts stay with the person if they later move teams.
// left: the user is gone; his numbers stay under his name and never grow.
// teamNames: a new user on a team, starting at 0; every game of that team from now on counts for him,
// whatever EA account runs it. Bump `version` after a change so a league already set up picks it up.
export type SeedRow = { name: string; team: string; misses: number[]; left?: boolean };
export type Seed = { version: number; seasons: string[]; gamesPerSeason: number; rows: SeedRow[]; teamNames?: Record<string, string> };

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

/** The seed for a league, by slug (or a league name with NCL in it). */
export function seedFor(slug: string, name: string): Seed | null {
  if (slug === "ncl" || /\bncl\b/i.test(name)) return NCL;
  return null;
}
