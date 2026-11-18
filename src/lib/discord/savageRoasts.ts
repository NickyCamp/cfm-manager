// /funfact: single-game disasters, written as crime reports (Nick, 2026-11-18: "add some more, don't
// be afraid to be even more violent with them"). Uses the per-game team box (teamGames) and player
// lines, regular season only. Each finds the worst game of its kind.
import { REG_SEASON_LAST_WEEK, weekTitle } from "../league/derive";
import type { Game, LeagueData, Player, StatLine, Team } from "../league/types";
import { n, pick, plural, poss, tail, type Fact } from "./factFormat";

const W = 4.5;
const regGame = (g: Game | undefined) => Boolean(g && g.stage === 1 && g.week <= REG_SEASON_LAST_WEEK);

export function savageTeamRoasts(d: LeagueData, team: Team): Fact[] {
  const out: Fact[] = [];
  const add = (key: string, weight: number, variants: string[]) => out.push({ key: `t:${key}`, weight, text: tail(pick(variants)) });
  const The = `The ${team.name}`, the = `the ${team.name}`;
  const games = new Map(d.games.filter((g) => g.final && regGame(g)).map((g) => [g.id, g]));
  const names = new Map(d.teams.map((t) => [t.id, t.name]));
  // Our box and the opponent's box for each game.
  const mine = d.teamGames.filter((x) => x.t === team.id && games.has(x.g));
  const rows = mine.map((me) => {
    const g = games.get(me.g)!;
    const oppId = g.home === team.id ? g.away : g.home;
    const op = d.teamGames.find((x) => x.g === me.g && x.t === oppId);
    const us = g.home === team.id ? g.hs : g.as, them = g.home === team.id ? g.as : g.hs;
    return { me, op, g, opp: `the ${names.get(oppId) ?? "other guys"}`, us, them, wk: weekTitle(d, g.stage, g.week) };
  });
  const worst = <T,>(xs: T[], f: (x: T) => number) => xs.reduce<T | null>((a, x) => (f(x) > (a ? f(a) : -Infinity) ? x : a), null);

  const to = worst(rows, (r) => r.me.turnovers);
  if (to && to.me.turnovers >= 4) add("g_turnovers", W, [
    `${The} turned it over **${to.me.turnovers} times** against ${to.opp} in ${to.wk}. That's not football, that's a robbery where the victim hands over the wallet.`,
    `${to.wk}: ${the} coughed it up **${to.me.turnovers} times** to ${to.opp}. Somebody check the QB for a pulse.`,
    `**${to.me.turnovers} turnovers** in one game (${to.wk}, vs ${to.opp}). ${The} were basically playing defense for the other team.`,
  ]);
  const sk = worst(rows.filter((r) => r.op), (r) => r.op!.sacks);
  if (sk && sk.op!.sacks >= 6) add("g_sacked", W, [
    `${poss(The)} QB got sacked **${sk.op!.sacks} times** by ${sk.opp} in ${sk.wk}. That's assault. Somebody file charges.`,
    `${sk.wk}: ${sk.opp} put ${poss(the)} QB in the dirt **${sk.op!.sacks} times**. The O-line just watched it happen.`,
    `**${sk.op!.sacks} sacks allowed** to ${sk.opp} in ${sk.wk}. ${poss(The)} quarterback needs a lawyer and a chiropractor.`,
  ]);
  const ra = worst(rows.filter((r) => r.op), (r) => r.op!.rushYds);
  if (ra && ra.op!.rushYds >= 220) add("g_rushallowed", W, [
    `${ra.opp} ran for **${n(ra.op!.rushYds)} yards** on ${the} in ${ra.wk}. They were stepping over bodies the whole game.`,
    `${ra.wk}: ${poss(The)} run defense gave up **${n(ra.op!.rushYds)} rushing yards** to ${ra.opp}. They got trampled like a stampede victim.`,
  ]);
  const ya = worst(rows.filter((r) => r.op), (r) => r.op!.yds);
  if (ya && ya.op!.yds >= 500) add("g_ydsallowed", W, [
    `${ya.opp} racked up **${n(ya.op!.yds)} yards** on ${the} in ${ya.wk}. The defense was found face down at midfield.`,
    `**${n(ya.op!.yds)} yards allowed** in one game (${ya.wk}, ${ya.opp}). Leave the defense where it fell.`,
  ]);
  const lo = worst(rows, (r) => -r.me.yds);
  if (lo && lo.me.yds <= 200) add("g_noyards", W, [
    `${The} gained **${n(lo.me.yds)} total yards** against ${lo.opp} in ${lo.wk}. The offense was pronounced dead at the scene.`,
    `${lo.wk}: **${n(lo.me.yds)} yards** of offense against ${lo.opp}. You could fit ${poss(the)} whole game in a highlight reel of nothing.`,
  ]);
  const pen = worst(rows, (r) => r.me.penalties);
  if (pen && pen.me.penalties >= 11) add("g_flags", W - 0.5, [
    `${The} got flagged **${pen.me.penalties} times for ${pen.me.penaltyYds} yards** against ${pen.opp} in ${pen.wk}. Lock the whole team up.`,
    `${pen.wk}: **${pen.me.penalties} penalties** vs ${pen.opp}. ${The} have a rap sheet longer than the playbook.`,
  ]);
  const third = worst(rows.filter((r) => r.me.third[1] >= 10), (r) => -r.me.third[0] / r.me.third[1]);
  if (third && third.me.third[0] / third.me.third[1] <= 0.15) add("g_third", W - 0.5, [
    `${The} went **${third.me.third[0]}-for-${third.me.third[1]} on 3rd down** against ${third.opp} in ${third.wk}. The punter was the MVP.`,
    `${third.wk}: ${third.me.third[0]} of ${third.me.third[1]} on 3rd down vs ${third.opp}. Every drive was a hostage situation that ended badly.`,
  ]);
  const big = rows.filter((r) => r.them >= 30).length;
  if (big >= 3) add("g_30s", W, [
    `${The} have given up 30+ points **${plural(big, "time")}**. That defense has a body count.`,
    `${big} games of 30+ allowed. ${poss(The)} defense is less a unit and more a crime scene with jerseys.`,
  ]);
  const dud = rows.filter((r) => r.us < 10).length;
  if (dud >= 3) add("g_under10", W, [
    `${The} have scored under 10 points **${plural(dud, "time")}**. The offense is in a coma and the family is discussing options.`,
    `Single digits ${plural(dud, "time")} this season. ${poss(The)} offense should be put out of its misery.`,
  ]);
  return out;
}

