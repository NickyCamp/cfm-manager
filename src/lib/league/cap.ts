// Contract and cap projection math. Pure, no Node APIs: used on the server
// (team cap tabs, player pages) and in the browser (contract tool).
//
// How Madden structures a contract, worked out (2026-10-28) by comparing EA's
// contract fields with the real year-by-year cap hits Nick read off Madden's
// cap screens for all 32 NCL teams (1,679 contracts, 2,487 future seasons):
//
//  1. SALARY rises by the same dollar amount every year (a straight line).
//     Not a back-loaded curve. 6+ year deals alternate bigger/smaller raises
//     around that line.
//  2. BONUS is spread evenly over min(length + void years, 5) years. Madden's
//     "dead if cut" (capReleasePenalty) is exactly the bonus not yet charged
//     (including this season's share), plus any guaranteed salary.
//  3. THIS SEASON is exact in EA's data (capHit), so this season's salary is
//     capHit minus this season's bonus share. Projections run a line through
//     that known salary, sized so the whole contract adds up to its total
//     salary. That alone took the typical miss from ~9% to under 1%.
//  4. EXTENSIONS are merged with the old deal: EA's length counts the old
//     deal's remaining years first. Signed this season: this season (and any
//     other rookie-deal years left) stay at the old salary, the new bonus
//     starts next season, and the new deal's raise follows Madden's raise
//     rule for its length (yearlyRaise).
//  5. GUARANTEED DEALS: when dead-if-cut covers all remaining salary,
//     (dead money - remaining bonus) is the salary still to be paid; that
//     fixes the line for extensions that are already underway.
//  6. ROOKIE DEALS imported from real life follow the NFL rookie scale
//     (~10% raises); blended with the line.
//
// Accuracy against the real numbers (held-out half of the teams): median miss
// 0.8%, ~60% of future seasons within 2%, ~75% within 5%. The big misses are
// mostly real-life contracts imported at franchise start (hand-built NFL
// structures) and void years, which EA's data doesn't describe.
// Scripts and data: /home/claude/capfit (see the project notes).

export const MAX_BONUS_PRORATION_YEARS = 5;

/** Baseline league cap growth per season (Nick, 2026-10-27). */
export const CAP_GROWTH_PER_YEAR = 15_000_000;

export function projectedLeagueCap(currentCap: number, currentYear: number, year: number) {
  return currentCap + CAP_GROWTH_PER_YEAR * Math.max(0, year - currentYear);
}

// Yearly raise of a new Madden deal by length: raise = a * avgSalary + c.
// Fit on 2026-27 in-franchise signings and extensions.
const RAISE_FIT: Record<number, [number, number]> = {
  2: [0.5801, -352_500],
  3: [0.6136, -662_900],
  4: [0.3593, -387_300],
  5: [0.3065, -395_100],
  6: [0.3065, -395_100],
  7: [0.2593, -460_900],
};
export function yearlyRaise(length: number, avgSalary: number) {
  if (length <= 1) return 0;
  const [a, c] = RAISE_FIT[length] ?? [0.175, 0];
  return Math.max(0.05 * avgSalary, a * avgSalary + c);
}

