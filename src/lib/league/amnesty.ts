// 50% amnesty (Nick, 2026-11-20). Pure: used by the team Cap tab (server) and the
// admin Amnesty page (browser).
//
// The league rule: a manager can amnesty any one player and take HALF of what Madden
// would charge to cut him today, all of it this season, and be free of him after that.
// Madden has no amnesty button, so the commissioner rebuilds the contract with Edit
// Player (commissioner only: Roster > player > Edit Player > Contract) and then the
// manager cuts him.
//
// Why one recipe works for every contract (void years, guaranteed salary, extensions,
// restructures, old-deal leftovers, rookie deals):
//  - The target never re-derives the penalty. It is half of Madden's own number
//    (EA's capReleasePenalty, the PENALTY column), which already includes every one
//    of those cases. T = penalty / 2, rounded to $10K (Madden's money unit).
//  - The rebuilt deal is 1 year, 1 year left, signing bonus T, the lowest salary the
//    edit screen allows, no void years, no guaranteed years. Madden's rules (cap.ts,
//    tradeMath.ts deadSplit): bonus spreads over min(length + void, 5) seasons = 1, so
//    all of T is charged THIS season; dead-if-cut = bonus not yet charged (this
//    season's share included) + guaranteed salary = T + 0 = T; and a cut charges this
//    season's bonus share now and the rest next season = T now, 0 next.
//  - So the post-edit contract card proves itself before anyone cuts: cap hit = S + T
//    (if lower, void years are still spreading the bonus), PENALTY = T (if higher,
//    guaranteed salary or old-deal money survived the edit), SAVINGS = S.
//
// Not yet checked in Madden 27 (Nick to try on one player): exactly which fields the
// edit screen offers and their names, the smallest bonus step, and whether an edit
// clears an older deal's leftover bonus. The checks above catch every one of these.

export const MONEY_STEP = 10_000; // EA stores contract money in $10K units

export type AmnestyInput = {
  capHit: number;    // this season
  pen: number;       // Madden's dead money if cut today (EA capReleasePenalty)
  bonus: number[];   // bonus part of each season's cap hit, index 0 = this season (tradeData)
  hits: number[];    // cap hit by season while under contract
  dead: number[];    // void-year bonus still counting after the deal ends
  ps: boolean;
};

export type AmnestyFlag = { kind: "none" | "lastYear" | "moreNow" | "void" | "other" | "overCap" | "rounded"; text: string };

export type AmnestyPlan = {
  pen: number;
  target: number;            // T: what the team pays, all this season
  exactHalf: number;
  normal: [number, number];  // a normal cut: dead this season, dead next season
  breakdown: { bonusLeft: number; voidBonus: number; other: number };
  savedVsCut: number;        // dead money avoided vs a normal cut (pen - T)
  // Cap space change by season vs keeping him (index 0 = this season):
  keepCost: number[];        // what he costs if kept (hits + void bonus)
  cutDelta: number[];        // normal cut
  amnestyDelta: number[];    // amnesty
  flags: AmnestyFlag[];
};

/** Half of Madden's penalty, rounded to Madden's $10K unit (an exact $5K tie rounds down, in the team's favor). */
export function amnestyTarget(pen: number) {
  const half = Math.max(0, pen) / 2;
  return Math.ceil(half / MONEY_STEP - 0.5) * MONEY_STEP;
}

/** A normal cut, the way Madden charges it: this season's bonus share now, the rest next season. */
export function normalCut(pen: number, bonusNow: number): [number, number] {
  const now = Math.min(pen, Math.max(0, bonusNow || 0));
  return [now, pen - now];
}

