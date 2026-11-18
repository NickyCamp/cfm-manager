// /funfact player|team (Nick, 2026-11-13): turn this season's numbers into one fun, plain-English
// fact, e.g. "1 in every 23 passes Cam Ward throws gets picked off". Each template checks it has
// enough data, builds its sentence, and gets a weight; /funfact picks one at random by weight,
// so running it again usually gives a different fact. Regular season unless a fact says otherwise.
import { randomInt } from "node:crypto";
import { REG_SEASON_LAST_WEEK, capSeason, seasonTotals, weekTitle, type Totals } from "../league/derive";
import { projectPlayer } from "../league/projection";
import type { Game, LeagueData, Player, StatLine, Team } from "../league/types";
import { RATING_KEYS, RATING_LABEL } from "../league/ratings";
import { every, factId, money, nth, ord, pct, pick, plural, poss, tail, type Fact } from "./factFormat";
import { teamRoasts } from "./teamRoasts";

export type { Fact } from "./factFormat";

const regGame = (g: Game | undefined) => Boolean(g && g.stage === 1 && g.week <= REG_SEASON_LAST_WEEK);

export type Ctx = {
  d: LeagueData;
  games: Map<number, Game>;
  totals: Map<number, Totals & { team: number }>;
  teamName: (id: number) => string;
  /** Per team, this regular season: points for/against, games, and summed team stats. */
  teamAgg: Map<number, { gp: number; pf: number; pa: number; sacksBy: number; intsBy: number; pen: number; penYds: number; to: number; take: number; rz: [number, number]; fourth: [number, number] }>;
};

function context(d: LeagueData): Ctx {
  const games = new Map(d.games.map((g) => [g.id, g]));
  const totals = seasonTotals(d);
  const teamAgg: Ctx["teamAgg"] = new Map();
  const agg = (t: number) => {
    let a = teamAgg.get(t);
    if (!a) { a = { gp: 0, pf: 0, pa: 0, sacksBy: 0, intsBy: 0, pen: 0, penYds: 0, to: 0, take: 0, rz: [0, 0], fourth: [0, 0] }; teamAgg.set(t, a); }
    return a;
  };
  for (const g of d.games) {
    if (!g.final || !regGame(g) || !g.home || !g.away) continue;
    const h = agg(g.home), a = agg(g.away);
    h.gp++; a.gp++; h.pf += g.hs; h.pa += g.as; a.pf += g.as; a.pa += g.hs;
  }
  for (const r of d.teamGames) {
    if (!regGame(games.get(r.g))) continue;
    const a = agg(r.t);
    a.sacksBy += r.sacks; a.pen += r.penalties; a.penYds += r.penaltyYds; a.to += r.turnovers; a.take += r.takeaways;
    a.rz[0] += r.redZone[0]; a.rz[1] += r.redZone[1]; a.fourth[0] += r.fourth[0]; a.fourth[1] += r.fourth[1];
  }
  for (const l of d.lines) if (regGame(games.get(l.g)) && l.int) agg(l.t).intsBy += l.int;
  const teams = new Map(d.teams.map((t) => [t.id, t]));
  return { d, games, totals, teamAgg, teamName: (id) => (teams.get(id) ? `the ${teams.get(id)!.name}` : "his team") };
}

// ---------- players ----------

const GROUP: Record<string, string> = {
  QB: "QB", HB: "RB", FB: "RB", WR: "WR", TE: "WR",
  LT: "OL", LG: "OL", C: "OL", RG: "OL", RT: "OL",
  LEDG: "DEF", REDG: "DEF", LE: "DEF", RE: "DEF", DT: "DEF", SAM: "DEF", MIKE: "DEF", WILL: "DEF", LOLB: "DEF", MLB: "DEF", ROLB: "DEF", CB: "DEF", FS: "DEF", SS: "DEF",
  K: "K", P: "P",
};

