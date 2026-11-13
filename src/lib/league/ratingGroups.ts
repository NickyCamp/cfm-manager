// All 56 player ratings in groups for the player page's Ratings tab, with the
// groups that matter for his position first.
import { RATING_KEYS, RATING_LABEL, type RatingKey } from "./ratings";
import type { Player } from "./types";

export const RATING_GROUPS: [string, RatingKey[]][] = [
  ["Physical", ["speedRating", "accelRating", "agilityRating", "changeOfDirectionRating", "strengthRating", "jumpRating", "staminaRating", "toughRating", "injuryRating", "awareRating"]],
  ["Passing", ["throwPowerRating", "throwAccShortRating", "throwAccMidRating", "throwAccDeepRating", "throwAccRating", "throwOnRunRating", "throwUnderPressureRating", "playActionRating", "breakSackRating"]],
  ["Ball carrying", ["carryRating", "bCVRating", "breakTackleRating", "jukeMoveRating", "spinMoveRating", "stiffArmRating", "truckRating"]],
  ["Receiving", ["catchRating", "cITRating", "specCatchRating", "releaseRating", "routeRunShortRating", "routeRunMedRating", "routeRunDeepRating"]],
  ["Blocking", ["passBlockRating", "passBlockPowerRating", "passBlockFinesseRating", "runBlockRating", "runBlockPowerRating", "runBlockFinesseRating", "leadBlockRating", "impactBlockRating"]],
  ["Pass rush and run defense", ["powerMovesRating", "finesseMovesRating", "blockShedRating", "tackleRating", "hitPowerRating", "pursuitRating", "playRecRating"]],
  ["Coverage", ["manCoverRating", "zoneCoverRating", "pressRating"]],
  ["Special teams", ["kickPowerRating", "kickAccRating", "kickRetRating", "longSnapRating"]],
  ["Other", ["confRating"]],
];

const FIRST: Record<string, string[]> = {
  QB: ["Passing"], HB: ["Ball carrying", "Receiving"], FB: ["Blocking", "Ball carrying"],
  WR: ["Receiving", "Ball carrying"], TE: ["Receiving", "Blocking"],
  LT: ["Blocking"], LG: ["Blocking"], C: ["Blocking"], RG: ["Blocking"], RT: ["Blocking"],
  LEDG: ["Pass rush and run defense"], REDG: ["Pass rush and run defense"], LE: ["Pass rush and run defense"], RE: ["Pass rush and run defense"], DT: ["Pass rush and run defense"],
  SAM: ["Pass rush and run defense", "Coverage"], MIKE: ["Pass rush and run defense", "Coverage"], WILL: ["Pass rush and run defense", "Coverage"],
  CB: ["Coverage", "Pass rush and run defense"], FS: ["Coverage", "Pass rush and run defense"], SS: ["Coverage", "Pass rush and run defense"],
  K: ["Special teams"], P: ["Special teams"],
};

export type RatingRow = { key: RatingKey; label: string; value: number };

/** The player's ratings in groups, most relevant first. Empty if this build has no ratings. */
export function ratingGroups(p: Player): { name: string; rows: RatingRow[] }[] {
  if (!p.ratings) return [];
  const val = (k: RatingKey) => p.ratings![RATING_KEYS.indexOf(k)] ?? 0;
  const first = FIRST[p.pos] || [];
  const ordered = [...RATING_GROUPS].sort(([a], [b]) => {
    const ia = first.indexOf(a), ib = first.indexOf(b);
    const ra = ia >= 0 ? ia : a === "Physical" ? first.length : 99;
    const rb = ib >= 0 ? ib : b === "Physical" ? first.length : 99;
    return ra - rb;
  });
  return ordered.map(([name, keys]) => ({ name, rows: keys.map((k) => ({ key: k, label: RATING_LABEL[k] || k, value: val(k) })) }));
}
