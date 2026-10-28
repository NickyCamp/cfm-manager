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
  gone?: boolean;        // no longer in the league (kept so old stat lines keep a name)
};

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
  season: { year: number; stage: number; week: number; title: string; secsSinceAdvance: number | null };
  weeks: Week[];
  teams: Team[];
  players: Player[];
  games: Game[];
  lines: StatLine[];
  teamGames: TeamGame[];
};

export const DEV_LABEL = ["Normal", "Star", "Superstar", "X-Factor"] as const;
