// /funfact: roasts aimed at the person holding the controller (Nick, 2026-11-18: "a lot of these are
// the same rotating with different quips, I want the facts to be more violent against the user making
// fun of them"). Only for teams a person runs. Each is its own fact built from what that user actually
// did: in Madden the user throws the picks, takes the sacks, calls the 4th downs and signs the contracts.
import { REG_SEASON_LAST_WEEK, inferredDeadCap, weekTitle, type Totals } from "../league/derive";
import type { Game, Player, Team } from "../league/types";
import { esc, money, ord, pct, pick, plural, type Fact } from "./factFormat";
import type { RoastCtx } from "./teamRoasts";

const W = 5; // above the other roasts (3.5–5.5) so these come up a lot
const regGame = (g: Game | undefined) => Boolean(g && g.stage === 1 && g.week <= REG_SEASON_LAST_WEEK);
const userOf = (t: Team | undefined) => (t?.user ? esc(t.user) : "");

/** Closers aimed at the user, not the team. */
const AT_USER = [
  "His PS5 should be seized as evidence.", "His controller has filed for a restraining order.",
  "His thumbs should be tried at The Hague.", "Somebody unplug his console before he hurts anyone else.",
  "Revoke his EA account.", "He should be legally barred from holding a controller.",
  "His Madden license has been suspended indefinitely.", "Throw the controller in a river and him after it.",
  "The franchise should press charges.", "Ban him from the group chat until further notice.",
  "His teammates are drafting a petition to have him removed as coach.", "Every fan in that stadium wants a refund and an apology.",
  "Rookie difficulty has a waiting list and he's on it.", "Uninstall Madden, then uninstall yourself from the league.",
];
// The fact already names him, so the closer stays "His…"/"He…".
const jab = (_u: string, text: string) => `${text} ${pick(AT_USER)}`;

