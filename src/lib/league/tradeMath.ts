// Trade Tool math, shared by the site (TradeTool.tsx, in the browser) and the Discord
// trade proposal (server). Pure: no server imports.
//
// Two parts:
//  1. Cap impact (moved here from TradeTool.tsx, unchanged rules): the team trading a
//     player away takes his whole release penalty as dead money this season; the team
//     getting him pays only his salary (his bonus stays behind).
//  2. Trade score (Nick, 2026-11-17): a value for every asset that weighs what wins in a
//     user league, with physical traits (speed, acceleration, agility, height, strength)
//     counting far more than Madden's OVR does; then each team's needs: a player who
//     upgrades a weak starting spot is worth more to that team than one who'd sit behind
//     a better player, and losing a starter with no one behind him costs more.

export type TradePlayer = {
  id: number; n: string; pos: string; t: number; age: number; ovr: number; dev: number; ps: boolean;
  yl: number;        // years left
  hits: number[];    // cap hit by season (index 0 = this season)
  bonus: number[];   // the bonus part of each season's cap hit (stays with the old team)
  dead: number[];    // void-year bonus still counting after his deal ends
  pen: number;       // dead money if he leaves now (Madden's own number)
  // Trade score (tradeData.ts gradePlayers):
  g: string;         // position group (EDGE, OT, IOL, S, OLB, ...)
  ur: number;        // user rating 1-99: his percentile at his position group on the weighted traits
  v: number;         // asset value before team fit
  spd: number; acc: number; h: number; w: number; // speed, acceleration, height (in), weight
};
export type TradeTeam = {
  id: number; abbr: string; name: string; primary: string; active: number; committed: number[]; cap: number[];
  slot: number;      // projected 1st-round slot from the standings (1 = worst record)
};
/** A draft pick: year, round, and (optional) its slot in the round, set by hand when the automatic one is wrong. */
export type Pick = { y: number; r: number; s?: number };
export type Side = { team: number | null; players: number[]; picks: Pick[] };

export const DEV = ["Normal", "Star", "Superstar", "X-Factor"];
export const ROUND = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th"];

// ---------------------------------------------------------------- cap

export type CapRow = { y: number; i: number; before: number; leaving: number; dead: number; arriving: number; change: number; after: number };

export function capRows(team: TradeTeam, out: TradePlayer[], inc: TradePlayer[], years: number[]): CapRow[] {
  return years.map((y, i) => {
    // Leaving: this season his whole cap hit comes off (then the penalty goes on);
    // later seasons, his cap hit and any void-year bonus (practice squad deals aren't counted there).
    const leaving = out.reduce((s, p) => s + (i === 0 ? p.hits[0] : p.ps ? 0 : p.hits[i] + p.dead[i]), 0);
    const dead = i === 0 ? out.reduce((s, p) => s + p.pen, 0) : 0;
    const arriving = inc.reduce((s, p) => s + Math.max(0, p.hits[i] - p.bonus[i]), 0);
    const before = team.cap[i] - team.committed[i];
    const change = leaving - dead - arriving;
    return { y, i, before, leaving, dead, arriving, change, after: before + change };
  });
}

// ---------------------------------------------------------------- player grades

/** Position group (same groups as the contract tool, plus OLB/MIKE split). */
const GROUP: Record<string, string> = {
  LEDG: "EDGE", REDG: "EDGE", LT: "OT", RT: "OT", LG: "IOL", RG: "IOL", C: "IOL",
  FS: "S", SS: "S", SAM: "OLB", WILL: "OLB",
};
export const tradeGroup = (pos: string) => GROUP[pos] || pos;
export const GROUP_NAME: Record<string, string> = {
  QB: "QB", HB: "RB", FB: "FB", WR: "WR", TE: "TE", OT: "OT", IOL: "IOL", EDGE: "EDGE", DT: "DT",
  OLB: "OLB", MIKE: "MLB", CB: "CB", S: "S", K: "K", P: "P", LS: "LS",
};

/** Starters a team plays at each group (4-3 base, 3 WR, nickel). */
export const STARTERS: Record<string, number> = {
  QB: 1, HB: 1, FB: 1, WR: 3, TE: 1, OT: 2, IOL: 3, EDGE: 2, DT: 2, OLB: 2, MIKE: 1, CB: 3, S: 2, K: 1, P: 1, LS: 1,
};