export function amnestyPlan(p: AmnestyInput, opts: { penalty?: number; space?: number; year?: number } = {}): AmnestyPlan {
  const pen = Math.max(0, opts.penalty ?? p.pen);
  const target = amnestyTarget(pen);
  const normal = normalCut(pen, p.bonus[0]);
  const n = Math.max(p.hits.length, p.dead.length, 2);
  const keepCost = Array.from({ length: n }, (_, i) => (i === 0 ? p.capHit : p.ps ? 0 : (p.hits[i] || 0) + (p.dead[i] || 0)));
  const cutDelta = keepCost.map((c, i) => c - (i <= 1 ? normal[i] : 0));
  const amnestyDelta = keepCost.map((c, i) => c - (i === 0 ? target : 0));

  const bonusLeft = Math.min(pen, p.bonus.reduce((a, b) => a + b, 0));
  const voidBonus = Math.min(pen - bonusLeft, p.dead.reduce((a, b) => a + b, 0));
  // Under one $10K step is rounding in EA's totals, not real money: keep it with the bonus.
  const rest = Math.max(0, pen - bonusLeft - voidBonus);
  const other = rest >= MONEY_STEP ? rest : 0;
  const bonusLeftAll = bonusLeft + (rest - other);

  const y = opts.year;
  const ys = (k: number) => (y ? String(y + k) : k ? "next season" : "this season");
  const flags: AmnestyFlag[] = [];
  if (pen <= 0) {
    flags.push({ kind: "none", text: p.ps ? "Practice squad: EA shows no contract money, so a normal cut costs nothing. No amnesty needed." : "Madden charges no dead money to cut him, so a normal cut already costs nothing. Don't spend an amnesty here." });
  } else {
    if (normal[1] <= 0) flags.push({ kind: "lastYear", text: `A normal cut already lands entirely in ${ys(0)}; the amnesty just halves it.` });
    else if (target > normal[0]) flags.push({ kind: "moreNow", text: `Charges ${fmt(target - normal[0])} more in ${ys(0)} than a normal cut, because a normal cut pushes ${fmt(normal[1])} into ${ys(1)}. With the amnesty, ${ys(1)} is fully clear.` });
    if (voidBonus >= MONEY_STEP) flags.push({ kind: "void", text: `${fmt(voidBonus)} of his penalty is void-year bonus (charged after his deal ends). It's in Madden's number, so it's halved with the rest. The rebuilt deal must have no void years: check that his cap hit shows the whole bonus.` });
    if (other >= MONEY_STEP) flags.push({ kind: "other", text: `About ${fmt(other)} of his penalty isn't this deal's spread bonus: guaranteed salary, or money left from an older deal (extension or restructure). It's in Madden's number, so it's halved too. Check that PENALTY reads exactly the target after the edit.` });
    if (opts.space != null && opts.space + amnestyDelta[0] < 0) flags.push({ kind: "overCap", text: `Leaves the team ${fmt(-(opts.space + amnestyDelta[0]))} over the cap in ${ys(0)}.` });
    if (target !== pen / 2) flags.push({ kind: "rounded", text: `Exact half is ${fmt(pen / 2, true)}; rounded to ${fmt(target)} because Madden counts money in $10K steps.` });
  }
  return { pen, target, exactHalf: pen / 2, normal, breakdown: { bonusLeft: bonusLeftAll, voidBonus, other }, savedVsCut: pen - target, keepCost, cutDelta, amnestyDelta, flags };
}

/** The contract the commissioner enters before the cut, and what the card must show afterwards. */
export function amnestyRecipe(target: number) {
  return {
    fields: [
      { field: "Contract Length", value: "1 year" },
      { field: "Contract Year / Years Left", value: "1 (this is the deal's only year)" },
      { field: "Signing Bonus", value: fmt(target) },
      { field: "Total Salary", value: "the lowest the slider allows (call it S)" },
      { field: "Void Years", value: "0 (if the screen has it)" },
      { field: "Guaranteed Years", value: "0 (if the screen has it)" },
    ],
    checks: [
      { label: "Length / years left", expect: "1 / 1" },
      { label: "Cap hit (this season)", expect: `S + ${fmt(target)}` },
      { label: "Penalty (dead if cut)", expect: fmt(target) },
      { label: "Savings", expect: "S" },
    ],
  };
}

function fmt(n: number, exact = false) {
  const a = Math.abs(n), s = n < 0 ? "−" : "";
  if (a >= 1_000_000) return `${s}$${(a / 1_000_000).toFixed(exact ? 3 : 2).replace(/0+$/, "").replace(/\.$/, "")}M`;
  if (a >= 1_000) return `${s}$${Math.round(a / 1_000).toLocaleString("en-US")}K`;
  return `${s}$${Math.round(a)}`;
}
export const amnestyMoney = fmt;