// Everything is a roast now (Nick, 2026-11-18: "I want these all to be roasts and as vicious as you
// can be"). Stats that used to be neutral only show up when the number is embarrassing.
export function playerFacts(d: LeagueData, p: Player): Fact[] {
  const c = context(d);
  const t = c.totals.get(p.id);
  const who = p.last;
  const team = c.teamName(p.team);
  const Team = team.charAt(0).toUpperCase() + team.slice(1);
  const g = GROUP[p.pos] || "";
  const out: Fact[] = [];
  const add = (key: string, weight: number, variants: string[], jab = true) => {
    const text = pick(variants);
    out.push({ key: `p:${key}`, weight, text: jab ? tail(text) : text });
  };

  if (t && t.gp) {
    // INT rate, only when it's worse than the league's.
    if (t.pa >= 50 && t.pint > 0) {
      const qbs = [...c.totals.values()].filter((x) => x.pa >= 50);
      const leagueRate = qbs.reduce((a, x) => a + x.pa, 0) / Math.max(1, qbs.reduce((a, x) => a + x.pint, 0));
      const mine = t.pa / t.pint;
      if (mine < leagueRate * 0.9) add("intrate", 3, [
        `**1 in every ${every(mine)} passes** ${who} throws gets picked off (league average: 1 in ${every(leagueRate)}). Defenses see him on the schedule and start stretching their hands.`,
        `${who} throws a pick every **${every(mine)} attempts**. The league average is ${every(leagueRate)}. He's basically a defensive coordinator for the other team.`,
        `${who} throws a pick every **${every(mine)} passes**. Floyd Mayweather reads better than this man.`,
        `1 INT every ${every(mine)} throws. ${who} reads defenses like he's holding the book upside down.`,
      ]);
    }
    if (t.psk > 0 && t.pa >= 50 && (t.pa + t.psk) / t.psk < 12) add("sackrate", 2.5, [
      `${who} gets sacked once every **${every((t.pa + t.psk) / t.psk)} dropbacks**. He holds the ball like it owes him money.`,
      `${plural(t.psk, "sack")} this season for ${who}, one every ${every((t.pa + t.psk) / t.psk)} dropbacks. Pocket presence of a lawn chair.`,
    ]);
    if (g === "QB" && t.pa >= 50 && t.ra / t.gp >= 6) add("qbruns", 3, [
      `${who} has taken off running **${t.ra} times** this season. He may as well snap the ball and close his eyes.`,
      `${t.ra} QB runs for ${who}. Reading the defense is optional when you just panic and sprint.`,
      `${who} runs it **${(t.ra / t.gp).toFixed(1)} times a game**. Someone tell him the forward pass is allowed.`,
    ]);
    if (t.ra >= 20 && t.ry / t.ra < 4) {
      const ypc = t.ry / t.ra;
      add("carries100", 2.5, [
        `${who} averages **${ypc.toFixed(1)} yards a carry**. It would take him **${every(100 / ypc)} straight carries** to go the length of the field.`,
        `At ${ypc.toFixed(1)} a carry, ${who} needs **${every(100 / ypc)} carries** to go 100 yards. Bring a lunch.`,
        `${t.ra} carries, ${ypc.toFixed(1)} a pop. ${Team} hand it to ${who} and may as well snap the ball and close their eyes.`,
      ]);
    }
    if (t.rfum >= 3) add("fumrate", 3, [
      `${who} puts the ball on the ground once every **${every((t.ra + t.rc) / t.rfum)} touches** (${plural(t.rfum, "fumble")}). Hands made of butter.`,
      `${plural(t.rfum, "fumble")} for ${who} this season. Every touch is a coin flip for ${team}.`,
    ]);
    if (t.rc >= 10 && t.rcdrop >= 3) add("droprate", 3, [
      `${who} drops one pass for every **${every(t.rc / t.rcdrop)} he catches** (${plural(t.rcdrop, "drop")}). Stone hands.`,
      `${plural(t.rcdrop, "drop")} for ${who}. QBs throw to him and then pray.`,
      `${plural(t.rcdrop, "drop")} this year. A T-Rex has better hands than ${who}.`,
    ]);
    if (t.fga >= 5 && t.fgm / t.fga < 0.8) add("fgpct", 3, [
      `${who} has made **${pct((t.fgm / t.fga) * 100)} of his field goals** (${t.fgm}/${t.fga}). ${Team} should just go for it every time.`,
      `${t.fgm} of ${t.fga} on field goals for ${who}. The uprights are 18 and a half feet apart, my guy.`,
      `${who} is ${t.fgm}/${t.fga} on field goals. Kicks like he's wearing Crocs.`,
    ]);
    if (t.pnt >= 30) add("punts", 2, [
      `${who} has punted **${t.pnt} times** this season: **${(t.pnty * 3 / 5280).toFixed(2)} miles** of the offense giving up.`,
      `${poss(Team)} offense has sent ${who} out **${t.pnt} times**. He's their most reliable player, which says everything.`,
    ]);
    // Cost per stat, only when he costs a lot more per unit than his position usually does.
    const capHit = p.contract.capHit;
    const val = (x: Totals) => (g === "QB" ? x.py : g === "RB" ? x.ry : g === "WR" ? x.rcy : g === "DEF" ? x.tk : g === "K" ? x.fgm : 0);
    const unit = g === "QB" ? "passing yard" : g === "RB" ? "rushing yard" : g === "WR" ? "receiving yard" : g === "DEF" ? "tackle" : g === "K" ? "field goal" : "";
    if (p.team && capHit >= 2e6 && unit && val(t) > 0) {
      const costs = d.players.filter((x) => !x.gone && x.team && !x.ps && GROUP[x.pos] === g && x.contract.capHit > 0)
        .map((x) => { const xt = c.totals.get(x.id); return xt && val(xt) > 0 ? x.contract.capHit / val(xt) : null; })
        .filter((v): v is number => v != null).sort((x, y) => x - y);
      const mine = capHit / val(t);
      const median = costs[Math.floor(costs.length / 2)] || Infinity;
      if (costs.length >= 10 && mine >= median * 1.5) add("costper", 3.5, [
        `${Team} are paying ${who} **${money(mine)} per ${unit}** (${money(capHit)} cap hit). Highway robbery.`,
        `Every ${unit} ${who} gets costs ${team} **${money(mine)}**. His agent should be in the Hall of Fame.`,
      ]);
    }
  }

  // Not stat-based: always something to make fun of.
  if (p.ratings) {
    const rs = RATING_KEYS.map((k, i) => ({ k, v: p.ratings![i] ?? 0 })).filter((r) => r.k !== "injuryRating" && r.k !== "staminaRating" && r.k !== "confRating" && r.v > 0);
    if (rs.length) {
      const lo = rs.reduce((a, b) => (b.v < a.v ? b : a));
      add("worstrating", 1.5, [
        `${poss(who)} **${RATING_LABEL[lo.k]}** rating is a **${lo.v}**. My grandma is a ${Math.min(99, lo.v + 20)}.`,
        `${who} has **${lo.v} ${RATING_LABEL[lo.k]}**. Genuinely one of the worst things on his card.`,
        `Fun fact: ${poss(who)} ${RATING_LABEL[lo.k]} is **${lo.v}**. The scouts were being generous.`,
      ]);
    }
  }
  const older = d.players.filter((x) => !x.gone && x.team && x.age < p.age).length / Math.max(1, d.players.filter((x) => !x.gone && x.team).length);
  if (p.age >= 32) add("age", 2, [
    `At ${p.age}, ${who} is older than **${pct(older * 100)} of the league**. His knees file for retirement every Sunday.`,
    `${who} is **${p.age}**, older than ${pct(older * 100)} of the league. Senior discount at the team hotel.`,
  ]);
  // A star stuck on a bad team: roast the team through him.
  const tm = d.teams.find((x) => x.id === p.team);
  if (tm && p.ovr >= 88 && tm.rec.l - tm.rec.w >= 3) add("hostage", 3, [
    `${who} is a **${p.ovr} overall** stuck on a **${tm.rec.w}-${tm.rec.l}** team. Blink twice if you need help.`,
    `Somebody free ${who}. ${p.ovr} OVR, wasting his prime on the ${tm.rec.w}-${tm.rec.l} ${tm.name}.`,
  ]);
  out.push(...playerRoasts(c, p, t));
  return out;
}

