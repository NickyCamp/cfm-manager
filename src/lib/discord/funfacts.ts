// /funfact player|team (Nick, 2026-11-13): turn this season's numbers into one fun, plain-English
// fact, e.g. "1 in every 23 passes Cam Ward throws gets picked off". Each template checks it has
// enough data, builds its sentence, and gets a weight; /funfact picks one at random by weight,
// so running it again usually gives a different fact. Regular season unless a fact says otherwise.
import { randomInt } from "node:crypto";
import { REG_SEASON_LAST_WEEK, inferredDeadCap, seasonTotals, weekTitle, type Totals } from "../league/derive";
import { projectPlayer } from "../league/projection";
import { teamStats, PAIRS } from "./matchup";
import type { Game, LeagueData, Player, StatLine, Team } from "../league/types";
import { RATING_KEYS, RATING_LABEL } from "../league/ratings";

export type Fact = { text: string; weight: number };

const n = (v: number) => Math.round(v).toLocaleString("en-US");
const every = (v: number) => (v >= 10 ? n(v) : v.toFixed(1).replace(/\.0$/, ""));
const money = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(v >= 1e7 ? 1 : 2)}M` : v >= 1e3 ? `$${n(v / 1e3)}K` : `$${n(v)}`);
const pct = (v: number) => `${Math.round(v)}%`;
const plural = (k: number, word: string, many = `${word}s`) => `${n(k)} ${k === 1 ? word : many}`;
/** "the Seahawks" → "the Seahawks'", "Ward" → "Ward's". */
const poss = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`);
const regGame = (g: Game | undefined) => Boolean(g && g.stage === 1 && g.week <= REG_SEASON_LAST_WEEK);

