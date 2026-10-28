// Contract and cap projection math. Pure, no Node APIs: used on the server
// (team cap tabs, player pages) and in the browser (contract tool).
//
// Ported from the NCL site (template capMath / calculateContractOffer), where
// the rules were worked out by blind-predicting real Madden extensions before
// seeing the signed result (Witherspoon, Shaheed, Edmunds, Bates, Morris,
// Leonard Williams) and then checked against a batch of verified Seahawks cap
// hits:
//  1. TIMING: an extension starts the year after the current deal's last real
//     year (startYear = currentYear + yearsLeft). The caller sets startYear.
//  2. BONUS: prorated evenly over min(length + void years, 5) years. 6-for-6.
//  3. BASE SALARY: back-loaded, not flat. Low first year, steady climb, the
//     final year absorbs the remainder. Cheap deals (under $3M a year) ramp
//     much flatter. This is the approximate part: individual middle years
//     can be off 10-30%.
//  4. CAP HIT = that year's base salary + that year's bonus share.
// Real NFL rules are a guide, not a spec: if a real in-game number disagrees,
// the in-game number wins and these constants get tuned.

export const MAX_BONUS_PRORATION_YEARS = 5;
const RAMP_FIRST_YEAR_RATIO = 0.32;
const RAMP_STEP_RATIO = 0.36;
const LOW_TIER_APY_THRESHOLD = 3_000_000;
const LOW_TIER_RAMP_FIRST_YEAR_RATIO = 0.73;
const LOW_TIER_RAMP_STEP_RATIO = 0.19;

/** Baseline league cap growth per season (Nick, 2026-10-27). */
export const CAP_GROWTH_PER_YEAR = 15_000_000;

export function projectedLeagueCap(currentCap: number, currentYear: number, year: number) {
  return currentCap + CAP_GROWTH_PER_YEAR * Math.max(0, year - currentYear);
}

function salarySchedule(totalSalary: number, length: number, firstRatio: number, stepRatio: number): number[] {
  if (length <= 1) return [totalSalary];
  const avg = totalSalary / length;
  const ramp: number[] = [];
  for (let i = 0; i < length - 1; i++) ramp.push(avg * (firstRatio + i * stepRatio));
  const rampSum = ramp.reduce((a, b) => a + b, 0);
  const maxRamp = totalSalary * 0.9; // the final year always keeps at least 10% of the total
  const scale = rampSum > maxRamp && rampSum > 0 ? maxRamp / rampSum : 1;
  const scaled = ramp.map((v) => v * scale);
  return [...scaled, Math.max(0, totalSalary - scaled.reduce((a, b) => a + b, 0))];
}

export type OfferInput = {
  startYear: number;
  length: number;
  yearlySalary: number;     // average base salary per year
  totalBonus: number;
  voidYears?: number;
  guaranteedYears?: number; // base salary years that also become dead money if cut
};

export type OfferRow = {
  year: number; isVoid: boolean; baseSalary: number; bonus: number; capHit: number;
  deadIfCutAfter: number;   // dead money if released after this season
};

export function calculateOffer(input: OfferInput) {
  const length = Math.max(1, Math.floor(input.length) || 1);
  const voidYears = Math.max(0, Math.floor(input.voidYears || 0));
  const gtd = Math.min(length, Math.max(0, Math.floor(input.guaranteedYears || 0)));
  const yearlySalary = Math.max(0, input.yearlySalary || 0);
  const totalBonus = Math.max(0, input.totalBonus || 0);

  const span = length + voidYears;
  const prorationYears = Math.min(span, MAX_BONUS_PRORATION_YEARS);
  const perYearBonus = prorationYears ? totalBonus / prorationYears : 0;
  const totalSalary = length * yearlySalary;
  const apy = (totalSalary + totalBonus) / length;
  const low = apy < LOW_TIER_APY_THRESHOLD;
  const salaries = salarySchedule(totalSalary, length, low ? LOW_TIER_RAMP_FIRST_YEAR_RATIO : RAMP_FIRST_YEAR_RATIO, low ? LOW_TIER_RAMP_STEP_RATIO : RAMP_STEP_RATIO);

  const rows: OfferRow[] = [];
  for (let i = 0; i < span; i++) {
    const isVoid = i >= length;
    const baseSalary = isVoid ? 0 : salaries[i];
    const bonus = i < prorationYears ? perYearBonus : 0;
    rows.push({ year: input.startYear + i, isVoid, baseSalary, bonus, capHit: baseSalary + bonus, deadIfCutAfter: 0 });
  }
  for (let i = 0; i < rows.length; i++) {
    let dead = 0;
    for (let j = i + 1; j < rows.length; j++) {
      dead += rows[j].bonus;
      if (!rows[j].isVoid && j < gtd) dead += rows[j].baseSalary;
    }
    rows[i].deadIfCutAfter = dead;
  }
  return { rows, totalValue: totalSalary + totalBonus, apy, prorationYears };
}

export type ContractLike = { length: number; yearsLeft: number; salary: number; bonus: number; capHit: number };

/**
 * Cap hit by year for a contract already signed: this season is Madden's own
 * number; later years run the deal's totals through the formula above.
 * startYear is backed out from how much of the deal has already elapsed.
 */
export function projectContract(c: ContractLike, currentYear: number): Record<number, number> {
  const out: Record<number, number> = {};
  if (c.yearsLeft <= 0) return out;
  out[currentYear] = c.capHit;
  const length = Math.floor(c.length);
  if (length <= 0 || c.salary + c.bonus <= 0) return out;
  const startYear = currentYear - (length - c.yearsLeft);
  const { rows } = calculateOffer({ startYear, length, yearlySalary: c.salary / length, totalBonus: c.bonus });
  for (const r of rows) if (r.year > currentYear && !r.isVoid) out[r.year] = r.capHit;
  return out;
}

/** The league's cap this season: the most common cap among teams (ignores a team with the cap switched off). */
export function leagueCap(teams: { cap: { room: number } }[]): number {
  const counts = new Map<number, number>();
  for (const t of teams) counts.set(t.cap.room, (counts.get(t.cap.room) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] || 0;
}