/** How much a position swings games in a user league. QBs, receivers, corners and pass rushers
 *  decide user games; interior line, fullbacks and kickers much less. */
export const POS_VALUE: Record<string, number> = {
  QB: 1.5, WR: 1.15, CB: 1.15, EDGE: 1.1, HB: 1.0, S: 0.95, MIKE: 0.95, TE: 0.9, OT: 0.9,
  DT: 0.85, OLB: 0.8, IOL: 0.7, FB: 0.3, K: 0.35, P: 0.25, LS: 0.1,
};

/**
 * What makes a player good in a user league, per group. Keys are EA rating names, plus
 * "height" and "weight". Each trait is scored as his percentile among the league's players at
 * the group, so a 96-speed corner beats a 91 by a lot more than the 5 points suggest.
 * Physical traits (speed, accel, agility, change of direction, strength, jumping, height,
 * weight) carry roughly half or more of the weight at skill positions; Madden's OVR gives
 * them far less.
 */
export const TRAIT_WEIGHTS: Record<string, Record<string, number>> = {
  QB: { throwPowerRating: 18, throwAccShortRating: 10, throwAccMidRating: 12, throwAccDeepRating: 10, throwOnRunRating: 8, throwUnderPressureRating: 8, awareRating: 5, playActionRating: 3, speedRating: 14, accelRating: 5, agilityRating: 3, height: 4 },
  HB: { speedRating: 26, accelRating: 14, agilityRating: 10, changeOfDirectionRating: 8, bCVRating: 8, jukeMoveRating: 6, spinMoveRating: 3, breakTackleRating: 6, truckRating: 3, stiffArmRating: 2, carryRating: 6, catchRating: 5, strengthRating: 3 },
  FB: { leadBlockRating: 25, impactBlockRating: 15, strengthRating: 20, speedRating: 15, accelRating: 5, carryRating: 10, catchRating: 10 },
  WR: { speedRating: 26, accelRating: 10, agilityRating: 6, changeOfDirectionRating: 6, height: 10, jumpRating: 6, catchRating: 10, cITRating: 6, specCatchRating: 3, routeRunShortRating: 5, routeRunMedRating: 5, routeRunDeepRating: 5, releaseRating: 4 },
  TE: { speedRating: 20, accelRating: 6, agilityRating: 4, height: 10, strengthRating: 6, jumpRating: 4, catchRating: 10, cITRating: 8, specCatchRating: 2, routeRunShortRating: 6, routeRunMedRating: 6, releaseRating: 4, runBlockRating: 8, passBlockRating: 6 },
  OT: { strengthRating: 18, weight: 8, height: 4, agilityRating: 4, accelRating: 2, passBlockRating: 14, passBlockPowerRating: 12, passBlockFinesseRating: 12, runBlockRating: 10, runBlockPowerRating: 6, runBlockFinesseRating: 4, awareRating: 6 },
  IOL: { strengthRating: 20, weight: 8, passBlockRating: 12, passBlockPowerRating: 12, passBlockFinesseRating: 8, runBlockRating: 14, runBlockPowerRating: 10, runBlockFinesseRating: 6, impactBlockRating: 4, awareRating: 6 },
  EDGE: { speedRating: 20, accelRating: 14, strengthRating: 8, agilityRating: 4, height: 5, finesseMovesRating: 16, powerMovesRating: 12, blockShedRating: 10, pursuitRating: 6, tackleRating: 5, playRecRating: 4 },
  DT: { strengthRating: 18, weight: 6, speedRating: 10, accelRating: 10, powerMovesRating: 18, finesseMovesRating: 8, blockShedRating: 18, tackleRating: 6, pursuitRating: 4, playRecRating: 4 },
  OLB: { speedRating: 24, accelRating: 10, agilityRating: 6, height: 4, jumpRating: 2, tackleRating: 10, pursuitRating: 10, zoneCoverRating: 12, manCoverRating: 4, playRecRating: 8, blockShedRating: 6, hitPowerRating: 4 },
  MIKE: { speedRating: 24, accelRating: 10, agilityRating: 5, height: 6, jumpRating: 4, zoneCoverRating: 16, manCoverRating: 4, playRecRating: 10, tackleRating: 8, pursuitRating: 8, hitPowerRating: 3, blockShedRating: 4 },
  CB: { speedRating: 26, accelRating: 10, agilityRating: 6, changeOfDirectionRating: 6, height: 9, jumpRating: 6, manCoverRating: 14, zoneCoverRating: 12, pressRating: 6, playRecRating: 6, catchRating: 3, tackleRating: 2 },
  S: { speedRating: 24, accelRating: 9, agilityRating: 5, changeOfDirectionRating: 4, height: 7, jumpRating: 5, zoneCoverRating: 16, manCoverRating: 7, playRecRating: 9, tackleRating: 6, hitPowerRating: 4, pursuitRating: 4 },
  K: { kickPowerRating: 55, kickAccRating: 45 },
  P: { kickPowerRating: 55, kickAccRating: 45 },
  LS: { longSnapRating: 100 },
};
export const PHYSICAL = new Set(["speedRating", "accelRating", "agilityRating", "changeOfDirectionRating", "strengthRating", "jumpRating", "height", "weight"]);

