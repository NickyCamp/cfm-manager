// /funfact: one roast per bad rating (Nick, 2026-11-18: "low awareness, it's a surprise they can even
// figure out how to get dressed for the day, bad ball carrier vision, someone needs to get this guy
// a map"). Each rating at or under its bar becomes its own keyed fact; ratings that matter for his
// position count for more, and only his worst few are used so one player doesn't drown in them.
import type { Player } from "../league/types";
import { RATING_KEYS } from "../league/ratings";
import { pick, tail, type Fact } from "./factFormat";

// {w} = his last name, {v} = the rating.
const LINES: Record<string, string[]> = {
  awareRating: [
    "{w} has **{v} Awareness**. Honestly a surprise he can figure out how to get dressed for the day.",
    "**{v} Awareness**. {w} has walked into the wrong locker room twice this season.",
    "{w} (**{v} AWR**) still thinks the game is on Saturday.",
    "With **{v} Awareness**, {w} needs a reminder which way his team is going.",
  ],
  bCVRating: [
    "{w} has **{v} Ball Carrier Vision**. Someone needs to get this guy a map.",
    "**{v} BCV**. {w} runs straight into his own linemen's backs like it's on purpose.",
    "{w} has **{v} Ball Carrier Vision**. Siri could find the hole faster.",
    "**{v} BCV**: {w} couldn't find a running lane with GPS and a flashlight.",
  ],
  catchRating: [
    "{w} has **{v} Catching**. He's dropped more balls than a bowling alley.",
    "**{v} Catching**. The ball hits {w} in the hands and he takes it personally.",
    "{w} (**{v} CTH**) catches like he's wearing oven mitts.",
  ],
  cITRating: ["**{v} Catch in Traffic**. {w} hears footsteps and lets go.", "{w} has **{v} CIT**. One defender nearby and the ball is gone."],
  specCatchRating: ["{w} has **{v} Spectacular Catch**. The only highlight he's ever been on is someone else's."],
  carryRating: [
    "{w} has **{v} Carrying**. Holds the football like it's a newborn he didn't want.",
    "**{v} Carrying**. {w} fumbles in his sleep.",
  ],
  speedRating: [
    "{w} has **{v} Speed**. Linebackers lap him.",
    "**{v} Speed**. {w} gets passed by the refs jogging downfield.",
    "{w} runs a **{v} Speed**. You could time him with a calendar.",
  ],
  accelRating: ["{w} has **{v} Acceleration**. Takes him three business days to reach top speed.", "**{v} Acceleration**. {w} starts like a 2004 minivan."],
  agilityRating: ["{w} has **{v} Agility**. Turns like a cruise ship.", "**{v} Agility**. {w} needs a three-point turn to change direction."],
  changeOfDirectionRating: ["**{v} Change of Direction**. {w} needs a whole parking lot to turn around."],
  jumpRating: ["{w} has **{v} Jumping**. Can't get over a phone book.", "**{v} Jump**. {w} has never once touched a doorframe."],
  strengthRating: ["{w} has **{v} Strength**. Loses arm wrestling to the kicker.", "**{v} Strength**. {w} needs help opening Gatorade."],
  tackleRating: [
    "{w} has **{v} Tackling**. Tackles like he's giving hugs at a family reunion.",
    "**{v} Tackle**. Ball carriers bounce off {w} like he's a pool noodle.",
  ],
  hitPowerRating: ["{w} has **{v} Hit Power**. Getting hit by him feels like a high five."],
  pursuitRating: ["**{v} Pursuit**. {w} chases ball carriers like he's late for nothing."],
  playRecRating: ["{w} has **{v} Play Recognition**. Still trying to figure out what happened on the last snap.", "**{v} Play Rec**. {w} bites on every fake, every time."],
  blockShedRating: ["{w} has **{v} Block Shedding**. A tight end can hold him all day with one arm."],
  powerMovesRating: ["**{v} Power Moves**. {w} bull rushes like a golden retriever."],
  finesseMovesRating: ["**{v} Finesse Moves**. {w} has exactly one pass rush move and it's falling down."],
  manCoverRating: ["{w} has **{v} Man Coverage**. Receivers wave at him on the way by.", "**{v} Man Coverage**. {w} is covering air."],
  zoneCoverRating: ["{w} has **{v} Zone Coverage**. His zone is a suggestion.", "**{v} Zone**. {w} gets lost in his own area of the field."],
  pressRating: ["**{v} Press**. Receivers get off {w} at the line like he's not there."],
  routeRunShortRating: ["{w} has **{v} Short Route Running**. Can't run a slant without a diagram."],
  routeRunMedRating: ["**{v} Medium Route Running**. {w} rounds off every route like he's driving a bus."],
  routeRunDeepRating: ["{w} has **{v} Deep Route Running**. The go route is the only one he knows and he still messes it up."],
  releaseRating: ["**{v} Release**. {w} gets jammed at the line by safeties."],
  throwPowerRating: ["{w} has **{v} Throw Power**. His deep ball needs a tailwind and a prayer.", "**{v} THP**. {w} throws like he's skipping rocks."],
  throwAccShortRating: ["{w} has **{v} Short Accuracy**. He misses screens. Screens.", "**{v} Short Accuracy**. Five-yard passes are a coin flip for {w}."],
  throwAccMidRating: ["{w} has **{v} Medium Accuracy**. Everything over 10 yards is a guess."],
  throwAccDeepRating: ["{w} has **{v} Deep Accuracy**. His deep ball lands in the parking lot.", "**{v} Deep Accuracy**. {w} throws it deep and hopes the defense is feeling generous."],
  throwOnRunRating: ["**{v} Throw on the Run**. Make {w} move and the ball goes anywhere but the receiver."],
  throwUnderPressureRating: ["{w} has **{v} Throw Under Pressure**. One defender breathes on him and he folds.", "**{v} TUP**. {w} panics when the pocket gets slightly warm."],
  playActionRating: ["**{v} Play Action**. Nobody bites on {w}'s fakes, not even his own linemen."],
  breakSackRating: ["{w} has **{v} Break Sack**. Goes down if a linebacker sneezes near him."],
  breakTackleRating: ["{w} has **{v} Break Tackle**. One finger tackles him.", "**{v} Break Tackle**. Arm tackles are a death sentence for {w}."],
  truckRating: ["**{v} Trucking**. {w} runs into defenders and apologizes."],
  jukeMoveRating: ["{w} has **{v} Juke Move**. His jukes fool nobody, not even the camera."],
  stiffArmRating: ["**{v} Stiff Arm**. {w} stiff arms like he's waving hello."],
  passBlockRating: ["{w} has **{v} Pass Block**. His QB has him saved in his phone as 'traitor'.", "**{v} Pass Block**. {w} is a turnstile with a jersey."],
  runBlockRating: ["{w} has **{v} Run Block**. Gets pushed back into his own running back.", "**{v} Run Block**. Running backs avoid {w}'s gap on purpose."],
  impactBlockRating: ["**{v} Impact Block**. {w} blocks like he's holding a door open."],
  kickAccRating: ["{w} has **{v} Kick Accuracy**. The uprights fear nothing from him.", "**{v} Kick Accuracy**. {w} aims small and misses everywhere."],
  kickPowerRating: ["{w} has **{v} Kick Power**. A 40-yarder is a Hail Mary for him."],
  staminaRating: ["{w} has **{v} Stamina**. Needs an oxygen tank after the national anthem."],
  toughRating: ["**{v} Toughness**. {w} asks to come out after paper cuts."],
};