type Ctx = {
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

export function playerFacts(d: LeagueData, p: Player): Fact[] {
  const c = context(d);
  const t = c.totals.get(p.id);
  const who = p.last;
  const team = c.teamName(p.team);
  const g = GROUP[p.pos] || "";
  const out: Fact[] = [];
  const add = (weight: number, text: string) => out.push({ text, weight });

  if (t && t.gp) {
    // Passing
    if (t.pa >= 50 && t.pint > 0) {
      const qbs = [...c.totals.values()].filter((x) => x.pa >= 50);
      const leagueRate = qbs.reduce((a, x) => a + x.pa, 0) / Math.max(1, qbs.reduce((a, x) => a + x.pint, 0));
      const mine = t.pa / t.pint;
      add(3, `**1 in every ${every(mine)} passes** ${who} throws ends up in the other team's hands (${plural(t.pint, "INT")} on ${n(t.pa)} attempts). `
        + (mine < leagueRate * 0.85 ? `The league's QBs average 1 in ${every(leagueRate)}, so defenses are eating well.` : mine > leagueRate * 1.15 ? `The league's QBs average 1 in ${every(leagueRate)}, so he's protecting it better than most.` : `That's about league average (1 in ${every(leagueRate)}).`));
    }
    if (t.pa >= 50 && t.pint === 0) add(3, `${who} has thrown **${n(t.pa)} passes without a single interception**.`);
    if (t.ptd > 0 && t.pc >= 20) add(2, `Every **${every(t.pc / t.ptd)} completions**, one of ${poss(who)} passes goes for a touchdown (${plural(t.ptd, "TD")} this season).`);
    if (t.py >= 500) {
      const miles = (t.py * 3) / 5280;
      add(2, `${who} has thrown for **${n(t.py)} yards**. That's **${miles.toFixed(2)} miles** of football, or **${every(t.py / 100)} football fields** laid end to end.`);
    }
    if (t.psk > 0 && t.pa >= 50) add(1.5, `${who} gets sacked once every **${every((t.pa + t.psk) / t.psk)} dropbacks** (${plural(t.psk, "sack")} this season).`);
    // Rushing
    if (t.ra >= 20) {
      const ypc = t.ry / t.ra;
      if (ypc > 0) add(1.5, `${who} averages **${ypc.toFixed(1)} yards a carry**. At that pace it would take him **${every(100 / ypc)} straight carries** to go the length of the field.`);
      if (t.rfum > 0) add(2, `${who} puts the ball on the ground once every **${every((t.ra + t.rc) / t.rfum)} touches** (${plural(t.rfum, "fumble")}).`);
      if (t.rbt >= 3) add(2, `${who} breaks a tackle every **${every((t.ra + t.rc) / t.rbt)} touches** (${plural(t.rbt, "broken tackle")}).`);
    }
    // Receiving
    if (t.rc >= 10) {
      if (t.rcyac > 0 && t.rcy > 0) add(2, `**${pct((t.rcyac / t.rcy) * 100)} of ${poss(who)} receiving yards** came after the catch (${n(t.rcyac)} of ${n(t.rcy)}).`);
      if (t.rcdrop > 0) add(2, `${who} drops one pass for every **${every(t.rc / t.rcdrop)} he catches** (${plural(t.rcdrop, "drop")}).`);
      if (t.rclng >= 40) add(1, `${poss(who)} longest catch went **${t.rclng} yards**, ${pct(t.rclng)} of the field in one play.`);
    }
    // Defense
    if (t.sk >= 2) {
      const fewer = [...c.teamAgg.entries()].filter(([id, a]) => id !== p.team && a.sacksBy < t.sk).length;
      if (fewer > 0) add(3, `${who} has **${t.sk} sacks by himself**, more than **${plural(fewer, "entire team")}** have managed.`);
      else add(1.5, `${who} has a sack every **${every(t.gp / t.sk)} games** (${t.sk} in ${t.gp}).`);
    }
    if (t.int >= 2) {
      const fewer = [...c.teamAgg.entries()].filter(([id, a]) => id !== p.team && a.intsBy < t.int).length;
      if (fewer > 0) add(3, `${who} has **${plural(t.int, "interception")}**, more than **${plural(fewer, "whole defense")}** in the league.`);
    }
    if (t.tk >= 20) add(1, `${who} averages **${(t.tk / t.gp).toFixed(1)} tackles a game**, a tackle roughly every **${every(60 / (t.tk / t.gp))} minutes** of game clock.`);
    // Kicking / punting
    if (t.fga >= 5) add(1.5, `${who} has made **${pct((t.fgm / t.fga) * 100)} of his field goals** (${t.fgm}/${t.fga}), with a long of ${t.fglng}.`);
    if (t.pnt >= 15) add(1.5, `${who} has punted **${n(t.pnty)} yards** this season, **${(t.pnty * 3 / 5280).toFixed(2)} miles** of kicking the ball away.`);

    // Share of team points
    const a = c.teamAgg.get(t.team);
    const pts = 6 * (t.rtd + t.rctd + t.dtd) + 3 * t.fgm + t.xpm;
    if (a && a.pf > 0 && pts > 0) {
      const share = (pts / a.pf) * 100;
      if (share >= 10) add(2.5, `${who} has personally scored **${pct(share)} of ${poss(team)} points** (${n(pts)} of ${n(a.pf)}).`);
    }

    // Cost per stat
    const capHit = p.contract.capHit;
    const main = g === "QB" ? [t.py, "passing yard"] : g === "RB" ? [t.ry, "rushing yard"] : g === "WR" ? [t.rcy, "receiving yard"]
      : g === "DEF" ? [t.tk, "tackle"] : g === "K" ? [t.fgm, "field goal"] : g === "P" ? [t.pnt, "punt"] : null;
    if (p.team && capHit > 0 && main && (main[0] as number) > 0) {
      add(3, `${team.charAt(0).toUpperCase() + team.slice(1)} are paying ${who} about **${money(capHit / (main[0] as number))} per ${main[1]}** this season (${money(capHit)} cap hit).`);
    }

    // Best game and scoring streaks, from the game log
    const log = d.lines.filter((l) => l.p === p.id && regGame(c.games.get(l.g)))
      .map((l) => ({ l, g: c.games.get(l.g)! })).sort((x, y) => x.g.week - y.g.week);
    const metric = (l: StatLine) => (g === "QB" ? l.py || 0 : g === "RB" ? (l.ry || 0) + (l.rcy || 0) : g === "WR" ? l.rcy || 0 : g === "DEF" ? (l.tk || 0) + 5 * (l.sk || 0) + 8 * (l.int || 0) : 0);
    const best = log.length ? log.reduce((x, y) => (metric(y.l) > metric(x.l) ? y : x)) : null;
    if (best && metric(best.l) > 0) {
      const opp = best.g.home === best.l.t ? best.g.away : best.g.home;
      const l = best.l;
      const line = g === "QB" ? `${n(l.py || 0)} passing yards and ${plural(l.ptd || 0, "TD")}` : g === "RB" ? `${n((l.ry || 0) + (l.rcy || 0))} yards from scrimmage` : g === "WR" ? `${l.rc || 0} catches for ${n(l.rcy || 0)} yards` : `${l.tk || 0} tackles${l.sk ? `, ${l.sk} sacks` : ""}${l.int ? `, ${l.int} INT` : ""}`;
      add(1.5, `${poss(who)} best game this season: **${line}** against ${c.teamName(opp)} in ${weekTitle(d, best.g.stage, best.g.week)}.`);
    }
    let streak = 0, run = 0;
    for (const { l } of log) { const td = (l.ptd || 0) + (l.rtd || 0) + (l.rctd || 0) + (l.dtd || 0); run = td > 0 ? run + 1 : 0; streak = Math.max(streak, run); }
    if (streak >= 3) add(2, `${who} had a hand in a touchdown in **${streak} straight games** at one point this season.`);
  }

  // Not stat-based: ratings, age, contract
  if (p.ratings) {
    const rs = RATING_KEYS.map((k, i) => ({ k, v: p.ratings![i] ?? 0 })).filter((r) => r.k !== "injuryRating" && r.k !== "staminaRating" && r.k !== "confRating");
    const hi = rs.reduce((a, b) => (b.v > a.v ? b : a)), lo = rs.reduce((a, b) => (b.v < a.v ? b : a));
    add(1, `${poss(who)} best rating is **${RATING_LABEL[hi.k]} (${hi.v})**. His worst is **${RATING_LABEL[lo.k]} (${lo.v})**.`);
  }
  const older = d.players.filter((x) => !x.gone && x.team && x.age < p.age).length / Math.max(1, d.players.filter((x) => !x.gone && x.team).length);
  if (p.age >= 32) add(1.5, `At ${p.age}, ${who} is older than **${pct(older * 100)} of the league**.`);
  if (p.team && p.contract.capHit > 0) add(1, `${who} makes about **${money(p.contract.capHit / 17)} per game** against the cap this season.`);
  out.push(...playerRoasts(c, p, t));
  return out;
}

// ---------- teams ----------

export function teamFacts(d: LeagueData, team: Team): Fact[] {
  const c = context(d);
  const a = c.teamAgg.get(team.id);
  const name = `The ${team.name}`;
  const out: Fact[] = [];
  const add = (weight: number, text: string) => out.push({ text, weight });
  const rankOf = (f: (x: NonNullable<typeof a>) => number, high = true) => {
    const vals = [...c.teamAgg.values()].filter((x) => x.gp).map(f);
    const mine = f(a!);
    return 1 + vals.filter((v) => (high ? v > mine : v < mine)).length;
  };
  const ord = (k: number) => { const s = ["th", "st", "nd", "rd"], v = k % 100; return k + (s[(v - 20) % 10] || s[v] || s[0]); };

  if (a && a.gp) {
    const ppg = a.pf / a.gp;
    if (ppg > 0) add(2, `${name} score a point every **${(60 / ppg).toFixed(1)} minutes** of game clock (${ppg.toFixed(1)} a game, ${ord(rankOf((x) => x.pf / x.gp))} in the league).`);
    if (a.penYds >= 100) add(2, `${name} have been flagged **${a.pen} times for ${n(a.penYds)} yards**. That's **${every(a.penYds / 100)} football fields** of penalties.`);
    if (a.to > 0) {
      const q = (a.gp * 4) / a.to;
      add(1.5, `${name} give the ball away ${q < 1.15 ? "about **once a quarter**" : `once every **${every(q)} quarters**`} (${plural(a.to, "turnover")} in ${a.gp} games).`);
    }
    if (a.rz[1] >= 5) add(1.5, `${name} turn **${pct((a.rz[0] / a.rz[1]) * 100)}** of red zone trips into touchdowns (${a.rz[0]} of ${a.rz[1]}).`);
    if (a.fourth[1] >= 3) add(1.5, `${name} have gone for it on 4th down **${a.fourth[1]} times** and converted ${a.fourth[0]} (${pct((a.fourth[0] / a.fourth[1]) * 100)}).`);
    if (a.sacksBy > 0) add(1, `${name} have **${a.sacksBy} sacks**, ${ord(rankOf((x) => x.sacksBy))} in the league.`);
    const spent = team.cap.spent;
    if (spent > 0 && a.pf > 0) {
      const perPoint = (tt: Team) => { const x = c.teamAgg.get(tt.id); return x && x.pf ? tt.cap.spent / x.pf : Infinity; };
      const mine = perPoint(team);
      const cheaper = d.teams.filter((tt) => perPoint(tt) < mine).length;
      add(2.5, `${name} pay **${money(mine)} in cap for every point** they score. ${cheaper === 0 ? "Nobody in the league gets points cheaper." : cheaper <= 10 ? `Only ${plural(cheaper, "team")} get points cheaper.` : `${plural(cheaper, "team")} get their points cheaper.`}`);
    }
  }

  // Games: one-score record, biggest margins, home/away
  const gs = d.games.filter((g) => g.final && regGame(g) && (g.home === team.id || g.away === team.id));
  const res = gs.map((g) => { const home = g.home === team.id; const us = home ? g.hs : g.as, them = home ? g.as : g.hs; return { g, home, us, them, diff: us - them }; });
  const close = res.filter((r) => Math.abs(r.diff) <= 8);
  if (close.length >= 3) {
    const w = close.filter((r) => r.diff > 0).length, l = close.filter((r) => r.diff < 0).length;
    add(2, `${name} are **${w}-${l}${close.length - w - l ? `-${close.length - w - l}` : ""} in one-score games** (8 points or less).`);
  }
  if (res.length) {
    const big = res.reduce((x, y) => (y.diff > x.diff ? y : x)), worst = res.reduce((x, y) => (y.diff < x.diff ? y : x));
    if (big.diff >= 14) add(1.5, `${poss(name)} biggest win: **${big.us}-${big.them}** over ${c.teamName(big.home ? big.g.away : big.g.home)} in ${weekTitle(d, big.g.stage, big.g.week)}.`);
    if (worst.diff <= -14) add(1.5, `${poss(name)} worst loss: **${worst.them}-${worst.us}** to ${c.teamName(worst.home ? worst.g.away : worst.g.home)} in ${weekTitle(d, worst.g.stage, worst.g.week)}.`);
    const hw = res.filter((r) => r.home && r.diff > 0).length, hl = res.filter((r) => r.home && r.diff < 0).length;
    const aw = res.filter((r) => !r.home && r.diff > 0).length, al = res.filter((r) => !r.home && r.diff < 0).length;
    if (Math.abs((hw - hl) - (aw - al)) >= 4) add(2, `${name} are **${hw}-${hl} at home** but **${aw}-${al} on the road**.`);
  }

  // Roster and cap
  const roster = d.players.filter((p) => !p.gone && p.team === team.id && !p.ps);
  if (roster.length >= 10) {
    const hits = roster.map((p) => ({ p, hit: p.contract.capHit })).filter((x) => x.hit > 0).sort((x, y) => y.hit - x.hit);
    if (hits.length > 10) {
      const top = hits[0];
      let sum = 0, k = 0;
      for (let i = hits.length - 1; i > 0 && sum + hits[i].hit <= top.hit; i--) { sum += hits[i].hit; k++; }
      if (k >= 5) add(2.5, `${poss(`${top.p.first} ${top.p.last}`)} ${money(top.hit)} cap hit is more than the **${k} cheapest ${team.name} combined**.`);
    }
    const avgAge = roster.reduce((s, p) => s + p.age, 0) / roster.length;
    const oldest = roster.reduce((x, y) => (y.age > x.age ? y : x));
    add(1, `${poss(name)} active roster averages **${avgAge.toFixed(1)} years old**. ${oldest.first} ${oldest.last} is the oldest at ${oldest.age}.`);
    const xf = roster.filter((p) => p.dev === 3).length;
    if (xf) {
      const counts = d.teams.map((tt) => d.players.filter((p) => !p.gone && p.team === tt.id && !p.ps && p.dev === 3).length);
      const fewer = counts.filter((v) => v < xf).length;
      add(1.5, `${name} have **${plural(xf, "X-Factor")}**, more than ${plural(fewer, "team")} in the league.`);
    }
  }
  if (Math.abs(team.rec.streak) >= 3) {
    // EA stores the streak as + wins / − losses (derive's streakText).
    add(1, team.rec.streak > 0 ? `${name} have won **${team.rec.streak} straight**.` : `${name} have lost **${-team.rec.streak} straight**.`);
  }
  out.push(...teamRoasts(c, team));
  return out;
}

/** One fact, picked at random by weight. */
export function pickFact(facts: Fact[]): Fact | null {
  if (!facts.length) return null;
  const total = facts.reduce((s, f) => s + f.weight, 0);
  let r = (randomInt(1_000_000) / 1_000_000) * total;
  for (const f of facts) { r -= f.weight; if (r <= 0) return f; }
  return facts[facts.length - 1];
}

// ---------- roasts: the embarrassing side (Nick, 2026-11-13: "more embarrassing than impressive,
// players making big money who do nothing"). Weighted higher so they come up most of the time. ----------

const ROAST = 4.5;
const ord = (k: number) => { const s = ["th", "st", "nd", "rd"], v = k % 100; return k + (s[(v - 20) % 10] || s[v] || s[0]); };
/** "the most" / "the 3rd-most", "the highest" / "the 4th-highest". */
const nth = (k: number, word: string) => (k === 1 ? `the ${word}` : `the ${ord(k)}-${word}`);
const GROUP_NAME: Record<string, string> = { QB: "quarterbacks", RB: "running backs", WR: "receivers", DEF: "defenders", K: "kickers", P: "punters" };
/** What a position group is paid to produce, for "overpaid" facts. */
function production(g: string, t: Totals | undefined): { v: number; label: string; unit: string } | null {
  const x = t || ({} as Totals);
  if (g === "QB") return { v: x.py || 0, label: "passing yards", unit: "passing yard" };
  if (g === "RB") return { v: (x.ry || 0) + (x.rcy || 0), label: "yards from scrimmage", unit: "yard" };
  if (g === "WR") return { v: x.rcy || 0, label: "receiving yards", unit: "receiving yard" };
  if (g === "DEF") return { v: (x.tk || 0) + 4 * (x.sk || 0) + 6 * (x.int || 0) + 2 * (x.pd || 0) + 4 * (x.ff || 0), label: "defensive production (tackles, sacks, picks, PDs)", unit: "" };
  if (g === "K") return { v: x.fgm || 0, label: "field goals made", unit: "field goal" };
  return null;
}

function playerRoasts(c: Ctx, p: Player, t: (Totals & { team: number }) | undefined): Fact[] {
  const { d } = c;
  const out: Fact[] = [];
  const add = (weight: number, text: string) => out.push({ text, weight });
  const who = p.last;
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
      add(ROAST + 1, `${who} has a **${money(cap)} cap hit** and hasn't recorded **a single stat** this season${why}.`);
      overpaid = true;
    } else if (peers.length >= 10 && capRank <= Math.ceil(peers.length * 0.15) && prodRank > peers.length / 2) {
      overpaid = true;
      add(ROAST + 1, `${who} has the **${ord(capRank)}-biggest cap hit among ${GROUP_NAME[g]}** (${money(cap)}) and ranks **${ord(prodRank)} of ${peers.length}** in ${prod.label}.`
        + (prod.unit && prod.v > 0 ? ` That's **${money(cap / prod.v)} per ${prod.unit}**.` : ""));
    }
  }
  // Paid like a star, rated like a backup.
  if (p.team && cap >= 15e6 && p.ovr < 78) add(ROAST, `${Team} are paying ${who} **${money(cap)}** this season. He's a **${p.ovr} overall**.`);
  // Stuck with him: big dead money if cut. Only when that's actually a problem (he isn't
  // producing, isn't very good, or is getting old); for a healthy star it's just how deals work.
  const c2 = p.contract;
  if (p.team && c2.releasePenalty >= 8e6 && c2.releasePenalty > c2.releaseSavings * 2 && (overpaid || p.ovr < 82 || p.age >= 31)) {
    const ends = d.season.year + Math.max(0, c2.yearsLeft - 1);
    add(ROAST - 1, `Cutting ${who} would leave **${money(c2.releasePenalty)} of dead money** and save only ${money(c2.releaseSavings)}, so ${team} are stuck with him through ${ends}.`);
  }
  // Old and signed for years.
  if (p.team && p.age >= 31 && c2.yearsLeft >= 3) {
    const pr = projectPlayer(p, d.season.year);
    const lastYear = Math.max(...Object.keys(pr.hits).map(Number));
    const lastHit = pr.hits[lastYear];
    add(ROAST - 0.5, `${who} is **${p.age}** and signed for **${c2.yearsLeft} more seasons**. He'll be ${p.age + c2.yearsLeft - 1} when the deal ends${lastHit ? `, still costing about ${money(lastHit)} that year` : ""}.`);
  }

  if (t && t.gp) {
    // QB: more picks than TDs; leading the league in bad stuff.
    if (t.pa >= 50 && t.pint > t.ptd) add(ROAST + 1, `${who} has thrown **more interceptions (${t.pint}) than touchdowns (${t.ptd})**.`);
    const worst = (v: (x: Totals) => number, what: string, min: (x: Totals) => boolean, w = ROAST) => {
      const mine = v(t);
      if (mine <= 0 || !min(t)) return;
      const rank = 1 + [...c.totals.values()].filter((x) => min(x) && v(x) > mine).length;
      if (rank <= 3) add(w, `${who} has **${nth(rank, "most")} ${what}** in the league (${mine}).`);
    };
    worst((x) => x.pint, "interceptions thrown", (x) => x.pa > 0);
    worst((x) => x.psk, "sacks taken", (x) => x.pa > 0, ROAST - 1);
    worst((x) => x.rfum, "fumbles", () => true);
    worst((x) => x.rcdrop, "dropped passes", () => true);
    // Low yards per carry.
    if (t.ra >= 40 && t.ry / t.ra < 3.8) add(ROAST - 0.5, `${who} averages **${(t.ry / t.ra).toFixed(1)} yards a carry** on ${t.ra} carries. A QB sneak gets about that.`);
    // Kicker misses.
    const missed = (t.fga - t.fgm) * 3 + (t.xpa - t.xpm);
    if (t.fga - t.fgm >= 3 || t.xpa - t.xpm >= 3) add(ROAST, `${who} has missed **${plural(t.fga - t.fgm, "field goal")}** and **${plural(t.xpa - t.xpm, "extra point")}**, leaving **${missed} points** on the field.`);
    // Expensive defenders with nothing to show.
    if (g === "DEF" && cap >= 10e6) {
      const edge = ["LEDG", "REDG", "LE", "RE", "DT"].includes(p.pos), db = ["CB", "FS", "SS"].includes(p.pos);
      if (edge && t.sk <= 2 && t.gp >= 6) add(ROAST + 0.5, `${Team} pay ${who} **${money(cap)}** to rush the passer. He has **${t.sk === 0 ? "zero sacks" : plural(t.sk, "sack")}** in ${t.gp} games.`);
      if (db && t.int === 0 && t.gp >= 6) add(ROAST + 0.5, `${who} is a **${money(cap)}** defensive back with **zero interceptions** in ${t.gp} games.`);
    }

    // Ugliest game.
    const log = d.lines.filter((l) => l.p === p.id && regGame(c.games.get(l.g))).map((l) => ({ l, g: c.games.get(l.g)! }));
    const vs = (x: { l: StatLine; g: Game }) => c.teamName(x.g.home === x.l.t ? x.g.away : x.g.home);
    const wk = (x: { g: Game }) => weekTitle(d, x.g.stage, x.g.week);
    const byMost = (f: (l: StatLine) => number) => log.reduce<(typeof log)[number] | null>((a, x) => (f(x.l) > (a ? f(a.l) : 0) ? x : a), null);
    const picks = byMost((l) => l.pint || 0);
    if (picks && (picks.l.pint || 0) >= 3) add(ROAST, `${who} threw **${picks.l.pint} interceptions** against ${vs(picks)} in ${wk(picks)}.`);
    const fum = byMost((l) => l.rfum || 0);
    if (fum && (fum.l.rfum || 0) >= 2) add(ROAST - 0.5, `${who} fumbled **${fum.l.rfum} times** against ${vs(fum)} in ${wk(fum)}.`);
    const drops = byMost((l) => l.rcdrop || 0);
    if (drops && (drops.l.rcdrop || 0) >= 2) add(ROAST - 0.5, `${who} dropped **${drops.l.rcdrop} passes** against ${vs(drops)} in ${wk(drops)}.`);
    if (g === "RB") {
      const dud = log.filter((x) => (x.l.ra || 0) >= 12).reduce<(typeof log)[number] | null>((a, x) => (!a || (x.l.ry || 0) / (x.l.ra || 1) < (a.l.ry || 0) / (a.l.ra || 1) ? x : a), null);
      if (dud && (dud.l.ry || 0) / (dud.l.ra || 1) < 2.5) add(ROAST - 0.5, `${who} carried it **${dud.l.ra} times for ${dud.l.ry} yards** against ${vs(dud)} in ${wk(dud)}.`);
    }
    if (g === "WR" && t.gp >= 6) {
      const blanks = log.filter((x) => !(x.l.rc || 0)).length;
      if (blanks >= 3) add(ROAST - 1, `${who} has had **${blanks} games with zero catches** this season.`);
    }
  }
  return out;
}