// ---------- teams ----------

export function teamFacts(d: LeagueData, team: Team): Fact[] {
  const c = context(d);
  const a = c.teamAgg.get(team.id);
  const name = `The ${team.name}`;
  const out: Fact[] = [];
  const add = (key: string, weight: number, variants: string[]) => out.push({ key: `t:${key}`, weight, text: tail(pick(variants)) });
  const losing = team.rec.l > team.rec.w;

  // 4th downs: only when they're awful at it.
  if (a && a.fourth[1] >= 4 && a.fourth[0] / a.fourth[1] <= 0.3) add("fourthpct", 3.5, [
    `${name} have gone for it on 4th down **${a.fourth[1]} times** and converted **${a.fourth[0]}** (${pct((a.fourth[0] / a.fourth[1]) * 100)}). Stop. Just punt.`,
    `${pct((a.fourth[0] / a.fourth[1]) * 100)} on 4th down (${a.fourth[0]}/${a.fourth[1]}). ${name} play 4th and 2 like it's 4th and 40.`,
  ]);
  // Cap per point: only when they pay more than most.
  const spent = team.cap.spent;
  if (a && a.gp && spent > 0 && a.pf > 0) {
    const perPoint = (tt: Team) => { const x = c.teamAgg.get(tt.id); return x && x.pf ? tt.cap.spent / x.pf : Infinity; };
    const mine = perPoint(team);
    const cheaper = d.teams.filter((tt) => perPoint(tt) < mine).length;
    if (cheaper >= d.teams.length - 10) add("perpoint", 3.5, [
      `${name} pay **${money(mine)} in cap for every point** they score. ${plural(cheaper, "team")} get their points cheaper. Terrible investment.`,
      `Every point the ${team.name} score costs **${money(mine)}**. Their offense is a luxury item with no luxury.`,
    ]);
  }
  // Worst loss, only if it was ugly.
  const gs = d.games.filter((g) => g.final && regGame(g) && (g.home === team.id || g.away === team.id));
  const res = gs.map((g) => { const home = g.home === team.id; const us = home ? g.hs : g.as, them = home ? g.as : g.hs; return { g, home, us, them, diff: us - them }; });
  if (res.length) {
    const worst = res.reduce((x, y) => (y.diff < x.diff ? y : x));
    if (worst.diff <= -21) add("worstloss", 4, [
      `${poss(name)} worst loss: **${worst.them}-${worst.us}** to ${c.teamName(worst.home ? worst.g.away : worst.g.home)} in ${weekTitle(d, worst.g.stage, worst.g.week)}. Burn the tape.`,
      `${weekTitle(d, worst.g.stage, worst.g.week)}: ${c.teamName(worst.home ? worst.g.away : worst.g.home)} ${worst.them}, the ${team.name} ${worst.us}. That wasn't a game, that was a public execution.`,
    ]);
  }
  // Top cap hit vs the cheap guys, only on a losing team.
  const roster = d.players.filter((p) => !p.gone && p.team === team.id && !p.ps);
  if (losing && roster.length >= 10) {
    const hits = roster.map((p) => ({ p, hit: p.contract.capHit })).filter((x) => x.hit > 0).sort((x, y) => y.hit - x.hit);
    if (hits.length > 10) {
      const top = hits[0];
      let sum = 0, k = 0;
      for (let i = hits.length - 1; i > 0 && sum + hits[i].hit <= top.hit; i--) { sum += hits[i].hit; k++; }
      if (k >= 5) add("tophit", 3.5, [
        `${poss(`${top.p.first} ${top.p.last}`)} ${money(top.hit)} cap hit is more than the **${k} cheapest ${team.name} combined**. They're ${team.rec.w}-${team.rec.l}. Great plan.`,
        `${name} put ${money(top.hit)} into ${top.p.first} ${top.p.last} and are **${team.rec.w}-${team.rec.l}**. Money well spent.`,
      ]);
    }
  }
  // The worst-rated guy they actually pay.
  const paid = roster.filter((p) => p.contract.capHit >= 1e6);
  if (paid.length) {
    const scrub = paid.reduce((x, y) => (y.ovr < x.ovr ? y : x));
    if (scrub.ovr <= 70) add("scrub", 2.5, [
      `${name} are paying ${scrub.first} ${scrub.last} **${money(scrub.contract.capHit)}** to be a **${scrub.ovr} overall** ${scrub.pos}.`,
      `${scrub.first} ${scrub.last}: ${scrub.ovr} OVR, ${money(scrub.contract.capHit)}. ${poss(name)} scouting department should be in jail.`,
    ]);
  }
  // A good CPU team: roast everybody who loses to it.
  if (!team.user && gs.length >= 4 && team.rec.w - team.rec.l >= 3) add("cpugood", 3, [
    `Nobody even runs the ${team.name}. The CPU has them at **${team.rec.w}-${team.rec.l}**, which is better than a bunch of you with a controller in your hands.`,
    `${name} are a **CPU team** at ${team.rec.w}-${team.rec.l}. Some of you are losing to a robot that doesn't even care.`,
  ]);
  out.push(...teamRoasts(c, team));
  return out;
}