export function userTeamRoasts(c: RoastCtx, team: Team): Fact[] {
  const u = userOf(team);
  if (!u) return [];
  const { d } = c;
  const out: Fact[] = [];
  const add = (key: string, weight: number, variants: string[]) => out.push({ key: `u:${key}`, weight, text: jab(u, pick(variants)) });
  const byId = new Map(d.teams.map((t) => [t.id, t]));
  const a = c.teamAgg.get(team.id);
  const rec = `${team.rec.w}-${team.rec.l}${team.rec.t ? `-${team.rec.t}` : ""}`;
  const res = d.games.filter((g) => g.final && regGame(g) && g.home && g.away && (g.home === team.id || g.away === team.id)).map((g) => {
    const home = g.home === team.id;
    return { g, opp: home ? g.away : g.home, us: home ? g.hs : g.as, them: home ? g.as : g.hs };
  });
  const roster = d.players.filter((p) => !p.gone && p.team === team.id);
  const mine = [...c.totals.entries()].filter(([, t]) => t.team === team.id);
  const sum = (f: (t: Totals) => number) => mine.reduce((s, [, t]) => s + f(t), 0);

  // Real people vs the CPU.
  const vsUser = res.filter((r) => byId.get(r.opp)?.user), vsCpu = res.filter((r) => byId.get(r.opp) && !byId.get(r.opp)!.user);
  const uw = vsUser.filter((r) => r.us > r.them).length, ul = vsUser.filter((r) => r.us < r.them).length;
  const cw = vsCpu.filter((r) => r.us > r.them).length, cl = vsCpu.filter((r) => r.us < r.them).length;
  if (vsUser.length >= 3 && ul > uw) add("vsusers", W + 1, [
    `${u} is **${uw}-${ul} against actual human beings**${vsCpu.length ? ` and ${cw}-${cl} against the CPU` : ""}. Put him in front of a real person and he crumbles.`,
    `Against other users, ${u} is **${uw}-${ul}**. Every manager in this league has his number saved as "free win".`,
    `${u} only looks competent when the other side is a robot: **${uw}-${ul}** vs real people.`,
  ]);
  // The worst beating another user gave him.
  const beat = vsUser.filter((r) => r.them - r.us >= 14).sort((x, y) => (y.them - y.us) - (x.them - x.us))[0];
  if (beat) {
    const ou = userOf(byId.get(beat.opp)), wk = weekTitle(d, beat.g.stage, beat.g.week);
    add("beatdown", W + 1, [
      `${ou} beat ${u} **${beat.them}-${beat.us}** in ${wk}. ${u} has not emotionally recovered.`,
      `${wk}: ${ou} took ${poss2(u)} lunch money, ${beat.them}-${beat.us}. Then he took the lunch.`,
      `${ou} put up **${beat.them}** on ${u} in ${wk}. That wasn't a game, it was a public flogging with the whole league watching.`,
    ]);
  }
  // Swept by another user.
  {
    const by = new Map<number, typeof res>();
    for (const r of vsUser) { if (!by.has(r.opp)) by.set(r.opp, []); by.get(r.opp)!.push(r); }
    const own = [...by.entries()].find(([, rs]) => rs.length >= 2 && rs.every((r) => r.us < r.them));
    if (own) add("owned", W + 1, [
      `${userOf(byId.get(own[0]))} is **${own[1].length}-0 against ${u}** this season. ${u} should start paying him rent.`,
      `${userOf(byId.get(own[0]))} owns ${u}. ${own[1].length} games, ${own[1].length} beatings. It's not a rivalry, it's a hostage situation.`,
    ]);
  }
  // Played vs simmed.
  const played = res.filter((r) => r.g.simmed === false), simmed = res.filter((r) => r.g.simmed === true);
  if (played.length >= 3 && simmed.length >= 2) {
    const pw = played.filter((r) => r.us > r.them).length, sw = simmed.filter((r) => r.us > r.them).length;
    if (sw / simmed.length - pw / played.length >= 0.25) add("simbetter", W + 1.5, [
      `${u} is **${sw}-${simmed.length - sw} when the game is simmed** and **${pw}-${played.length - pw} when he actually plays**. The CPU is a better coach than him. Literally.`,
      `The sim engine wins ${pct((sw / simmed.length) * 100)} of ${poss2(u)} games. ${u} wins ${pct((pw / played.length) * 100)}. Let the computer take it from here.`,
    ]);
  }
  if (simmed.length >= 4) add("simmer", W - 0.5, [
    `${u} has had **${plural(simmed.length, "game")} simmed** this season. Too scared to pick up the controller.`,
    `${simmed.length} simmed games for ${u}. He schedules his games like he schedules his dentist appointments: never.`,
  ]);
  // The user throws the picks and takes the sacks.
  const ints = sum((t) => t.pint), sacks = sum((t) => t.psk), tds = sum((t) => t.ptd);
  const intRank = 1 + d.teams.filter((t) => [...c.totals.values()].filter((x) => x.team === t.id).reduce((s, x) => s + x.pint, 0) > ints).length;
  if (ints >= 8 && intRank <= 8) add("picks", W + 0.5, [
    `Let's be honest: the QB isn't throwing those **${ints} interceptions**. ${u} is. ${ord(intRank)}-most in the league.`,
    `${u} has personally thrown **${ints} picks** this season${tds ? ` (and ${tds} TDs)` : ""}. His thumbs are a danger to the public.`,
    `${ints} interceptions. ${u} reads coverage like he's never seen a football before.`,
  ]);
  if (sacks >= 25) add("sacks", W, [
    `${u} has held the ball long enough to get sacked **${sacks} times**. Press a button, man. Any button.`,
    `**${sacks} sacks taken**. ${u} treats the pocket like a hot tub and sits in it until he gets murdered.`,
  ]);
  if (a?.gp) {
    const failed = a.fourth[1] - a.fourth[0];
    if (a.fourth[1] >= 6 && a.fourth[0] / a.fourth[1] <= 0.4) add("fourth", W, [
      `${u} has gone for it on 4th down **${a.fourth[1]} times** and failed **${failed}**. Every time, he thought it was a good idea.`,
      `${u} coaches 4th down like he's on a parlay: ${a.fourth[0]} for ${a.fourth[1]}.`,
    ]);
    if (a.pa / a.gp >= 26) add("defense", W, [
      `${u} gives up **${(a.pa / a.gp).toFixed(1)} points a game**. He's user-ing the wrong guy every single snap.`,
      `${(a.pa / a.gp).toFixed(1)} points allowed a game. ${u} plays defense like he's trying to help the other team.`,
    ]);
    if (a.pf / a.gp <= 17) add("offense", W, [
      `${u} averages **${(a.pf / a.gp).toFixed(1)} points a game**. He's had the whole playbook all season and found nothing in it.`,
      `${(a.pf / a.gp).toFixed(1)} points a game. ${u} calls plays like he's blindfolded and throwing darts.`,
    ]);
    const rzPct = a.rz[1] ? a.rz[0] / a.rz[1] : 1;
    if (a.rz[1] >= 10 && rzPct < 0.5) add("redzone", W - 0.5, [
      `${u} scores a TD on **${pct(rzPct * 100)} of red zone trips**. He gets to the 20 and his brain blue-screens.`,
    ]);
    if (a.pen >= a.gp * 7) add("flags", W - 0.5, [
      `${u} has **${a.pen} penalties**. He can't even control his own players, let alone the game.`,
    ]);
  }
  // Close losses.
  const close = res.filter((r) => r.us < r.them && r.them - r.us <= 7).length;
  if (close >= 3) add("choke", W, [
    `${u} has lost **${close} games by a touchdown or less**. Clutch gene surgically removed.`,
    `${close} one-score losses. ${u} folds in crunch time like a lawn chair in a hurricane.`,
  ]);
  // Contracts he signed.
  const dead = inferredDeadCap(team, roster);
  if (dead >= 15e6) add("deadcap", W, [
    `${u} is paying **${money(dead)} in dead money**. He signs contracts like he's drunk at a casino.`,
    `**${money(dead)}** of ${poss2(u)} cap is for guys who aren't there. Somebody take his checkbook away.`,
  ]);
  const old = roster.filter((p) => !p.ps && p.age >= 31 && p.contract.yearsLeft >= 2 && p.contract.capHit >= 8e6);
  if (old.length >= 2) add("oldmoney", W - 0.5, [
    `${u} has **${old.length} players 31+** on multi-year deals worth $8M+. He shops for players at the retirement home.`,
  ]);
  const busts = roster.filter((p) => p.draft.round === 1 && p.yearsPro >= 2 && p.ovr < 75).length;
  if (busts >= 2) add("busts", W - 0.5, [
    `${u} has **${busts} first-round picks under 75 OVR** on his roster. He drafts like he's picking names out of a hat.`,
  ]);
  // Talent vs record.
  const ovrRank = 1 + d.teams.filter((t) => t.ovr > team.ovr).length;
  const recRank = 1 + d.teams.filter((t) => t.rec.w - t.rec.l > team.rec.w - team.rec.l).length;
  if (ovrRank <= 10 && recRank - ovrRank >= 8) add("wasted", W + 1, [
    `${u} was handed the **${ord(ovrRank)}-best roster** in the league and turned it into a ${rec} team. The players did their job. He didn't.`,
    `On paper this team is ${ord(ovrRank)}. With ${u} coaching it's ${ord(recRank)}. That's ${recRank - ovrRank} spots of pure user error.`,
  ]);
  // Run/pass tendencies.
  const ra = sum((t) => t.ra), pa = sum((t) => t.pa);
  if (ra + pa >= 150 && ra / (ra + pa) >= 0.55) add("hbdive", W - 0.5, [
    `${u} runs it **${pct((ra / (ra + pa)) * 100)}** of the time. His playbook is HB Dive and a prayer. Snap it and close your eyes, buddy.`,
  ]);
  if (ra + pa >= 150 && ra / (ra + pa) <= 0.3) add("airraid", W - 0.5, [
    `${u} throws it **${pct((pa / (ra + pa)) * 100)}** of the time. He's never pressed the run button in his life.`,
  ]);
  return out;
}