/** Asset value of a graded player before team fit. capShare = this season's cap hit / the league cap. */
export function playerValue(p: { g: string; ur: number; age: number; dev: number; yl: number; ps: boolean }, capShare: number) {
  const base = Math.pow(Math.max(1, p.ur) / 100, 2.5) * 100 * (POS_VALUE[p.g] ?? 0.5);
  // QBs age later; kickers and punters much later.
  const a = p.age - (p.g === "QB" ? 3 : p.g === "K" || p.g === "P" ? 6 : 0);
  const age = a <= 24 ? 1.08 : a <= 26 ? 1.04 : a <= 27 ? 1 : a <= 28 ? 0.95 : a <= 29 ? 0.88 : a <= 30 ? 0.8 : a <= 31 ? 0.7 : a <= 32 ? 0.6 : a <= 33 ? 0.5 : 0.4;
  const dev = [1, 1.04, 1.1, 1.18][p.dev] ?? 1; // X-Factor and Superstar abilities matter a lot in user games
  // Years of control: an expiring deal is a rental.
  const control = p.yl >= 2 ? 1 : p.yl === 1 ? 0.95 : 0.85;
  // Contract: a fair cap share for this value is ~0.12% of the cap per point (100 points ≈ 12%).
  const fair = 0.0012 * base;
  const contract = 1 + Math.max(-0.35, Math.min(0.2, (fair - capShare) * 4));
  return base * age * dev * control * contract;
}

/**
 * Which pick in the round a team's pick is (Nick, 2026-11-17: picks should know their real spot, with a
 * manual override). EA's export has no pick list, so the automatic slot is the team's own: the next
 * draft's order from the standings (final once the season is over: non-playoff teams worst first, then
 * playoff teams by the round they went out, Super Bowl winner last). A set slot (k.s) always wins.
 * The draft after next is half-way to the middle of the round; later ones are the middle.
 */
export function pickSlot(k: Pick, ownerSlot: number, firstDraft: number): { slot: number; how: "set" | "order" | "projected" | "estimate" } {
  if (k.s && k.s >= 1 && k.s <= 32) return { slot: k.s, how: "set" };
  const later = k.y - firstDraft;
  if (later <= 0) return { slot: ownerSlot, how: "order" };
  if (later === 1) return { slot: Math.round((ownerSlot + 16.5) / 2), how: "estimate" };
  return { slot: 16, how: "estimate" };
}
export const overallPick = (r: number, slot: number) => (r - 1) * 32 + slot;

/** Draft pick value by overall pick number: 45 for #1, ~18 for #32, ~7 for #64, under 1 by the late rounds;
 *  ×0.85 for each year out. */
export function pickValue(k: Pick, ownerSlot: number, firstYear: number) {
  const { slot } = pickSlot(k, ownerSlot, firstYear);
  const n = overallPick(k.r, slot);
  const later = Math.max(0, k.y - firstYear);
  return (45 * Math.exp(-0.03 * (n - 1)) + 0.5) * Math.pow(0.85, later);
}

const ordinalNum = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;
/** "#23, 23rd overall" / "~#20 (estimate)" for showing a pick's spot. */
export function pickSpotText(k: Pick, ownerSlot: number, firstDraft: number, orderFinal: boolean) {
  const { slot, how } = pickSlot(k, ownerSlot, firstDraft);
  const n = overallPick(k.r, slot);
  if (how === "estimate") return `~#${slot} in the round (estimate)`;
  const tag = how === "set" ? "set by hand" : orderFinal ? "draft order" : "projected";
  return `#${slot}, ${ordinalNum(n)} overall (${tag})`;
}