/** Salary by year for a new deal: a straight line around the average. */
export function salarySchedule(totalSalary: number, length: number): number[] {
  if (length <= 1) return [totalSalary];
  const avg = totalSalary / length;
  const d = yearlyRaise(length, avg);
  const s0 = avg - (d * (length - 1)) / 2;
  return Array.from({ length }, (_, i) => Math.max(0, s0 + d * i));
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
  const salaries = salarySchedule(totalSalary, length);

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

export type ContractLike = {
  length: number; yearsLeft: number; salary: number; bonus: number; capHit: number;
  releasePenalty?: number; // Madden's dead-if-cut; improves extension handling
  rookieYear?: number;     // first NFL season
  yearsPro?: number;
};

export type ContractKind = "standard" | "extension-pending" | "extension-guaranteed" | "extension";

export function contractKind(c: ContractLike, currentYear: number): ContractKind {
  const L = Math.floor(c.length), el = L - c.yearsLeft;
  const P = Math.min(L, MAX_BONUS_PRORATION_YEARS);
  const B = P ? c.bonus / P : 0;
  if (el === 0 && c.bonus > 0 && L >= 2 && c.capHit < 0.9 * B) return "extension-pending";
  const pen = c.releasePenalty ?? 0;
  const excess = pen - B * Math.max(0, P - el);
  if (c.releasePenalty != null && excess > Math.max(80_000, 0.01 * c.bonus)) {
    const sNow = c.capHit - (el < P ? B : 0);
    return excess >= 0.95 * sNow * c.yearsLeft ? "extension-guaranteed" : "extension";
  }
  void currentYear;
  return "standard";
}

/**
 * Cap hit by year for a contract already signed: this season is Madden's own
 * number; later seasons are projected (see the rules at the top of the file).
 */
export function projectContract(c: ContractLike, currentYear: number): Record<number, number> {
  const out: Record<number, number> = {};
  const L = Math.floor(c.length), rem = c.yearsLeft, el = L - rem;
  if (rem <= 0) return out;
  out[currentYear] = c.capHit;
  if (L <= 0 || rem <= 1 || c.salary + c.bonus <= 0) return out;
  const P = Math.min(L, MAX_BONUS_PRORATION_YEARS);
  const B = c.bonus / P;
  const kind = contractKind(c, currentYear);
  const put = (k: number, v: number) => { out[currentYear + k] = Math.max(0, v); };

  if (kind === "extension-pending") {
    // Old-deal years first (still at the old salary), then the new deal.
    const yrsIn = c.rookieYear != null ? currentYear - c.rookieYear : 99;
    const oldLeft = yrsIn >= 0 && yrsIn < 4 && (c.yearsPro ?? 99) <= 4 ? Math.max(1, 4 - yrsIn) : 1;
    const kOld = Math.min(oldLeft, L - 1);
    const N = L - kOld, Pn = Math.min(N, MAX_BONUS_PRORATION_YEARS), Bn = c.bonus / Pn;
    const old = Array.from({ length: kOld }, (_, j) => c.capHit * 1.1 ** j);
    const sal = salarySchedule(c.salary - old.reduce((a, b) => a + b, 0), N);
    for (let k = 1; k < rem; k++) put(k, k < kOld ? old[k] : sal[k - kOld] + (k - kOld < Pn ? Bn : 0));
    return out;
  }

  const sNow = c.capHit - (el < P ? B : 0);
  let d: number;
  if (kind === "extension-guaranteed") {
    // Dead money minus the bonus left = salary still owed, this season included.
    const owed = (c.releasePenalty ?? 0) - B * Math.max(0, P - el);
    const n = rem - 1;
    d = (owed - sNow - n * sNow) / ((n * (n + 1)) / 2);
  } else {
    // Straight line through this season's known salary; the whole deal adds up to its total.
    const denom = (L * (L - 1)) / 2 - L * el;
    d = denom ? (c.salary - L * sNow) / denom : 0;
  }
  const rookie = kind === "standard" && c.rookieYear === currentYear - el && (c.yearsPro ?? 99) <= L;
  for (let k = 1; k < rem; k++) {
    let s = sNow + d * k;
    if (rookie) s = (s + sNow * 1.1 ** k) / 2; // real-life rookie scale climbs ~10% a year
    put(k, s + (el + k < P ? B : 0));
  }
  return out;
}

/** Projection inputs for a league player. */
export function contractInput(p: { contract: { length: number; yearsLeft: number; salary: number; bonus: number; capHit: number; releasePenalty: number }; draft: { year: number }; yearsPro: number }): ContractLike {
  return { ...p.contract, rookieYear: p.draft.year, yearsPro: p.yearsPro };
}

/** The league's cap this season: the most common cap among teams (ignores a team with the cap switched off). */
export function leagueCap(teams: { cap: { room: number } }[]): number {
  const counts = new Map<number, number>();
  for (const t of teams) counts.set(t.cap.room, (counts.get(t.cap.room) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] || 0;
}
