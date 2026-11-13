// Which ratings go on the back of a player's trading card.
// Every card shows the athletic core (speed, acceleration, strength), then the
// ratings that matter for the player's position.
import { RATING_KEYS, type RatingKey } from "./ratings";
import type { Player } from "./types";
import type { Totals } from "./derive";

const CORE: RatingKey[] = ["speedRating", "accelRating", "strengthRating"];

const GROUP: Record<string, string> = {
  QB: "QB", HB: "HB", FB: "FB", WR: "WR", TE: "TE",
  LT: "OL", LG: "OL", C: "OL", RG: "OL", RT: "OL",
  LEDG: "EDGE", REDG: "EDGE", LE: "EDGE", RE: "EDGE", DT: "DT",
  SAM: "LB", MIKE: "LB", WILL: "LB", LOLB: "LB", MLB: "LB", ROLB: "LB",
  CB: "CB", FS: "S", SS: "S", K: "K", P: "K",
};

const BY_GROUP: Record<string, RatingKey[]> = {
  QB: ["throwPowerRating", "throwAccShortRating", "throwAccMidRating", "throwAccDeepRating", "throwOnRunRating", "throwUnderPressureRating"],
  HB: ["carryRating", "bCVRating", "breakTackleRating", "jukeMoveRating", "truckRating", "catchRating"],
  FB: ["leadBlockRating", "impactBlockRating", "runBlockRating", "carryRating", "truckRating", "catchRating"],
  WR: ["catchRating", "cITRating", "specCatchRating", "routeRunShortRating", "routeRunMedRating", "routeRunDeepRating", "releaseRating"],
  TE: ["catchRating", "cITRating", "routeRunShortRating", "routeRunMedRating", "runBlockRating", "passBlockRating"],
  OL: ["passBlockRating", "passBlockPowerRating", "passBlockFinesseRating", "runBlockRating", "runBlockPowerRating", "impactBlockRating"],
  EDGE: ["powerMovesRating", "finesseMovesRating", "blockShedRating", "pursuitRating", "tackleRating", "playRecRating"],
  DT: ["powerMovesRating", "blockShedRating", "finesseMovesRating", "tackleRating", "pursuitRating", "playRecRating"],
  LB: ["tackleRating", "hitPowerRating", "pursuitRating", "playRecRating", "zoneCoverRating", "blockShedRating"],
  CB: ["manCoverRating", "zoneCoverRating", "pressRating", "playRecRating", "changeOfDirectionRating", "catchRating"],
  S: ["zoneCoverRating", "manCoverRating", "playRecRating", "tackleRating", "hitPowerRating", "pursuitRating"],
  K: ["kickPowerRating", "kickAccRating", "awareRating"],
};

const SHORT: Partial<Record<RatingKey, string>> = {
  speedRating: "Speed", accelRating: "Acceleration", strengthRating: "Strength",
  throwPowerRating: "Throw power", throwAccShortRating: "Short accuracy", throwAccMidRating: "Mid accuracy",
  throwAccDeepRating: "Deep accuracy", throwOnRunRating: "Throw on run", throwUnderPressureRating: "Under pressure",
  carryRating: "Carrying", bCVRating: "Ball carrier vision", breakTackleRating: "Break tackle", jukeMoveRating: "Juke move",
  truckRating: "Trucking", catchRating: "Catching", leadBlockRating: "Lead block", impactBlockRating: "Impact block",
  runBlockRating: "Run block", cITRating: "Catch in traffic", specCatchRating: "Spectacular catch",
  routeRunShortRating: "Short routes", routeRunMedRating: "Medium routes", routeRunDeepRating: "Deep routes",
  releaseRating: "Release", passBlockRating: "Pass block", passBlockPowerRating: "Pass block power",
  passBlockFinesseRating: "Pass block finesse", runBlockPowerRating: "Run block power",
  powerMovesRating: "Power moves", finesseMovesRating: "Finesse moves", blockShedRating: "Block shedding",
  pursuitRating: "Pursuit", tackleRating: "Tackle", playRecRating: "Play recognition", hitPowerRating: "Hit power",
  zoneCoverRating: "Zone coverage", manCoverRating: "Man coverage", pressRating: "Press",
  changeOfDirectionRating: "Change of direction", kickPowerRating: "Kick power", kickAccRating: "Kick accuracy",
  awareRating: "Awareness",
};

// Madden-style three-letter abbreviations for the card back.
const ABBR: Partial<Record<RatingKey, string>> = {
  speedRating: "SPD", accelRating: "ACC", strengthRating: "STR", awareRating: "AWR",
  throwPowerRating: "THP", throwAccShortRating: "SAC", throwAccMidRating: "MAC", throwAccDeepRating: "DAC",
  throwOnRunRating: "TOR", throwUnderPressureRating: "TUP", carryRating: "CAR", bCVRating: "BCV",
  breakTackleRating: "BTK", jukeMoveRating: "JKM", truckRating: "TRK", catchRating: "CTH",
  leadBlockRating: "LBK", impactBlockRating: "IBL", runBlockRating: "RBK", cITRating: "CIT",
  specCatchRating: "SPC", routeRunShortRating: "SRR", routeRunMedRating: "MRR", routeRunDeepRating: "DRR",
  releaseRating: "RLS", passBlockRating: "PBK", passBlockPowerRating: "PBP", passBlockFinesseRating: "PBF",
  runBlockPowerRating: "RBP", powerMovesRating: "PMV", finesseMovesRating: "FMV", blockShedRating: "BSH",
  pursuitRating: "PUR", tackleRating: "TAK", playRecRating: "PRC", hitPowerRating: "HPW",
  zoneCoverRating: "ZCV", manCoverRating: "MCV", pressRating: "PRS", changeOfDirectionRating: "COD",
  kickPowerRating: "KPW", kickAccRating: "KAC",
};

