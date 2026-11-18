// /funfact: one roast per bad rating (Nick, 2026-11-18: "low awareness, it's a surprise they can even
// figure out how to get dressed for the day, bad ball carrier vision, someone needs to get this guy
// a map"). Each rating at or under its bar becomes its own keyed fact; only ratings that matter for his
// position count, and only his worst few are used so one player doesn't drown in them.
import type { Player } from "../league/types";
import { RATING_KEYS } from "../league/ratings";
import { pick, tail, type Fact } from "./factFormat";

// {w} = his last name, {v} = the rating.
const LINES: Record<string, string[]> = {
  awareRating: [
    "{w} has **{v} Awareness**. Dan Orlovsky ran out the back of the end zone and still had more.",
    "**{v} Awareness**. {w} has been concussed since birth and nobody told him.",
    "{w} plays with **{v} Awareness**, which is the football version of a toddler loose on the highway.",
    "{w} has **{v} Awareness**. Honestly a surprise he can figure out how to get dressed for the day.",
    "**{v} Awareness**. {w} has walked into the wrong locker room twice this season.",
    "{w} (**{v} AWR**) still thinks the game is on Saturday.",
    "With **{v} Awareness**, {w} needs a reminder which way his team is going.",
  ],
  bCVRating: [
    "**{v} BCV**. {w} couldn't find a hole if GTA 6 gave him a minimap.",
    "**{v} BCV**. {w} runs into the pile like he's trying to get murdered.",
    "{w} (**{v} BCV**) has the vision of a blindfolded mole in a hurricane.",
    "{w} has **{v} Ball Carrier Vision**. Someone needs to get this guy a map.",
    "**{v} BCV**. {w} runs straight into his own linemen's backs like it's on purpose.",
    "{w} has **{v} Ball Carrier Vision**. Siri could find the hole faster.",
    "**{v} BCV**: {w} couldn't find a running lane with GPS and a flashlight.",
  ],
  catchRating: [
    "{w} has **{v} Catching**. Like OJ's glove, the football just doesn't fit.",
    "**{v} Catching**. {w} should have his hands amputated and replaced with something useful.",
    "{w} has **{v} Catching**. The football is scared of him and honestly so are we.",
    "{w} has **{v} Catching**. He's dropped more balls than a bowling alley.",
    "**{v} Catching**. The ball hits {w} in the hands and he takes it personally.",
    "{w} (**{v} CTH**) catches like he's wearing oven mitts.",
  ],
  cITRating: ["**{v} Catch in Traffic**. {w} hears footsteps and lets go.", "{w} has **{v} CIT**. One defender nearby and the ball is gone."],
  specCatchRating: ["{w} has **{v} Spectacular Catch**. The only highlight he's ever been on is someone else's."],
  carryRating: [
    "**{v} Carrying**. {w} handles the ball like Plaxico handled that gun in the club.",
    "**{v} Carrying**. {w} hands the ball to the defense like it's a ransom payment.",
    "{w} has **{v} Carrying**. Holds the football like it's a newborn he didn't want.",
    "**{v} Carrying**. {w} fumbles in his sleep.",
  ],
  speedRating: [
    "{w} has **{v} Speed**. OJ's Bronco chase hit higher top speeds.",
    "{w} has **{v} Speed**. Defenders aren't tackling him, they're euthanizing him.",
    "**{v} Speed**. {w} gets caught from behind by the guy who just checked in.",
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
    "{w} has **{v} Tackle**. Mall cops bring guys down cleaner than this.",
    "**{v} Tackling**. {w} gets dragged like a body behind a getaway car.",
    "{w} has **{v} Tackle**. Running backs use him as a stepping stone and a crash mat.",
    "{w} has **{v} Tackling**. Tackles like he's giving hugs at a family reunion.",
    "**{v} Tackle**. Ball carriers bounce off {w} like he's a pool noodle.",
  ],
  hitPowerRating: ["{w} has **{v} Hit Power**. Getting hit by him feels like a high five."],
  pursuitRating: ["**{v} Pursuit**. {w} chases ball carriers like he's late for nothing."],
  playRecRating: [
    "**{v} Play Rec**. {w} falls for fakes like a boomer falls for Facebook scams.",
    "**{v} Play Rec**. {w} gets fooled so badly he should sue for fraud.","{w} has **{v} Play Recognition**. Still trying to figure out what happened on the last snap.", "**{v} Play Rec**. {w} bites on every fake, every time."],
  blockShedRating: [
    "{w} has **{v} Block Shedding**. Linemen bury him and plant flowers on top.","{w} has **{v} Block Shedding**. A tight end can hold him all day with one arm."],
  powerMovesRating: ["**{v} Power Moves**. {w} bull rushes like a golden retriever."],
  finesseMovesRating: ["**{v} Finesse Moves**. {w} has exactly one pass rush move and it's falling down."],
  manCoverRating: [
    "**{v} Man Coverage**. {w} leaves receivers more open than a classified document at a resort.",
    "**{v} Man Coverage**. {w} gets cooked so badly they should call the fire department.",
    "{w} (**{v} MCV**) gets roasted, toasted and buried every Sunday.","{w} has **{v} Man Coverage**. Receivers wave at him on the way by.", "**{v} Man Coverage**. {w} is covering air."],
  zoneCoverRating: [
    "**{v} Zone Coverage**. {w} stands in his zone like a crime scene witness who saw nothing.","{w} has **{v} Zone Coverage**. His zone is a suggestion.", "**{v} Zone**. {w} gets lost in his own area of the field."],
  pressRating: ["**{v} Press**. Receivers get off {w} at the line like he's not there."],
  routeRunShortRating: ["{w} has **{v} Short Route Running**. Can't run a slant without a diagram."],
  routeRunMedRating: ["**{v} Medium Route Running**. {w} rounds off every route like he's driving a bus."],
  routeRunDeepRating: ["{w} has **{v} Deep Route Running**. The go route is the only one he knows and he still messes it up."],
  releaseRating: ["**{v} Release**. {w} gets jammed at the line by safeties."],
  throwPowerRating: [
    "{w} has **{v} Throw Power**. Spirals die in the air like a shot bird.","{w} has **{v} Throw Power**. His deep ball needs a tailwind and a prayer.", "**{v} THP**. {w} throws like he's skipping rocks."],
  throwAccShortRating: ["{w} has **{v} Short Accuracy**. He misses screens. Screens.", "**{v} Short Accuracy**. Five-yard passes are a coin flip for {w}."],
  throwAccMidRating: ["{w} has **{v} Medium Accuracy**. Everything over 10 yards is a guess."],
  throwAccDeepRating: [
    "{w} has **{v} Deep Accuracy**. His deep balls should be reported as missing persons.","{w} has **{v} Deep Accuracy**. His deep ball lands in the parking lot.", "**{v} Deep Accuracy**. {w} throws it deep and hopes the defense is feeling generous."],
  throwOnRunRating: ["**{v} Throw on the Run**. Make {w} move and the ball goes anywhere but the receiver."],
  throwUnderPressureRating: [
    "**{v} TUP**. {w} folds under pressure faster than a politician under oath.",
    "**{v} TUP**. {w} sees a pass rusher and his soul leaves his body.","{w} has **{v} Throw Under Pressure**. One defender breathes on him and he folds.", "**{v} TUP**. {w} panics when the pocket gets slightly warm."],
  playActionRating: ["**{v} Play Action**. Nobody bites on {w}'s fakes, not even his own linemen."],
  breakSackRating: [
    "{w} has **{v} Break Sack**. Goes down faster than a crypto exchange.","{w} has **{v} Break Sack**. Goes down if a linebacker sneezes near him."],
  breakTackleRating: [
    "**{v} Break Tackle**. {w} goes down like he got shot from the stands.","{w} has **{v} Break Tackle**. One finger tackles him.", "**{v} Break Tackle**. Arm tackles are a death sentence for {w}."],
  truckRating: ["**{v} Trucking**. {w} runs into defenders and apologizes."],
  jukeMoveRating: ["{w} has **{v} Juke Move**. His jukes fool nobody, not even the camera."],
  stiffArmRating: ["**{v} Stiff Arm**. {w} stiff arms like he's waving hello."],
  passBlockRating: [
    "**{v} Pass Block**. {w} is an accessory to assault on his own quarterback.",
    "{w} has **{v} Pass Block**. His QB's health insurance premiums went up because of him.","{w} has **{v} Pass Block**. His QB has him saved in his phone as 'traitor'.", "**{v} Pass Block**. {w} is a turnstile with a jersey."],
  runBlockRating: [
    "**{v} Run Block**. {w} gets driven five yards backward and buried in his own backfield.","{w} has **{v} Run Block**. Gets pushed back into his own running back.", "**{v} Run Block**. Running backs avoid {w}'s gap on purpose."],
  impactBlockRating: ["**{v} Impact Block**. {w} blocks like he's holding a door open."],
  kickAccRating: [
    "**{v} Kick Accuracy**. {w} has missed more targets than Rockstar missed GTA 6 release dates.",
    "{w} has **{v} Kick Accuracy**. The goalposts should press charges for harassment.","{w} has **{v} Kick Accuracy**. The uprights fear nothing from him.", "**{v} Kick Accuracy**. {w} aims small and misses everywhere."],
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

/** The ratings that matter for a player's position. */
export const positionRatings = (pos: string) => POS_KEYS[GROUP[pos] || ""] || [];

export function ratingRoasts(p: Player): Fact[] {
  if (!p.ratings) return [];
  const mine = POS_KEYS[GROUP[p.pos] || ""] || [];
  const bad: { k: string; v: number; w: number }[] = [];
  for (const k of Object.keys(LINES)) {
    const v = p.ratings[RATING_KEYS.indexOf(k as (typeof RATING_KEYS)[number])] ?? 0;
    if (!v) continue;
    // Only ratings that matter for his position (Nick: "more targeted at relevant stats for
    // positions"); bad at 75 or under, kickers/punters 80.
    if (!mine.includes(k)) continue;
    const bar = p.pos === "K" || p.pos === "P" ? 80 : 75;
    if (v > bar) continue;
    bad.push({ k, v, w: 3.5 + (bar - v) / 20 });
  }
  bad.sort((a, b) => b.w - a.w);
  return bad.slice(0, 6).map(({ k, v, w }) => ({
    key: `p:r_${k}`,
    weight: w,
    text: tail(pick(LINES[k]).replaceAll("{w}", p.last).replaceAll("{v}", String(v)), 0.35),
  }));
}