// Which ratings matter at each position (they get more weight and a higher bar).
const POS_KEYS: Record<string, string[]> = {
  QB: ["awareRating", "throwPowerRating", "throwAccShortRating", "throwAccMidRating", "throwAccDeepRating", "throwOnRunRating", "throwUnderPressureRating", "playActionRating", "breakSackRating"],
  HB: ["awareRating", "bCVRating", "carryRating", "speedRating", "accelRating", "agilityRating", "breakTackleRating", "truckRating", "jukeMoveRating", "stiffArmRating", "catchRating"],
  FB: ["awareRating", "carryRating", "runBlockRating", "impactBlockRating", "truckRating"],
  WR: ["awareRating", "catchRating", "cITRating", "specCatchRating", "speedRating", "routeRunShortRating", "routeRunMedRating", "routeRunDeepRating", "releaseRating", "jumpRating"],
  TE: ["awareRating", "catchRating", "cITRating", "runBlockRating", "passBlockRating", "routeRunShortRating", "speedRating"],
  OL: ["awareRating", "passBlockRating", "runBlockRating", "impactBlockRating", "strengthRating"],
  DL: ["awareRating", "blockShedRating", "powerMovesRating", "finesseMovesRating", "pursuitRating", "tackleRating", "playRecRating", "strengthRating"],
  LB: ["awareRating", "tackleRating", "pursuitRating", "playRecRating", "zoneCoverRating", "manCoverRating", "blockShedRating", "hitPowerRating", "speedRating"],
  DB: ["awareRating", "manCoverRating", "zoneCoverRating", "pressRating", "speedRating", "playRecRating", "tackleRating", "jumpRating", "catchRating"],
  K: ["kickAccRating", "kickPowerRating"], P: ["kickAccRating", "kickPowerRating"],
};
const GROUP: Record<string, string> = {
  QB: "QB", HB: "HB", FB: "FB", WR: "WR", TE: "TE", LT: "OL", LG: "OL", C: "OL", RG: "OL", RT: "OL",
  LEDG: "DL", REDG: "DL", LE: "DL", RE: "DL", DT: "DL", SAM: "LB", MIKE: "LB", WILL: "LB", LOLB: "LB", MLB: "LB", ROLB: "LB",
  CB: "DB", FS: "DB", SS: "DB", K: "K", P: "P",
};

export function ratingRoasts(p: Player): Fact[] {
  if (!p.ratings) return [];
  const mine = POS_KEYS[GROUP[p.pos] || ""] || [];
  const bad: { k: string; v: number; w: number }[] = [];
  for (const k of Object.keys(LINES)) {
    const v = p.ratings[RATING_KEYS.indexOf(k as (typeof RATING_KEYS)[number])] ?? 0;
    if (!v) continue;
    const relevant = mine.includes(k);
    // Position ratings: bad under 75 (kickers under 80). Everything else only when it's comical.
    const bar = relevant ? (p.pos === "K" || p.pos === "P" ? 80 : 75) : 40;
    if (v > bar) continue;
    bad.push({ k, v, w: relevant ? 3.5 + (bar - v) / 20 : 1.5 });
  }
  bad.sort((a, b) => b.w - a.w);
  return bad.slice(0, 6).map(({ k, v, w }) => ({
    key: `p:r_${k}`,
    weight: w,
    text: tail(pick(LINES[k]).replaceAll("{w}", p.last).replaceAll("{v}", String(v)), 0.35),
  }));
}