/** How many recent facts per player/team /funfact remembers and skips. */
export const RECENT_KEEP = 12;

/** One fact, picked at random by weight, skipping the ones shown recently (`recent`: factId list,
 *  newest last). If everything on file was shown recently, it picks among the ones shown longest ago. */
export function pickFact(facts: Fact[], recent: string[] = []): Fact | null {
  if (!facts.length) return null;
  const seen = new Map(recent.map((id, i) => [id, i]));
  let pool = facts.filter((f) => !seen.has(factId(f)));
  if (!pool.length) {
    const oldest = Math.min(...facts.map((f) => seen.get(factId(f))!));
    pool = facts.filter((f) => seen.get(factId(f))! <= oldest + 1);
  }
  const total = pool.reduce((s, f) => s + f.weight, 0);
  let r = (randomInt(1_000_000) / 1_000_000) * total;
  for (const f of pool) { r -= f.weight; if (r <= 0) return f; }
  return pool[pool.length - 1];
}

/** The recently-shown list after showing `f` (kept to RECENT_KEEP, but never more than all but one
 *  of the facts on file, so there's always something new-ish to pick). */
export function remember(recent: string[], f: Fact, onFile: number): string[] {
  const id = factId(f);
  const keep = Math.max(1, Math.min(RECENT_KEEP, onFile - 1));
  return [...recent.filter((x) => x !== id), id].slice(-keep);
}