/** Player facts that blame the user who runs his team. */
export function userPlayerRoasts(c: RoastCtx, p: Player, t: (Totals & { team: number }) | undefined): Fact[] {
  const team = c.d.teams.find((x) => x.id === p.team);
  const u = userOf(team);
  if (!u || p.ps) return [];
  const out: Fact[] = [];
  const add = (key: string, weight: number, variants: string[]) => out.push({ key: `u:${key}`, weight, text: jab(u, pick(variants)) });
  const who = p.last, cap = p.contract.capHit;
  if (t && t.pa >= 50 && t.pint >= 6) add("p_picks", W, [
    `${who} isn't throwing those **${t.pint} picks**. ${u} is. Blame the thumbs, not the QB.`,
    `${t.pint} interceptions "by ${who}". We all know who's really holding the controller, ${u}.`,
  ]);
  if (t && t.pa >= 50 && t.psk >= 20) add("p_sacks", W - 0.5, [
    `${who} has been sacked **${t.psk} times** because ${u} holds the ball like it's his only friend.`,
  ]);
  if (cap >= 12e6 && p.ovr < 78) add("p_contract", W, [
    `${u} chose to pay ${who} **${money(cap)}** to be a ${p.ovr} overall. Nobody forced him. He did this sober.`,
    `${who} makes ${money(cap)} because ${u} signed off on it. Investigate his front office for fraud.`,
  ]);
  if (p.age >= 31 && p.contract.yearsLeft >= 3 && cap >= 8e6) add("p_oldcontract", W - 0.5, [
    `${u} gave a **${p.age}-year-old** ${who} ${p.contract.yearsLeft} more years. ${u} is the reason front offices have background checks.`,
  ]);
  if (team && p.ovr >= 88 && team.rec.l > team.rec.w) add("p_wasting", W, [
    `${who} is a **${p.ovr} overall** and ${u} still can't win with him (${team.rec.w}-${team.rec.l}). Free him.`,
    `${u} has a ${p.ovr} OVR ${p.pos} and a losing record. That's not a roster problem, that's a ${u} problem.`,
  ]);
  if (p.ovr <= 70 && cap >= 2e6 && !p.ir) add("p_starter", W - 1, [
    `${u} is paying ${who}, a **${p.ovr} overall**, ${money(cap)}. He builds rosters like he's playing with his eyes closed.`,
  ]);
  return out;
}

const poss2 = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`);