// ---------------------------------------------------------------- trade score

export type AssetScore = {
  kind: "player" | "pick"; id: string; label: string; sub: string;
  value: number;      // asset value before fit
  fit: number;        // multiplier for the team getting it (or the cost multiplier for the team losing it)
  worth: number;      // value × fit
  note: string;       // "New WR1 (was 64)", "Backup behind 2 better CBs", "Leaves a hole at CB"
};
export type NeedChange = { g: string; before: number; after: number }; // average starter UR at a group
export type TeamScore = {
  team: TradeTeam;
  gets: AssetScore[]; gives: AssetScore[];
  getsWorth: number; givesWorth: number; capPts: number; net: number;
  grade: string;
  needs: NeedChange[];       // groups whose starters changed
  capNow: CapRow; capNext?: CapRow;
};
export type TradeScore = { a: TeamScore; b: TeamScore; score: number; verdict: string; favored: TradeTeam | null };

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

/** A team's starters' URs at a group (best first), padded with 25s for empty spots. */
function lineup(roster: TradePlayer[], g: string): number[] {
  const n = STARTERS[g] ?? 1;
  const urs = roster.filter((p) => p.g === g && !p.ps).map((p) => p.ur).sort((x, y) => y - x).slice(0, n);
  while (urs.length < n) urs.push(25);
  return urs;
}

/** How many real (non-padded) starters a team has at a group. */
const filled = (roster: TradePlayer[], g: string) => Math.min(STARTERS[g] ?? 1, roster.filter((p) => p.g === g && !p.ps).length);

/** How weak a team is at a group vs the league: 0 (strong) to 1 (a real hole). */
function needLevel(start: number[], leagueAvg: number) {
  return Math.max(0, Math.min(1, (leagueAvg - avg(start)) / 30 + 0.35));
}

const ordinal = (k: number, g: string) => (STARTERS[g] > 1 ? `${GROUP_NAME[g] || g}${k + 1}` : `starting ${GROUP_NAME[g] || g}`);