// ---------- roasts: the embarrassing side (Nick, 2026-11-13: "more embarrassing than impressive,
// players making big money who do nothing"). Weighted higher so they come up most of the time. ----------

const ROAST = 4.5;
const GROUP_NAME: Record<string, string> = { QB: "quarterbacks", RB: "running backs", WR: "receivers", DEF: "defenders", K: "kickers", P: "punters" };
/** What a position group is paid to produce, for "overpaid" facts. */
function production(g: string, t: Totals | undefined): { v: number; label: string; unit: string } | null {
  const x = t || ({} as Totals);
  if (g === "QB") return { v: x.py || 0, label: "passing yards", unit: "passing yard" };
  if (g === "RB") return { v: (x.ry || 0) + (x.rcy || 0), label: "yards from scrimmage", unit: "yard" };
  if (g === "WR") return { v: x.rcy || 0, label: "receiving yards", unit: "receiving yard" };
  if (g === "DEF") return { v: (x.tk || 0) + 4 * (x.sk || 0) + 6 * (x.int || 0) + 2 * (x.pd || 0) + 4 * (x.ff || 0), label: "defensive stats (tackles, sacks, picks)", unit: "" };
  if (g === "K") return { v: x.fgm || 0, label: "field goals made", unit: "field goal" };
  return null;
}

