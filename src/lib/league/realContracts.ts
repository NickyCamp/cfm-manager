// Real NFL contracts (OverTheCap via nflverse) for players still on the deal
// their Madden 27 franchise imported. Madden copies real contracts in year by
// year, so for those players the real cap numbers are the best projection.
// Checked against Madden's cap screens (NCL, 2026-10-28): unchanged real deals
// land within ~1% in dollars, versus ~15-20% for any formula on these deals.
//
// Server-only: the JSON is ~70 KB and shouldn't ship to the browser.
import data from "./real-contracts.json";
import { MAX_BONUS_PRORATION_YEARS, yearlyRaise, type ContractLike } from "./cap";

type Entry = [first: string, last: string, draftYear: number | null, start: number, caps: number[], value: number, pros: number[], proAfter: number, signed: number | null, voids: number[]];
const { unit, players } = data as unknown as { unit: number; players: Entry[] };

export function normName(s: string) {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "").replace(/[^a-z ]/g, " ").split(/\s+/).filter(Boolean);
}

const byLast = new Map<string, Entry[]>();
for (const e of players) {
  const list = byLast.get(e[1]) || [];
  list.push(e);
  byLast.set(e[1], list);
}

/** EA's draft year is the real draft year + 1 for Madden 27 rosters; allow either. */
function findEntry(first: string, last: string, eaDraftYear: number | null): Entry | null {
  const l = normName(last).pop();
  const f = normName(first)[0];
  if (!l || !f) return null;
  // A full first name must match exactly; an initial ("J.") matches any first name starting with it.
  const initialOnly = f.length === 1;
  let c = (byLast.get(l) || []).filter((e) => (initialOnly ? e[0][0] === f : e[0] === f));
  if (c.length > 1 && eaDraftYear) {
    const d = c.filter((e) => e[2] != null && Math.abs(e[2] - (eaDraftYear - 1)) <= 1);
    if (d.length) c = d;
  }
  return c.length === 1 ? c[0] : null;
}

export type RealSource = "real" | "real-restructured" | "real-extended";

/**
 * Cap hit by year from the player's real contract, or null when it doesn't
 * describe his current Madden contract (re-signed, cut, traded and redone...).
 * - Same deal: real numbers, shifted by any small gap Madden shows this season.
 * - Restructured in the franchise (Madden's cap hit is lower than the real one):
 *   the converted salary X became bonus spread over the rest of the bonus
 *   window, so this season drops by X - X/n and the next n-1 seasons rise X/n.
 * - Extended in the franchise (contract restarted and runs past the real one):
 *   the real deal's years stay as they were, then the new years follow
 *   Madden's even raises. EA's bonus is the real bonus not yet charged when the
 *   extension was signed plus the new bonus, which starts after the old deal.
 */
export function realProjection(
  name: { first: string; last: string; draftYear: number | null },
  c: ContractLike, currentYear: number,
): { hits: Record<number, number>; source: RealSource } | null {
  if (c.yearsLeft < 2) return null;
  const e = findEntry(name.first, name.last, name.draftYear);
  if (!e) return null;
  const [, , , start, caps, value, pros, proAfter] = e;
  const realEnd = start + caps.length - 1;
  const has = (y: number) => y >= start && y <= realEnd;
  const cap = (y: number) => caps[y - start] * unit;
  const pro = (y: number) => pros[y - start] * unit;
  const maddenEnd = currentYear + c.yearsLeft - 1;
  if (!has(currentYear)) return null;
  const c0 = cap(currentYear);
  if (!(c0 > 0)) return null;
  const gap = c0 - c.capHit;
  const hits: Record<number, number> = { [currentYear]: c.capHit };
  const el = c.length - c.yearsLeft;

  const signed = currentYear - el;
  if (realEnd < maddenEnd && has(signed) && Math.abs(gap) <= 0.15 * c.capHit) {
    let oldSalary = 0, oldBonusLeft = proAfter * unit;
    for (let y = signed; y <= realEnd; y++) { oldSalary += cap(y) - pro(y); oldBonusLeft += pro(y); }
    const n = maddenEnd - realEnd;
    const newSalary = c.salary - oldSalary;
    if (newSalary > 0) {
      const pn = Math.min(n, MAX_BONUS_PRORATION_YEARS);
      const bn = Math.max(0, c.bonus - oldBonusLeft) / pn;
      const avg = newSalary / n, d = yearlyRaise(n, avg), s1 = avg - (d * (n - 1)) / 2;
      for (let y = currentYear + 1; y <= maddenEnd; y++) {
        if (y <= realEnd) hits[y] = Math.max(0, cap(y) - gap);
        else { const i = y - realEnd - 1; hits[y] = Math.max(0, s1 + d * i) + (i < pn ? bn : 0); }
      }
      return { hits, source: "real-extended" };
    }
  }

  // Same contract: Madden's total equals the real contract's value (restructures move money, not add it).
  const ratio = (c.salary + c.bonus) / (value * unit);
  if (!(ratio >= 0.7 && ratio <= 2.1)) return null;
  // The imported deal started before this season, in the year it was really signed.
  if (realEnd !== maddenEnd || el < 1 || (e[8] != null && e[8] !== signed)) return null;
  if (Math.abs(gap) <= 0.1 * c.capHit) {
    for (let k = 1; k < c.yearsLeft; k++) hits[currentYear + k] = Math.max(0, cap(currentYear + k) - gap);
    return { hits, source: "real" };
  }
  const n = Math.min(c.length, MAX_BONUS_PRORATION_YEARS) - el;
  const x = (gap * n) / (n - 1);
  // The converted salary becomes bonus, so it can't exceed the bonus Madden now shows.
  if (gap > 500_000 && n >= 2 && x <= c.bonus + 10_000 && c.capHit >= 0.2 * c0) {
    for (let k = 1; k < c.yearsLeft; k++) hits[currentYear + k] = cap(currentYear + k) + (k < n ? x / n : 0);
    return { hits, source: "real-restructured" };
  }
  return null;
}

/**
 * Void-year dead money after the contract ends: the real deal's bonus still
 * charged in its void years. Madden keeps these only inside the 5-season bonus
 * window from the contract's start (checked on the NCL: 95 of 120 in-window
 * void years shown, 0 of 49 outside), and only while the player is still on
 * that real deal.
 */
export function realVoidYears(
  name: { first: string; last: string; draftYear: number | null },
  c: ContractLike, currentYear: number,
): Record<number, number> {
  const out: Record<number, number> = {};
  if (c.yearsLeft < 1) return out;
  const e = findEntry(name.first, name.last, name.draftYear);
  if (!e) return out;
  const [, , , start, caps, value, , , signed, voids] = e;
  const realEnd = start + caps.length - 1;
  const maddenEnd = currentYear + c.yearsLeft - 1;
  const maddenStart = currentYear - (c.length - c.yearsLeft);
  const ratio = (c.salary + c.bonus) / (value * unit);
  if (realEnd !== maddenEnd || signed !== maddenStart || !(ratio >= 0.7 && ratio <= 2.1)) return out;
  voids.forEach((v, i) => {
    const y = realEnd + 1 + i;
    if (y - maddenStart < MAX_BONUS_PRORATION_YEARS && v > 0) out[y] = v * unit;
  });
  return out;
}
