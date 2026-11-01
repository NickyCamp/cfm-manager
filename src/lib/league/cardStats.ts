// Which ratings go on the back of a player's trading card.
// Every card shows the athletic core (speed, acceleration, strength), then the
// ratings that matter for the player's position.
import { RATING_KEYS, type RatingKey } from "./ratings";
import type { Player } from "./types";

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

export type CardStat = { label: string; value: number; core: boolean };

export function cardStats(p: Player): CardStat[] {
  if (!p.ratings) return [];
  const val = (k: RatingKey) => p.ratings![RATING_KEYS.indexOf(k)] ?? 0;
  const group = GROUP[p.pos] ?? "";
  const core = CORE;
  const pos = BY_GROUP[group] ?? ["awareRating"];
  return [
    ...core.map((k) => ({ label: SHORT[k] ?? k, value: val(k), core: true })),
    ...pos.map((k) => ({ label: SHORT[k] ?? k, value: val(k), core: false })),
  ];
}