export function scoreTrade(args: {
  players: TradePlayer[]; teams: TradeTeam[]; years: number[]; firstDraft: number; a: Side; b: Side; orderFinal?: boolean;
}): TradeScore | null {
  const { players, years, firstDraft } = args;
  const orderFinal = Boolean(args.orderFinal);
  const byId = new Map(players.map((p) => [p.id, p]));
  const teamOf = new Map(args.teams.map((t) => [t.id, t]));
  if (!args.a.team || !args.b.team) return null;
  const ta = teamOf.get(args.a.team), tb = teamOf.get(args.b.team);
  if (!ta || !tb) return null;

  // league average starter UR per group
  const leagueAvg: Record<string, number> = {};
  for (const g of Object.keys(STARTERS)) {
    leagueAvg[g] = avg(args.teams.map((t) => avg(lineup(players.filter((p) => p.t === t.id), g))));
  }

  const side = (team: TradeTeam, sends: Side, gets: Side): TeamScore => {
    const out = sends.players.map((id) => byId.get(id)).filter((p): p is TradePlayer => Boolean(p));
    const inc = gets.players.map((id) => byId.get(id)).filter((p): p is TradePlayer => Boolean(p));
    const before = players.filter((p) => p.t === team.id);
    const outIds = new Set(out.map((p) => p.id));
    const after = [...before.filter((p) => !outIds.has(p.id)), ...inc.map((p) => ({ ...p, t: team.id, ps: false }))];
    const groups = [...new Set([...out, ...inc].map((p) => p.g))];

    // Players coming in: fit = how much each one upgrades the lineup (without the players going out).
    const keep = before.filter((p) => !outIds.has(p.id));
    const getsA: AssetScore[] = inc.sort((x, y) => y.v - x.v).map((p) => {
      const start = lineup(keep, p.g);
      const need = needLevel(start, leagueAvg[p.g]);
      const weakest = start[start.length - 1];
      const upgrade = Math.max(0, p.ur - weakest);
      const fit = 0.55 + 0.45 * Math.min(1, upgrade / 25) + 0.25 * need * (upgrade > 0 ? 1 : 0);
      const spot = start.filter((u) => u > p.ur).length; // starters better than him
      const note = upgrade > 0
        ? `New ${ordinal(spot, p.g)}; ${filled(keep, p.g) < start.length ? "fills an empty spot" : `upgrades a ${Math.round(weakest)} UR spot`}${need >= 0.6 ? " (a need)" : ""}`
        : `Backup behind ${spot} better ${GROUP_NAME[p.g] || p.g}${spot === 1 ? "" : "s"}`;
      return { kind: "player", id: String(p.id), label: p.n, sub: `${p.pos} · ${p.ovr} OVR · ${p.ur} UR`, value: p.v, fit, worth: p.v * fit, note };
    });
    getsA.push(...gets.picks.map((k) => pickAsset(k, teamOf.get(gets.team!)!, firstDraft, orderFinal)));

    // Players going out: cost = how much the lineup drops without him, before anyone arrives (the
    // players coming in already get credit above for filling the spot, so it isn't counted twice).
    const givesA: AssetScore[] = out.sort((x, y) => y.v - x.v).map((p) => {
      const was = lineup(before, p.g);
      const now = lineup(before.filter((x) => x.id !== p.id), p.g);
      const drop = Math.max(0, avg(was) - avg(now)) * (STARTERS[p.g] ?? 1);
      const hole = needLevel(lineup(keep, p.g), leagueAvg[p.g]);
      const fit = p.ps || drop <= 0 ? 0.55 : 0.55 + 0.45 * Math.min(1, drop / 25) + 0.25 * hole;
      const note = drop > 0 ? `Starter lost${hole >= 0.6 ? `; leaves a hole at ${GROUP_NAME[p.g] || p.g}` : ""}` : "Depth piece; starters unchanged";
      return { kind: "player", id: String(p.id), label: p.n, sub: `${p.pos} · ${p.ovr} OVR · ${p.ur} UR`, value: p.v, fit, worth: p.v * fit, note };
    });
    givesA.push(...sends.picks.map((k) => pickAsset(k, team, firstDraft, orderFinal)));

    const rows = capRows(team, out, inc, years);
    // Cap room has value: each $1M of space gained this season (or next, at 60%) ≈ 0.3 points,
    // flattening out at ±12 so a huge dead-money hit doesn't drown out the players. Going over
    // this season's cap means Madden refuses the trade; that's flagged separately.
    const capPts = 12 * Math.tanh((((rows[0].change + 0.6 * (rows[1]?.change || 0)) / 1e6) * 0.3) / 12);
    const getsWorth = getsA.reduce((s, x) => s + x.worth, 0);
    const givesWorth = givesA.reduce((s, x) => s + x.worth, 0);
    const net = getsWorth - givesWorth + capPts;
    const ratio = net / Math.max(15, givesWorth);
    const grade = ratio >= 0.5 ? "A+" : ratio >= 0.25 ? "A" : ratio >= 0.1 ? "B+" : ratio >= -0.05 ? "B" : ratio >= -0.2 ? "C" : ratio >= -0.4 ? "D" : "F";
    const needs = groups.map((g) => ({ g, before: Math.round(avg(lineup(before, g))), after: Math.round(avg(lineup(after, g))) }))
      .filter((n) => n.before !== n.after).sort((x, y) => Math.abs(y.after - y.before) - Math.abs(x.after - x.before));
    return { team, gets: getsA, gives: givesA, getsWorth, givesWorth, capPts, net, grade, needs, capNow: rows[0], capNext: rows[1] };
  };

  const A = side(ta, args.a, args.b), B = side(tb, args.b, args.a);
  const scale = Math.max(30, (A.getsWorth + A.givesWorth + B.getsWorth + B.givesWorth) / 2);
  const score = Math.round(50 + 50 * Math.tanh((A.net - B.net) / scale)); // Team 1's share, 50 = even
  const gap = Math.abs(score - 50);
  const favored = gap < 6 ? null : score > 50 ? ta : tb;
  const verdict = !favored ? "Fair trade" : gap < 15 ? `Leans ${favored.abbr}` : gap < 28 ? `Favors ${favored.abbr}` : `Lopsided: ${favored.abbr} wins big`;
  return { a: A, b: B, score, verdict, favored };
}

function pickAsset(k: Pick, owner: TradeTeam, firstDraft: number, orderFinal: boolean): AssetScore {
  const v = pickValue(k, owner.slot, firstDraft);
  return { kind: "pick", id: `${k.y}-${k.r}`, label: `${k.y} ${ROUND[k.r]} (${owner.abbr})`, sub: pickSpotText(k, owner.slot, firstDraft, orderFinal), value: v, fit: 1, worth: v, note: "" };
}
