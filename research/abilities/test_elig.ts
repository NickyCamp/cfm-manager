import { readFileSync } from "fs";
import { eligibleAbilities, archetypeScores, mechanic, ABILITIES } from "/home/claude/cfm-manager/src/lib/league/abilities";
import { RATING_KEYS } from "/home/claude/cfm-manager/src/lib/league/ratings";
const D = JSON.parse(readFileSync("/home/claude/abil/players.json","utf8"));
const RK: string[] = D.rkeys;
const idx = RATING_KEYS.map(k => RK.indexOf(k));
const mk = (r: any) => ({ id: r[1], first: r[2].split(' ')[0], last: r[2].split(' ').slice(1).join(' '), pos: r[3], ovr: r[4], dev: r[8], ratings: idx.map(i => r[11][i]),
  slots: r[12].map((s: any) => ({ ovr: s[0], locked: !!s[1], title: s[3], tier: ({ABILITY_BRONZE:'Bronze',ABILITY_SILVER:'Silver',ABILITY_GOLD:'Gold',ABILITY_INVALID:'X-Factor'} as any)[s[4]]||'' })), abilities: [] } as any);
const players = D.players.filter((r: any) => r[0]==='ncl').map(mk);
for (const nm of ["Josh Sweat","Myles Garrett","Patrick Mahomes","Trey McBride","Bucky Irving"]) {
  const p = players.find((x: any) => `${x.first} ${x.last}` === nm); if (!p) { console.log('no', nm); continue; }
  const sc = archetypeScores(p);
  console.log(`\n== ${nm} ${p.pos} ${p.ovr} dev${p.dev}`, Object.fromEntries(Object.entries(sc||{}).map(([k,v])=>[k,+(v as number).toFixed(1)])));
  console.log(' slots', p.slots.map((s:any)=>`${s.ovr}${s.locked?'L':''}:${s.title||'-'}`).join(' | '));
  for (const e of eligibleAbilities(p)) console.log(`  ${e.tier.padEnd(6)} ${e.ability.title}${e.has?` (has ${e.has})`:''}${e.borderline?' [borderline]':''}${e.next?`  next ${e.next.tier}: `+e.next.missing.map(m=>`${m.label} ${m.min}${m.have!=null?` (has ${m.have})`:''}`).join(', '):''}`);
}
// coverage stats
let withSlots=0, total=0, elig=0;
for (const p of players) { if (!p.slots.length) continue; withSlots++; const e=eligibleAbilities(p); total+=e.length; if (e.length) elig++; }
console.log('\nplayers with slots', withSlots, 'with ≥1 eligible', elig, 'avg eligible', (total/withSlots).toFixed(1));
console.log(mechanic('BlockingDef_ChanceNonEngDefMoveOutcome_DefWin'), mechanic('SnapPosition'), mechanic('Catching_ChanceMpCatchWin'));
// sanity: do current holders show as eligible for what they hold?
let hold=0, holdElig=0;
for (const p of players) { const e=new Set(eligibleAbilities(p).filter(x=>x.has).map(x=>x.ability.key)); for (const s of p.slots) if (s.title && ABILITIES[s.title.toLowerCase().replace(/[^a-z0-9]/g,'')]) { hold++; if (e.has(s.title.toLowerCase().replace(/[^a-z0-9]/g,''))) holdElig++; } }
console.log('held abilities that pass full eligibility check', holdElig, '/', hold);
