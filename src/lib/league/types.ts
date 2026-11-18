// The per-league data file the sync worker builds from each EA pull
// (league-data/<slug>/data.json.gz) and the league pages read.
// Money is in whole dollars. Ids are EA's.

export const DATA_VERSION = 1;

export type Week = { stage: number; week: number; title: string; games: number; played: number };

export type Team = {
  id: number;
  abbr: string;
  city: string;
  name: string;          // "Packers"
  primary: string;       // "#203731"
  secondary: string;
  division: string;      // "NFC North"
  conference: string;    // "NFC"
  user: string;          // PSN/Xbox name of the person running the team, "" for CPU
  ovr: number;
  cap: { room: number; spent: number; available: number };
  rec: {
    w: number; l: number; t: number; pct: number;
    divW: number; divL: number; divT: number;
    confW: number; confL: number; confT: number;
    homeW: number; homeL: number; homeT: number;
    awayW: number; awayL: number; awayT: number;
    pf: number; pa: number;
    streak: number;      // +3 = won 3, -2 = lost 2
    seed: number;        // EA's own playoff seed (0 = none)
    rank: number;        // EA power rank
  };
  ranks: { offYds: number; defYds: number; offPass: number; offRush: number; defPass: number; defRush: number };
};

export type Contract = {
  length: number;
  yearsLeft: number;
  salary: number;        // total base salary over the deal
  bonus: number;         // total signing bonus
  capHit: number;        // this season
  releasePenalty: number;
  releaseSavings: number;
};

export type Player = {
  id: number;
  team: number;          // 0 = free agent
  first: string;
  last: string;
  pos: string;
  age: number;
  ovr: number;
  dev: 0 | 1 | 2 | 3;    // Normal, Star, Superstar, X-Factor
  jersey: number;
  yearsPro: number;
  college: string;
  height: number;        // inches
  weight: number;
  draft: { round: number; pick: number; year: number };
  ps: boolean;           // practice squad
  ir: boolean;
  injury: number;        // weeks out, 0 = healthy
  contract: Contract;
  abilities: { title: string; tier: string }[];
  // Added 2026-10-28 (older builds lack them until the next sync / rebuild):
  ratings?: number[];    // in RATING_KEYS order (ratings.ts)
  traits?: number[];     // in LeagueData.traitKeys order; true/false as 1/0 (added 2026-11-17)
  slots?: { ovr: number; locked: boolean; title: string; tier: string }[]; // ability slots; ovr 0 = X-Factor slot
  desired?: { salary: number; bonus: number; length: number }; // Madden's in-game ask (added 2026-10-28)
  gone?: boolean;        // no longer in the league (kept so old stat lines keep a name)
  born?: string;         // "YYYY-MM-DD" from EA (added 2026-11-12; used to match real-player headshots)
  // EA's portrait for the player (added 2026-11-13). game: which EA ratings-site folder has the
  // picture (27 for real players; generated draft-class faces only exist under 26). Set by the worker.
  portrait?: { id: number; game?: number };
  block?: boolean;       // on Madden's in-game trade block (EA roster flag; see LeagueData.blockKey)
  nick?: string;         // nickname set by the team's manager; not in data.json, applied at read time (nicknameStore.ts)
  /** A restructure seen in the transaction log for his current deal; set at load time (history.ts). */
  restructure?: Restructure;
};

/** A restructure: the deal before (as of capYear `fromYear`), and the season it took effect. */
export type Restructure = { before: Contract; fromYear: number; year: number };

export type Game = {
  id: number;            // scheduleId
  stage: number;         // 0 preseason, 1 regular season + playoffs
  week: number;
  home: number;
  away: number;
  hs: number;
  as: number;
  final: boolean;
  simmed: boolean | null; // null = unknown
  gotw: boolean;
};

// One player's line in one game. Only the fields a line actually has are present.
export type StatLine = {
  g: number; p: number; t: number;
  pa?: number; pc?: number; py?: number; ptd?: number; pint?: number; plng?: number; psk?: number;
  ra?: number; ry?: number; rtd?: number; rlng?: number; rfum?: number; rbt?: number;
  rc?: number; rcy?: number; rctd?: number; rclng?: number; rcdrop?: number; rcyac?: number;
  tk?: number; sk?: number; int?: number; ff?: number; fr?: number; dtd?: number; pd?: number; sfty?: number;
  fga?: number; fgm?: number; fglng?: number; xpa?: number; xpm?: number;
  pnt?: number; pnty?: number; pntnet?: number; pnt20?: number; pntlng?: number;
};

export type TeamGame = {
  g: number; t: number;
  yds: number; passYds: number; rushYds: number; firstDowns: number;
  third: [number, number]; fourth: [number, number]; redZone: [number, number];
  turnovers: number; takeaways: number; sacks: number; penalties: number; penaltyYds: number;
};

export type LeagueData = {
  version: number;
  builtAt: string;
  pulledAt: string;
  /** stage: 0 preseason, 1 regular season + playoffs, 2 offseason (see league/phase.ts) */
  season: {
    year: number; stage: number; week: number; title: string; secsSinceAdvance: number | null;
    /** The season EA's contracts and team caps describe. Madden rolls contracts over to next
     *  season early in the offseason (years left drop, cap hits become next season's) while
     *  the calendar year stays put; then this is year + 1. Missing = year. (2026-11-16) */
    capYear?: number;
  };
  weeks: Week[];
  teams: Team[];
  players: Player[];
  games: Game[];
  lines: StatLine[];
  teamGames: TeamGame[];
  /** Madden's own commissioners (EA league hub: owner and admins), refreshed on every sync. */
  admins?: { user: string; team: string; level: "owner" | "admin" }[];
  /** Coming seasons' league caps Madden has already set (added on load, see KNOWN_LEAGUE_CAPS). */
  knownCaps?: Record<number, number>;
  /** Madden's award winners for this season, entered by a commissioner (Admin page): market key →
   *  player id (team id for award-coy). Added on load from leagues.settings.awards[year]. */
  awardResults?: Record<string, string>;
  /** EA's player trait fields (clutchTrait, qBStyleTrait, …) in the order Player.traits stores them. */
  traitKeys?: string[];
  /** The EA roster field that says a player is on the trade block, when EA sends one (added 2026-11-18). */
  blockKey?: string;
};

export const DEV_LABEL = ["Normal", "Star", "Superstar", "X-Factor"] as const;