function teamRoasts(c: Ctx, team: Team): Fact[] {
  const { d } = c;
  const out: Fact[] = [];
  const add = (weight: number, text: string) => out.push({ text, weight });
  const name = `The ${team.name}`;
  const a = c.teamAgg.get(team.id);
  const roster = d.players.filter((p) => !p.gone && p.team === team.id);

  const dead = inferredDeadCap(team, roster);
  if (dead >= 5e6) add(ROAST, `${name} are carrying **${money(dead)} in dead money**: cap space spent on players who aren't on the team anymore.`);
  const ir = roster.filter((p) => p.ir).reduce((s, p) => s + p.contract.capHit, 0);
  if (ir >= 5e6) add(ROAST - 0.5, `${name} are paying **${money(ir)}** this season to players sitting on IR.`);

  if (a && a.gp) {
    const w = team.rec.w, l = team.rec.l;
    const payRank = 1 + d.teams.filter((x) => x.cap.spent > team.cap.spent).length;
    if (payRank <= 10 && w < l) add(ROAST + 1, `${name} have **${nth(payRank, "highest")} payroll** in the league (${money(team.cap.spent)}) and a **${w}-${l}** record.`);
    const diff = a.take - a.to;
    if (diff <= -5) add(ROAST, `${name} have given the ball away **${a.to} times** and taken it away only **${a.take}**. That's a **${diff}** turnover margin.`);
    const res = d.games.filter((g) => g.final && regGame(g) && (g.home === team.id || g.away === team.id)).map((g) => {
      const home = g.home === team.id; return { us: home ? g.hs : g.as, them: home ? g.as : g.hs };
    });
    const blowouts = res.filter((r) => r.them - r.us >= 20).length;
    if (blowouts >= 2) add(ROAST, `${name} have lost by **20 or more points ${blowouts} times** this season.`);
    const lowScoring = res.filter((r) => r.us < 14).length;
    if (lowScoring >= 3) add(ROAST - 0.5, `${name} have been held under 14 points **${lowScoring} times**.`);
    const failed = a.fourth[1] - a.fourth[0];
    if (failed >= 10) add(ROAST - 1, `${name} have come up short on 4th down **${failed} times** this season.`);
    const allowRank = 1 + [...c.teamAgg.values()].filter((x) => x.gp && x.pa / x.gp > a.pa / a.gp).length;
    if (allowRank <= 5) add(ROAST - 0.5, `${name} give up a point every **${(60 / (a.pa / a.gp)).toFixed(1)} minutes** (${(a.pa / a.gp).toFixed(1)} a game, ${nth(allowRank, "most")} in the league).`);
  }

  // Their worst unit, by league rank.
  const ts = teamStats(d).get(team.id);
  if (ts) {
    let worst: { rank: number; text: string } | null = null;
    const label: Record<string, string> = { pts: "scoring offense", yds: "total offense", pass: "passing offense", rush: "rushing offense", pa: "scoring defense", ydsA: "total defense", passA: "pass defense", rushA: "run defense" };
    for (const [o, dk] of PAIRS) {
      for (const k of [o, dk]) {
        if (!label[k]) continue;
        const r = ts.rank[k];
        if (!worst || r > worst.rank) worst = { rank: r, text: `${name} rank **${ord(r)} in ${label[k]}** (${ts.v[k].toFixed(1)} ${k.endsWith("A") || k === "pa" ? "allowed" : ""} a game).`.replace("  ", " ") };
      }
    }
    if (worst && worst.rank >= d.teams.length - 3) add(ROAST, worst.text);
  }
  return out;
}
