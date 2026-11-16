// Server-side projection for a league player: his real contract when Madden
// still carries it (realContracts.ts), otherwise the formula (cap.ts), and on
// top of either, any restructure the transaction log saw (history.ts).
import { contractInput, MAX_BONUS_PRORATION_YEARS, projectContract } from "./cap";
import { realProjection, realVoidYears, type RealSource } from "./realContracts";
import type { Player } from "./types";

export type ProjectionSource = RealSource | "formula" | "restructured";

type Projection = { hits: Record<number, number>; dead: Record<number, number>; source: ProjectionSource };

function plainProjection(p: Player, currentYear: number): Projection {
  const c = contractInput(p);
  const name = { first: p.first, last: p.last, draftYear: p.draft?.year ?? null };
  const real = realProjection(name, c, currentYear);
  const dead = realVoidYears(name, c, currentYear);
  return real ? { ...real, dead } : { hits: projectContract(c, currentYear), dead, source: "formula" };
}

/**
 * hits: cap hit for each season he's under contract (this season is Madden's).
 * dead: void-year bonus still counting after the contract ends (not a roster spot).
 */
export function projectPlayer(p: Player, currentYear: number): Projection {
  const plain = plainProjection(p, currentYear);
  return p.restructure ? withRestructure(p, currentYear, plain) : plain;
}

/**
 * A restructure turns salary X into bonus. EA's totals then look like a deal
 * with a big, evenly spread bonus, which the formula can't tell apart, so with
 * the deal from before the restructure in the log, project that deal and move
 * the money: X leaves the season it was done in and comes back as X/n in each
 * of the next n-1 seasons, n = the seasons left in the 5-year bonus window,
 * at least 2 (a final-year restructure pushes X/2 into a void year).
 * Checked on NCL's 2028 restructures: lands on Madden's 2028 cap hit to within
 * a few % whenever the old deal itself was projected well (Benford, Bernard,
 * Strange, Njoku, Diaby to 1%).
 */
function withRestructure(p: Player, currentYear: number, plain: Projection): Projection {
  const r = p.restructure!;
  const c = p.contract, b = r.before;
  const x = b.salary - c.salary;
  if (!(x > 0) || Math.abs(c.bonus - b.bonus - x) > Math.max(50_000, 0.02 * x)) return plain;
  const old = plainProjection({ ...p, contract: { ...b, releasePenalty: 0, releaseSavings: 0 }, yearsPro: p.yearsPro - (currentYear - r.fromYear) }, r.fromYear);
  const leftAtR = c.yearsLeft + (currentYear - r.year);
  const n = Math.max(2, Math.min(c.length, MAX_BONUS_PRORATION_YEARS) - (c.length - leftAtR));
  const end = currentYear + c.yearsLeft - 1;
  const hits: Record<number, number> = { [currentYear]: c.capHit };
  const dead: Record<number, number> = { ...old.dead };
  for (let y = currentYear + 1; y <= end; y++) {
    const base = old.hits[y] ?? plain.hits[y];
    if (base == null) continue;
    hits[y] = base + (y - r.year >= 1 && y - r.year < n ? x / n : 0);
  }
  for (let y = Math.max(end + 1, r.year + 1); y < r.year + n; y++) dead[y] = (dead[y] || 0) + x / n;
  return { hits, dead, source: "restructured" };
}