function playerRoasts(c: Ctx, p: Player, t: (Totals & { team: number }) | undefined): Fact[] {
  const { d } = c;
  const out: Fact[] = [];
  /** Several wordings per roast, one picked at random; some get a random closing jab. */
  const add = (key: string, weight: number, variants: string[], jab = true) => {
    const text = pick(variants);
    out.push({ key: `p:${key}`, weight, text: jab ? tail(text) : text });
  };
  const who = p.last;
  const full = `${p.first} ${p.last}`;
  const g = GROUP[p.pos] || "";
  const cap = p.contract.capHit;
  const team = c.teamName(p.team);
  const Team = team.charAt(0).toUpperCase() + team.slice(1);
  const seasonUnderway = d.games.some((x) => x.final && regGame(x));

  // Overpaid: a top-15% cap hit in his position group with below-median production.
  const prod = production(g, t);
  let overpaid = false;
  if (p.team && cap > 0 && prod && seasonUnderway) {
    const peers = d.players.filter((x) => !x.gone && x.team && !x.ps && (GROUP[x.pos] || "") === g && x.contract.capHit > 0);
    const capRank = 1 + peers.filter((x) => x.contract.capHit > cap).length;
    const prodVals = peers.map((x) => production(g, c.totals.get(x.id))!.v);
    const prodRank = 1 + prodVals.filter((v) => v > prod.v).length;
    const silent = cap >= 3e6 && (!t || !t.gp) && g !== "P";
    if (silent) {
      const why = p.ir ? " (he's on IR)" : p.injury > 0 ? ` (he's hurt, out ${p.injury} more week${p.injury === 1 ? "" : "s"})` : "";
      add("silent", ROAST + 1, [
        `${who} has a **${money(cap)} cap hit** and hasn't recorded **a single stat** this season${why}.`,
        `${Team} are paying ${full} **${money(cap)}** this season. Stats so far: **none**${why}.`,
        `${money(cap)} for ${who} this year, and the stat sheet is blank${why}. Nice work if you can get it.`,
      ]);
      overpaid = true;
    } else if (peers.length >= 10 && capRank <= Math.ceil(peers.length * 0.15) && prodRank > peers.length / 2) {
      overpaid = true;
      const per = prod.unit && prod.v > 0 ? ` That's **${money(cap / prod.v)} per ${prod.unit}**.` : "";
      add("overpaid", ROAST + 1, [
        `${who} has the **${ord(capRank)}-biggest cap hit among ${GROUP_NAME[g]}** (${money(cap)}) and ranks **${ord(prodRank)} of ${peers.length}** in ${prod.label}.${per}`,
        `Paid like the ${ord(capRank)}-best of the ${GROUP_NAME[g]} (${money(cap)}), producing like the ${ord(prodRank)}-best. ${who} is a heist.${per}`,
        `${Team} pay ${who} **${money(cap)}**, ${nth(capRank, "most")} among ${GROUP_NAME[g]}. He's **${ord(prodRank)} of ${peers.length}** in ${prod.label}.${per}`,
      ]);
    }
  }
  // Paid like a star, rated like a backup.
  if (p.team && cap >= 15e6 && p.ovr < 78) add("ovr", ROAST, [
    `${Team} are paying ${who} **${money(cap)}** this season. He's a **${p.ovr} overall**.`,
    `**${money(cap)}** for a **${p.ovr} overall**. ${poss(Team)} front office got fleeced on ${who}.`,
    `${who}: ${p.ovr} OVR, ${money(cap)} cap hit. Somebody's agent deserves a raise.`,
  ]);
  // Stuck with him: big dead money if cut. Only when that's actually a problem (he isn't
  // producing, isn't very good, or is getting old); for a healthy star it's just how deals work.
  const c2 = p.contract;
  if (p.team && c2.releasePenalty >= 8e6 && c2.releasePenalty > c2.releaseSavings * 2 && (overpaid || p.ovr < 82 || p.age >= 31)) {
    const ends = capSeason(d) + Math.max(0, c2.yearsLeft - 1);
    add("stuck", ROAST - 1, [
      `Cutting ${who} would leave **${money(c2.releasePenalty)} of dead money** and save only ${money(c2.releaseSavings)}, so ${team} are stuck with him through ${ends}.`,
      `${Team} can't even cut ${who}: it'd cost **${money(c2.releasePenalty)} in dead money**. See you in ${ends}.`,
    ]);
  }
  // Old and signed for years.
  if (p.team && p.age >= 31 && c2.yearsLeft >= 3) {
    const pr = projectPlayer(p, capSeason(d));
    const lastYear = Math.max(...Object.keys(pr.hits).map(Number));
    const lastHit = pr.hits[lastYear];
    add("old", ROAST - 0.5, [
      `${who} is **${p.age}** and signed for **${c2.yearsLeft} more seasons**. He'll be ${p.age + c2.yearsLeft - 1} when the deal ends${lastHit ? `, still costing about ${money(lastHit)} that year` : ""}.`,
      `${Team} signed ${who} through age **${p.age + c2.yearsLeft - 1}**${lastHit ? ` (about ${money(lastHit)} that last year)` : ""}. Bold strategy.`,
    ]);
  }

  if (t && t.gp) {
    // QB: more picks than TDs; leading the league in bad stuff.
    if (t.pa >= 50 && t.pint > t.ptd) add("intstd", ROAST + 1, [
      `${who} has thrown **more interceptions (${t.pint}) than touchdowns (${t.ptd})**.`,
      `${who}: ${plural(t.ptd, "touchdown")}, **${plural(t.pint, "interception")}**. The other team is his favorite target.`,
      `Defenses have caught more of ${poss(who)} passes for picks (${t.pint}) than his own guys have for TDs (${t.ptd}).`,
      `${t.pint} INTs, ${t.ptd} TDs. Floyd Mayweather reads better than ${who}.`,
      `${who} has more picks (${t.pint}) than touchdowns (${t.ptd}). Hooked on Phonics didn't work for him.`,
    ]);
    const worst = (key: string, v: (x: Totals) => number, what: string, min: (x: Totals) => boolean, w = ROAST) => {
      const mine = v(t);
      if (mine <= 0 || !min(t)) return;
      const rank = 1 + [...c.totals.values()].filter((x) => min(x) && v(x) > mine).length;
      if (rank <= 3) add(key, w, [
        `${who} has **${nth(rank, "most")} ${what}** in the league (${mine}).`,
        `League leaders in ${what}: ${rank === 1 ? `**${who}**, at the very top` : `${who}, **${ord(rank)}**`} with ${mine}.`,
      ]);
    };
    worst("mostint", (x) => x.pint, "interceptions thrown", (x) => x.pa > 0);
    worst("mostsk", (x) => x.psk, "sacks taken", (x) => x.pa > 0, ROAST - 1);
    worst("mostfum", (x) => x.rfum, "fumbles", () => true);
    worst("mostdrop", (x) => x.rcdrop, "dropped passes", () => true);
    // Low yards per carry.
    if (t.ra >= 40 && t.ry / t.ra < 3.8) add("ypc", ROAST - 0.5, [
      `${who} averages **${(t.ry / t.ra).toFixed(1)} yards a carry** on ${t.ra} carries. A QB sneak gets about that.`,
      `${(t.ry / t.ra).toFixed(1)} yards a carry. ${who} runs like he's carrying groceries.`,
    ]);
    // Kicker misses.
    const missed = (t.fga - t.fgm) * 3 + (t.xpa - t.xpm);
    if (t.fga - t.fgm >= 3 || t.xpa - t.xpm >= 3) add("misses", ROAST, [
      `${who} has missed **${plural(t.fga - t.fgm, "field goal")}** and **${plural(t.xpa - t.xpm, "extra point")}**, leaving **${missed} points** on the field.`,
      `${who} has kicked away **${missed} points** this season with misses. Uprights are wide, buddy.`,
    ]);
    // Expensive defenders with nothing to show.
    if (g === "DEF" && cap >= 10e6) {
      const edge = ["LEDG", "REDG", "LE", "RE", "DT"].includes(p.pos), db = ["CB", "FS", "SS"].includes(p.pos);
      if (edge && t.sk <= 2 && t.gp >= 6) add("nosacks", ROAST + 0.5, [
        `${Team} pay ${who} **${money(cap)}** to rush the passer. He has **${t.sk === 0 ? "zero sacks" : plural(t.sk, "sack")}** in ${t.gp} games.`,
        `${who} is a **${money(cap)}** pass rusher with **${t.sk === 0 ? "no sacks" : plural(t.sk, "sack")}**. Opposing QBs don't know his name.`,
      ]);
      if (db && t.int === 0 && t.gp >= 6) add("noints", ROAST + 0.5, [
        `${who} is a **${money(cap)}** defensive back with **zero interceptions** in ${t.gp} games.`,
        `${t.gp} games, **zero picks**, ${money(cap)} cap hit. ${who} has hands of stone.`,
      ]);
    }

    // Ugliest game.
    const log = d.lines.filter((l) => l.p === p.id && regGame(c.games.get(l.g))).map((l) => ({ l, g: c.games.get(l.g)! }));
    const vs = (x: { l: StatLine; g: Game }) => c.teamName(x.g.home === x.l.t ? x.g.away : x.g.home);
    const wk = (x: { g: Game }) => weekTitle(d, x.g.stage, x.g.week);
    const byMost = (f: (l: StatLine) => number) => log.reduce<(typeof log)[number] | null>((a, x) => (f(x.l) > (a ? f(a.l) : 0) ? x : a), null);
    const picks = byMost((l) => l.pint || 0);
    if (picks && (picks.l.pint || 0) >= 3) add("badint", ROAST, [
      `${who} threw **${picks.l.pint} interceptions** against ${vs(picks)} in ${wk(picks)}.`,
      `${wk(picks)}: ${who} vs ${vs(picks)}. **${picks.l.pint} picks.** He was throwing to the wrong colors all day.`,
      `${who} threw **${picks.l.pint} picks** against ${vs(picks)} in ${wk(picks)}. Floyd Mayweather would've read that coverage better.`,
    ]);
    const fum = byMost((l) => l.rfum || 0);
    if (fum && (fum.l.rfum || 0) >= 2) add("badfum", ROAST - 0.5, [
      `${who} fumbled **${fum.l.rfum} times** against ${vs(fum)} in ${wk(fum)}.`,
      `${who} put it on the turf **${fum.l.rfum} times** against ${vs(fum)} in ${wk(fum)}. Grease on the gloves?`,
    ]);
    const drops = byMost((l) => l.rcdrop || 0);
    if (drops && (drops.l.rcdrop || 0) >= 2) add("baddrop", ROAST - 0.5, [
      `${who} dropped **${drops.l.rcdrop} passes** against ${vs(drops)} in ${wk(drops)}.`,
      `${who} had **${drops.l.rcdrop} drops** against ${vs(drops)} in ${wk(drops)}. Ball hit him right in the hands. Twice.`,
    ]);
    if (g === "RB") {
      const dud = log.filter((x) => (x.l.ra || 0) >= 12).reduce<(typeof log)[number] | null>((a, x) => (!a || (x.l.ry || 0) / (x.l.ra || 1) < (a.l.ry || 0) / (a.l.ra || 1) ? x : a), null);
      if (dud && (dud.l.ry || 0) / (dud.l.ra || 1) < 2.5) add("dud", ROAST - 0.5, [
        `${who} carried it **${dud.l.ra} times for ${dud.l.ry} yards** against ${vs(dud)} in ${wk(dud)}.`,
        `${dud.l.ra} carries, ${dud.l.ry} yards: ${poss(who)} masterpiece against ${vs(dud)} in ${wk(dud)}.`,
      ]);
    }
    if (g === "WR" && t.gp >= 6) {
      const blanks = log.filter((x) => !(x.l.rc || 0)).length;
      if (blanks >= 3) add("blanks", ROAST - 1, [
        `${who} has had **${blanks} games with zero catches** this season.`,
        `${who} has been invisible in **${blanks} games** this season: zero catches. Is he even out there?`,
      ]);
    }
  }
  return out;
}
