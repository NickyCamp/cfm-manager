// Stress test for the 50% amnesty (src/lib/league/amnesty.ts): builds every shape of
// contract Madden makes (lengths 1-7, every point in the deal, void years, guaranteed
// salary, extensions carrying an old bonus, restructures), charges each the way Madden
// does (cap.ts rules: bonus over min(length + void, 5) seasons; dead if cut = bonus not
// yet charged incl. this season + guaranteed salary; a cut charges this season's bonus
// share now, the rest next season), then applies the amnesty recipe to the same model
// and checks the cut charges exactly the target, all this season.
// Run: npx tsx scripts/amnesty/check.ts
import { amnestyPlan, amnestyTarget, MONEY_STEP } from "../../src/lib/league/amnesty";

type Deal = { len: number; el: number; voids: number; salary: number[]; bonus: number; gtd: number; oldTail: number[] };
const U = MONEY_STEP;
const r10 = (n: number) => Math.round(n / U) * U;

/** Madden's per-season numbers for a deal at season `el` (0-based) of its life. */
function charge(d: Deal) {
  const P = Math.min(d.len + d.voids, 5), B = d.bonus / P;
  const seasons = d.len + d.voids - d.el;
  const bonus: number[] = [], hits: number[] = [], dead: number[] = [];
  for (let k = 0; k < Math.max(seasons, d.oldTail.length); k++) {
    const s = d.el + k;
    const b = (s < P ? B : 0) + (d.oldTail[k] || 0);
    if (s < d.len) { bonus.push(b); hits.push(d.salary[s] + b); dead.push(0); }
    else { bonus.push(0); hits.push(0); dead.push(b); }
  }
  const gtdOwed = d.salary.slice(d.el, Math.min(d.gtd, d.len)).reduce((a, x) => a + x, 0);
  const pen = r10(bonus.reduce((a, x) => a + x, 0) + dead.reduce((a, x) => a + x, 0) + gtdOwed);
  return { bonus, hits, dead, pen, capHit: hits[0] };
}
const cutSplit = (c: ReturnType<typeof charge>) => { const now = Math.min(c.pen, c.bonus[0]); return [now, c.pen - now]; };

let n = 0, fails = 0, maxRound = 0;
const fail = (m: string) => { fails++; if (fails < 20) console.log("FAIL", m); };
for (let len = 1; len <= 7; len++)
  for (let voids = 0; voids <= 3; voids++)
    for (let el = 0; el < len; el++)
      for (const bonus of [0, 450_000, 3_330_000, 28_300_000, 57_600_000, 101_010_000])
        for (const gtd of [0, 1, len])
          for (const tail of [[], [4_680_000, 4_680_000], [6_400_000]])
            for (const salAvg of [870_000, 4_200_000, 31_000_000]) {
              const salary = Array.from({ length: len }, (_, i) => r10(salAvg * (0.6 + (0.8 * i) / Math.max(1, len - 1))));
              const deal: Deal = { len, el, voids, salary, bonus, gtd, oldTail: tail };
              const c = charge(deal);
              const plan = amnestyPlan({ capHit: c.capHit, pen: c.pen, bonus: c.bonus, hits: c.hits, dead: c.dead, ps: false }, { year: 2028 });
              n++;
              // target: half of Madden's number, on Madden's $10K grid, within $5K
              if (plan.target % U !== 0) fail(`grid ${plan.target}`);
              const off = Math.abs(plan.target - c.pen / 2);
              maxRound = Math.max(maxRound, off);
              if (off > U / 2) fail(`half ${plan.target} vs ${c.pen}`);
              // breakdown and normal split add back up to Madden's penalty
              const bd = plan.breakdown.bonusLeft + plan.breakdown.voidBonus + plan.breakdown.other;
              if (Math.abs(bd - c.pen) > 1) fail(`breakdown ${bd} vs ${c.pen}`);
              const [a, b] = cutSplit(c);
              if (plan.normal[0] !== a || plan.normal[1] !== b) fail(`split ${plan.normal} vs ${a},${b}`);
              // the rebuilt deal: 1 year, bonus T, minimum salary, no void, no guarantee
              const S = 795_000;
              const rebuilt = charge({ len: 1, el: 0, voids: 0, salary: [S], bonus: plan.target, gtd: 0, oldTail: [] });
              const [now, next] = cutSplit(rebuilt);
              if (rebuilt.pen !== plan.target) fail(`post-edit penalty ${rebuilt.pen} vs ${plan.target}`);
              if (now !== plan.target || next !== 0) fail(`post-edit split ${now}/${next}`);
              if (rebuilt.capHit !== S + plan.target) fail(`post-edit cap hit`);
              // the card checks catch an edit that kept void years or a guarantee
              if (plan.target > 0) {
                const keptVoid = charge({ len: 1, el: 0, voids: 2, salary: [S], bonus: plan.target, gtd: 0, oldTail: [] });
                if (keptVoid.capHit === S + plan.target) fail("void-year edit not caught by cap-hit check");
                const keptGtd = charge({ len: 1, el: 0, voids: 0, salary: [S], bonus: plan.target, gtd: 1, oldTail: [] });
                if (keptGtd.pen === plan.target) fail("guaranteed edit not caught by penalty check");
              }
              // the amnesty's cap effect: this season frees cap hit - T, later seasons free everything
              if (plan.amnestyDelta[0] !== c.capHit - plan.target) fail("delta0");
            }
// Edge cases
const z = amnestyPlan({ capHit: 870_000, pen: 0, bonus: [0], hits: [870_000], dead: [0], ps: false });
if (z.target !== 0 || z.flags[0]?.kind !== "none") fail("zero penalty");
if (amnestyTarget(15_000) !== 10_000 || amnestyTarget(25_000) !== 10_000 || amnestyTarget(20_000) !== 10_000 || amnestyTarget(9_660_000) !== 4_830_000) fail("rounding");
console.log(`${n} contracts checked, ${fails} failures, largest rounding $${maxRound.toLocaleString()}`);
process.exit(fails ? 1 : 0);