export function savagePlayerRoasts(d: LeagueData, p: Player): Fact[] {
  const out: Fact[] = [];
  const add = (key: string, weight: number, variants: string[]) => out.push({ key: `p:${key}`, weight, text: tail(pick(variants)) });
  const who = p.last;
  const games = new Map(d.games.filter((g) => g.final && regGame(g)).map((g) => [g.id, g]));
  const names = new Map(d.teams.map((t) => [t.id, t.name]));
  const log = d.lines.filter((l) => l.p === p.id && games.has(l.g)).map((l) => {
    const g = games.get(l.g)!;
    return { l, opp: `the ${names.get(g.home === l.t ? g.away : g.home) ?? "other guys"}`, wk: weekTitle(d, g.stage, g.week) };
  });
  const worst = (f: (l: StatLine) => number) => log.reduce<(typeof log)[number] | null>((a, x) => (f(x.l) > (a ? f(a.l) : -Infinity) ? x : a), null);

  const sk = worst((l) => l.psk || 0);
  if (sk && (sk.l.psk || 0) >= 6) add("g_sacked", W, [
    `${who} got sacked **${sk.l.psk} times** by ${sk.opp} in ${sk.wk}. That wasn't a game, that was a mugging.`,
    `${sk.wk}: ${sk.opp} buried ${who} **${sk.l.psk} times**. They should've drawn a chalk outline around him.`,
  ]);
  const cmp = worst((l) => ((l.pa || 0) >= 20 ? -(l.pc || 0) / (l.pa || 1) : -Infinity));
  if (cmp && (cmp.l.pa || 0) >= 20 && (cmp.l.pc || 0) / (cmp.l.pa || 1) < 0.45) add("g_comp", W, [
    `${who} went **${cmp.l.pc}-for-${cmp.l.pa}** against ${cmp.opp} in ${cmp.wk}. He was throwing at the receivers like he wanted to kill them.`,
    `${cmp.wk}: ${who}, ${cmp.l.pc} of ${cmp.l.pa}. Most of those passes are still missing. Search parties have been sent.`,
  ]);
  const zeroTd = log.filter((x) => (x.l.pa || 0) >= 15 && !(x.l.ptd || 0) && (x.l.pint || 0) >= 2).length;
  if (zeroTd >= 2) add("g_notd", W, [
    `${who} has **${plural(zeroTd, "game")}** with no TDs and 2+ picks. Every one of them should be investigated as a crime.`,
    `${zeroTd} games of zero touchdowns and multiple picks for ${who}. The offense dies a slow death every time he drops back.`,
  ]);
  const fg = worst((l) => (l.fga || 0) - (l.fgm || 0));
  if (fg && (fg.l.fga || 0) - (fg.l.fgm || 0) >= 2) add("g_fgmiss", W, [
    `${who} missed **${(fg.l.fga || 0) - (fg.l.fgm || 0)} field goals** against ${fg.opp} in ${fg.wk}. The holder should've just stabbed the ball.`,
    `${fg.wk}: ${who} went ${fg.l.fgm}-for-${fg.l.fga} on kicks vs ${fg.opp}. Exile him to the practice field forever.`,
  ]);
  const zip = log.filter((x) => (x.l.ra || 0) >= 10 && (x.l.ry || 0) <= 15).length;
  if (zip >= 2) add("g_stuffed", W - 0.5, [
    `${who} has been held to 15 yards or less on 10+ carries **${plural(zip, "time")}**. Defenses aren't tackling him, they're burying him.`,
  ]);
  return out;
}