export type CardStat = { abbr: string; label: string; value: number; core: boolean };

export function cardStats(p: Player): CardStat[] {
  if (!p.ratings) return [];
  const val = (k: RatingKey) => p.ratings![RATING_KEYS.indexOf(k)] ?? 0;
  const group = GROUP[p.pos] ?? "";
  const core = CORE;
  const pos = BY_GROUP[group] ?? ["awareRating"];
  return [
    ...core.map((k) => ({ abbr: ABBR[k] ?? "", label: SHORT[k] ?? k, value: val(k), core: true })),
    ...pos.map((k) => ({ abbr: ABBR[k] ?? "", label: SHORT[k] ?? k, value: val(k), core: false })),
  ];
}

// ---------- card back: this season's numbers ----------


export type SeasonItem = { label: string; value: string; rank?: string };

const ordinal = (n: number) => { const t = ["th", "st", "nd", "rd"], v = n % 100; return n + (t[(v - 20) % 10] || t[v] || t[0]); };

/** Up to four regular-season numbers for the card back, picked by position, each with the
 *  player's rank among his position group (QBs among QBs, as on the dev tracker; 1st = most;
 *  rates only count players with enough attempts). posOf: player id → position. */
export function seasonCardStats(p: Player, all: Map<number, Totals>, posOf: Map<number, string>): SeasonItem[] {
  const t = all.get(p.id);
  const n = (v: number) => v.toLocaleString("en-US");
  const gp: SeasonItem = { label: "GP", value: String(t?.gp ?? 0) };
  if (!t || !t.gp) return [gp];
  const myGroup = GROUP[p.pos] ?? p.pos;
  const rows = [...all.entries()].filter(([id]) => { const pos = posOf.get(id) || ""; return (GROUP[pos] ?? pos) === myGroup; }).map(([, x]) => x);
  const item = (label: string, value: string, f: (x: Totals) => number, qualifies: (x: Totals) => boolean = () => true): SeasonItem => {
    const mine = f(t);
    if (!(mine > 0) || !qualifies(t)) return { label, value };
    const better = rows.filter((x) => qualifies(x) && f(x) > mine).length;
    const tied = rows.filter((x) => qualifies(x) && f(x) === mine).length > 1;
    return { label, value, rank: `${tied ? "T-" : ""}${ordinal(better + 1)}` };
  };
  const g = GROUP[p.pos] ?? "";
  if (g === "QB") return [gp, item("Pass yds", n(t.py), (x) => x.py), item("TD", String(t.ptd), (x) => x.ptd), item("INT", String(t.pint), (x) => x.pint)];
  if (g === "HB" || g === "FB") return [gp, item("Rush yds", n(t.ry), (x) => x.ry), item("YPC", t.ra ? (t.ry / t.ra).toFixed(1) : "0.0", (x) => (x.ra ? x.ry / x.ra : 0), (x) => x.ra >= 50), item("TD", String(t.rtd + t.rctd), (x) => x.rtd + x.rctd)];
  if (g === "WR" || g === "TE") return [gp, item("Rec", String(t.rc), (x) => x.rc), item("Rec yds", n(t.rcy), (x) => x.rcy), item("TD", String(t.rctd), (x) => x.rctd)];
  if (g === "CB" || g === "S") return [gp, item("Tkl", String(t.tk), (x) => x.tk), item("INT", String(t.int), (x) => x.int), item("PD", String(t.pd), (x) => x.pd)];
  if (g === "EDGE" || g === "DT" || g === "LB") return [gp, item("Tkl", String(t.tk), (x) => x.tk), item("Sacks", String(t.sk), (x) => x.sk), item("FF", String(t.ff), (x) => x.ff)];
  if (p.pos === "K") return [gp, item("FG", `${t.fgm}/${t.fga}`, (x) => x.fgm), item("Long", String(t.fglng), (x) => x.fglng), item("XP", `${t.xpm}/${t.xpa}`, (x) => x.xpm)];
  if (p.pos === "P") return [gp, item("Punts", String(t.pnt), (x) => x.pnt), item("Avg", t.pnt ? (t.pnty / t.pnt).toFixed(1) : "0.0", (x) => (x.pnt ? x.pnty / x.pnt : 0), (x) => x.pnt >= 15), item("In 20", String(t.pnt20), (x) => x.pnt20)];
  return [gp]; // linemen: Madden exports no blocking stats
}
