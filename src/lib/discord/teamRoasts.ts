// /funfact team roasts (Nick, 2026-11-18: "geared more towards insults… make fun of the team…
// add certain interactions between teams… make the variety much more diverse").
//
// Every template has a key (so /funfact can skip ones it showed recently) and several wordings
// picked at random, and some get a random closing jab (factFormat's tail). Head-to-head ones use
// this season's results: losing to bad teams, to CPU teams, getting swept, an opponent's season-high
// coming against them, one player out-producing their whole unit, and so on. Regular season only.
import { REG_SEASON_LAST_WEEK, inferredDeadCap, weekTitle } from "../league/derive";
import { teamStats, PAIRS, type StatKey } from "./matchup";
import type { Game, LeagueData, Player, Team } from "../league/types";
import type { Totals } from "../league/derive";
import { esc, money, n, nth, ord, pct, pick, plural, poss, tail, type Fact } from "./factFormat";

const R = 4.5; // base roast weight (plain facts are 1–3)
const regGame = (g: Game | undefined) => Boolean(g && g.stage === 1 && g.week <= REG_SEASON_LAST_WEEK);
const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type Agg = { gp: number; pf: number; pa: number; sacksBy: number; intsBy: number; pen: number; penYds: number; to: number; take: number; rz: [number, number]; fourth: [number, number] };
export type RoastCtx = { d: LeagueData; games: Map<number, Game>; totals: Map<number, Totals & { team: number }>; teamAgg: Map<number, Agg> };

// Unit labels for the league-rank roasts: [what it's called, how to show the number, jabs].
const UNIT: Partial<Record<StatKey, [string, (v: number) => string, string[]]>> = {
  pts: ["scoring", (v) => `${v.toFixed(1)} points a game`, ["The scoreboard operator gets the day off.", "Points appear to be optional.", "The end zone is a rumor there."]],
  yds: ["total offense", (v) => `${v.toFixed(1)} yards a game`, ["Moving the ball is apparently hard.", "Three and out is a lifestyle."]],
  pass: ["passing offense", (v) => `${v.toFixed(1)} passing yards a game`, ["The forward pass has been legal since 1906, for the record.", "The receivers are just there for decoration."]],
  rush: ["rushing offense", (v) => `${v.toFixed(1)} rushing yards a game`, ["The run game is a myth.", "The O-line is just standing there."]],
  third: ["3rd down offense", (v) => `${pct(v)} converted`, ["The punter is getting his steps in.", "3rd and anything is a punt."]],
  rz: ["red zone offense", (v) => `${pct(v)} TDs`, ["The kicker has the field goal unit on speed dial.", "Get them inside the 20 and they forget how football works."]],
  give: ["ball security", (v) => `${v.toFixed(1)} giveaways a game`, ["Butterfingers, all of them.", "They hand the ball over like it's a hot potato."]],
  sackd: ["pass protection", (v) => `${v.toFixed(1)} sacks allowed a game`, ["The QB should bill the O-line for his chiropractor.", "The O-line has turnstile energy."]],
  pa: ["scoring defense", (v) => `${v.toFixed(1)} points allowed a game`, ["The defense is more of a suggestion.", "Opponents are padding their stats."]],
  ydsA: ["total defense", (v) => `${v.toFixed(1)} yards allowed a game`, ["The defense waves people through.", "Tackling is apparently not taught."]],
  passA: ["pass defense", (v) => `${v.toFixed(1)} passing yards allowed a game`, ["Opposing receivers are running free.", "The secondary is a sightseeing tour."]],
  rushA: ["run defense", (v) => `${v.toFixed(1)} rushing yards allowed a game`, ["Opposing running backs fight over who gets to play them.", "It's a buffet for running backs."]],
  thirdA: ["3rd down defense", (v) => `${pct(v)} allowed`, ["Opponents treat 3rd and long like 1st and 10.", "Get off the field. Please."]],
  rzA: ["red zone defense", (v) => `${pct(v)} TDs allowed`, ["Inside the 20 it's a free six.", "No bend, all break."]],
  take: ["takeaways", (v) => `${v.toFixed(1)} a game`, ["The defense hasn't touched the ball in weeks.", "Allergic to the football."]],
  sacks: ["pass rush", (v) => `${v.toFixed(1)} sacks a game`, ["Opposing QBs could make a sandwich back there.", "The pass rush is on a permanent bye."]],
};

export function teamRoasts(c: RoastCtx, team: Team): Fact[] {
  const { d } = c;
  const out: Fact[] = [];
  /** key: the template; jab: maybe add a random closing line. */
  const add = (key: string, weight: number, variants: (string | false | null | undefined)[], jab = true) => {
    const v = variants.filter((x): x is string => Boolean(x));
    if (!v.length) return;
    const text = pick(v);
    out.push({ key: `t:${key}`, weight, text: jab ? tail(text) : text });
  };
  const The = `The ${team.name}`, the = `the ${team.name}`;
  const byId = new Map(d.teams.map((t) => [t.id, t]));
  const tn = (id: number) => `the ${byId.get(id)?.name ?? "other guys"}`;
  const Tn = (id: number) => cap1(tn(id));
  const rec = (t: Team) => `${t.rec.w}-${t.rec.l}${t.rec.t ? `-${t.rec.t}` : ""}`;
  const winPct = (t: Team) => { const g = t.rec.w + t.rec.l + t.rec.t; return g ? (t.rec.w + t.rec.t / 2) / g : 0.5; };
  const wk = (g: Game) => weekTitle(d, g.stage, g.week);
  const user = team.user ? esc(team.user) : "";
  const a = c.teamAgg.get(team.id);
  const roster = d.players.filter((p) => !p.gone && p.team === team.id);
  const active = roster.filter((p) => !p.ps);
  const N = d.teams.length;
  const losing = team.rec.l > team.rec.w;
  const players = new Map(d.players.map((p) => [p.id, p]));
  const pname = (p: Player | undefined) => (p ? `${p.first} ${p.last}` : "Some guy");

  // This season's results, from this team's side.
  const all = d.games.filter((g) => g.final && regGame(g) && g.home && g.away);
  const res = all.filter((g) => g.home === team.id || g.away === team.id).map((g) => {
    const home = g.home === team.id;
    const us = home ? g.hs : g.as, them = home ? g.as : g.hs;
    return { g, home, opp: home ? g.away : g.home, us, them, diff: us - them };
  });
  const losses = res.filter((r) => r.diff < 0);
  const wins = res.filter((r) => r.diff > 0);
  const score = (r: { us: number; them: number }) => `${Math.max(r.us, r.them)}-${Math.min(r.us, r.them)}`;
  // Every team's points per game, for "their season high came against you".
  const scored = new Map<number, { g: Game; pts: number }[]>();
  for (const g of all) for (const [t, pts] of [[g.home, g.hs], [g.away, g.as]] as const) {
    if (!scored.has(t)) scored.set(t, []);
    scored.get(t)!.push({ g, pts });
  }

  // ---------- money ----------
  const dead = inferredDeadCap(team, roster);
  if (dead >= 5e6) {
    const deads = d.teams.map((t) => inferredDeadCap(t, d.players.filter((p) => !p.gone && p.team === t.id)));
    const rank = 1 + deads.filter((x) => x > dead).length;
    const r = rank <= 5 ? ` That's ${nth(rank, "most")} in the league.` : "";
    add("dead", R, [
      `${The} are carrying **${money(dead)} in dead money**: cap space spent on players who aren't even on the team anymore.${r}`,
      `**${money(dead)}** of ${poss(the)} cap is going to guys who don't play there anymore.${r}`,
      `${The} are still cutting checks to ex-players: **${money(dead)} in dead money** this season.${r}`,
      `${The} paid **${money(dead)}** this year for players to go play somewhere else (or nowhere).${r}`,
    ]);
  }
  const ir = roster.filter((p) => p.ir).reduce((s, p) => s + p.contract.capHit, 0);
  if (ir >= 5e6) add("ir", R - 0.5, [
    `${The} are paying **${money(ir)}** this season to players sitting on IR.`,
    `**${money(ir)}** of ${poss(the)} cap is in the trainer's room right now.`,
    `${The} have **${money(ir)}** of salary on IR. That's an expensive cheering section.`,
  ]);
  const payRank = 1 + d.teams.filter((x) => x.cap.spent > team.cap.spent).length;
  if (a?.gp && payRank <= 10 && losing) add("payroll", R + 1, [
    `${The} have ${nth(payRank, "highest")} payroll in the league (${money(team.cap.spent)}) and a **${rec(team)}** record.`,
    `${money(team.cap.spent)} spent, **${rec(team)}** to show for it. ${The} have ${nth(payRank, "highest")} payroll in the league.`,
    `${The} are proof money can't buy wins: ${nth(payRank, "highest")} payroll, **${rec(team)}** record.`,
    `Imagine spending ${money(team.cap.spent)} (${nth(payRank, "most")} in the league) to go **${rec(team)}**. ${The} don't have to imagine.`,
  ]);
  const avail = team.cap.available;
  if (avail < 0) add("overcap", R - 0.5, [
    `${The} are **${money(-avail)} over the cap**. Someone took the credit card and ran.`,
    `${The} are **${money(-avail)} over the cap** and the bill is coming.`,
  ]);
  else if (avail >= 30e6 && losing && a?.gp) add("hoarding", R - 0.5, [
    `${The} are sitting on **${money(avail)} in cap space** at ${rec(team)}. Free agency is right there.`,
    `${The} are **${rec(team)}** with **${money(avail)}** of unused cap space. Spend some money, cowards.`,
    `${money(avail)} in cap room and a ${rec(team)} record. ${The} are saving up for... what exactly?`,
  ]);
  // A much cheaper team with a much better record.
  {
    const cheaper = d.teams.filter((t) => t.id !== team.id && team.cap.spent - t.cap.spent >= 20e6 && t.rec.w - team.rec.w >= 3)
      .sort((x, y) => (y.rec.w - team.rec.w) - (x.rec.w - team.rec.w))[0];
    if (cheaper) add("budget", R - 0.5, [
      `${Tn(cheaper.id)} spend **${money(team.cap.spent - cheaper.cap.spent)} less** than ${the} and have **${cheaper.rec.w - team.rec.w} more wins**.`,
      `${Tn(cheaper.id)} are ${rec(cheaper)} on a budget. ${The} are ${rec(team)} with ${money(team.cap.spent - cheaper.cap.spent)} more to spend. Embarrassing.`,
    ]);
  }

  // ---------- results ----------
  if (a?.gp) {
    const diff = a.take - a.to;
    if (diff <= -5) add("tomargin", R, [
      `${The} have given the ball away **${a.to} times** and taken it away only **${a.take}**. That's a **${diff}** turnover margin.`,
      `${The} are **${diff}** in turnover margin. They're basically playing for the other team.`,
      `${a.to} giveaways, ${a.take} takeaways. ${The} are very generous people.`,
    ]);
    const allowRank = 1 + [...c.teamAgg.values()].filter((x) => x.gp && x.pa / x.gp > a.pa / a.gp).length;
    if (allowRank <= 5) add("allowed", R - 0.5, [
      `${The} give up a point every **${(60 / (a.pa / a.gp)).toFixed(1)} minutes** (${(a.pa / a.gp).toFixed(1)} a game, ${nth(allowRank, "most")} in the league).`,
      `Opponents average **${(a.pa / a.gp).toFixed(1)} points** against ${the}, ${nth(allowRank, "most")} in the league. Easy money.`,
    ]);
    const penRank = 1 + [...c.teamAgg.values()].filter((x) => x.gp && x.penYds > a.penYds).length;
    if (penRank <= 6 && a.penYds >= 100) add("flags", R - 1, [
      `${The} have ${nth(penRank, "most")} penalty yards in the league (**${n(a.penYds)}**). Zero discipline.`,
      `The refs know ${the} by name: **${a.pen} flags for ${n(a.penYds)} yards**, ${nth(penRank, "most")} in the league.`,
    ]);
    const margin = a.pf - a.pa;
    const mRank = 1 + [...c.teamAgg.values()].filter((x) => x.gp && x.pf - x.pa < margin).length;
    if (margin <= -40 && mRank <= 5) add("margin", R, [
      `${The} have been outscored by **${-margin} points** this season, ${nth(mRank, "worst")} margin in the league.`,
      `Add it all up and ${the} are **${margin}** in point differential. That's not bad luck.`,
    ]);
  }
  const blowouts = res.filter((r) => r.them - r.us >= 20);
  if (blowouts.length >= 2) add("blowouts", R, [
    `${The} have lost by **20 or more ${blowouts.length} times** this season.`,
    `${The} have been blown out by 20+ **${blowouts.length} times**. Mercy rule when?`,
    `${blowouts.length} losses by 20+ points. ${The} are a running clock waiting to happen.`,
  ]);
  const under14 = res.filter((r) => r.us < 14).length;
  if (under14 >= 3) add("under14", R - 0.5, [
    `${The} have been held under 14 points **${under14} times**.`,
    `${under14} games under 14 points. ${poss(The)} offense is mostly theoretical.`,
  ]);
  const closeL = losses.filter((r) => r.diff >= -8).length;
  if (closeL >= 3) add("close", R - 0.5, [
    `${The} have lost **${closeL} one-score games**. They simply cannot close.`,
    `${closeL} losses by 8 points or less. ${The} are allergic to the 4th quarter.`,
    `${The} keep it close and then find a way to lose. **${closeL} one-score losses** so far.`,
  ]);
  if (res.length) {
    const worstD = res.reduce((x, y) => (y.them > x.them ? y : x));
    if (worstD.them >= 42) add("gaveup", R, [
      `${The} gave up **${worstD.them} points** to ${tn(worstD.opp)} in ${wk(worstD.g)}. That's not a defense, that's a welcome mat.`,
      `${Tn(worstD.opp)} hung **${worstD.them}** on ${the} in ${wk(worstD.g)}. Did the defense show up?`,
    ]);
    const low = res.reduce((x, y) => (y.us < x.us ? y : x));
    if (low.us <= 6) add("lowgame", R, [
      `${The} scored **${low.us === 0 ? "zero points" : `${low.us} points`}** against ${tn(low.opp)} in ${wk(low.g)}.${low.us === 0 ? " Not a field goal. Nothing." : ""}`,
      `${wk(low.g)}: ${the} put up **${low.us}** on ${tn(low.opp)}. A kicker alone could do that.`,
    ]);
  }
  if (Math.abs(team.rec.streak) >= 3 && team.rec.streak < 0) add("skid", R, [
    `${The} have lost **${-team.rec.streak} straight**.`,
    `${The} haven't won in **${-team.rec.streak} games**. Remember winning? They don't.`,
    `L after L after L: ${the} have dropped **${-team.rec.streak} in a row**.`,
  ]);
  const { homeW: hw, homeL: hl, awayW: aw, awayL: al, divW, divL } = team.rec;
  if (hl - hw >= 3) add("home", R - 1, [
    `${The} are **${hw}-${hl} at home**. Opponents circle this trip on the calendar.`,
    `Home-field advantage? ${The} are **${hw}-${hl}** in their own building. The fans deserve a refund.`,
  ]);
  if (al - aw >= 4) add("road", R - 1, [
    `${The} are **${aw}-${al} on the road**. They should just stay home.`,
    `Get ${the} on a plane and they fall apart: **${aw}-${al}** away from home.`,
  ]);

  // Run/pass balance: way too run-heavy or way too pass-heavy.
  {
    const share = (id: number) => {
      const ts = [...c.totals.values()].filter((t) => t.team === id);
      const ra = ts.reduce((s, t) => s + t.ra, 0), pa = ts.reduce((s, t) => s + t.pa, 0);
      return ra + pa >= 100 ? ra / (ra + pa) : null;
    };
    const mine = share(team.id);
    if (mine != null) {
      const shares = d.teams.map((t) => share(t.id)).filter((x): x is number => x != null);
      const runRank = 1 + shares.filter((x) => x > mine).length, passRank = 1 + shares.filter((x) => x < mine).length;
      if (runRank <= 3 && mine >= 0.5) add("runheavy", R, [
        `${The} run the ball on **${pct(mine * 100)} of their plays** (${nth(runRank, "most")} in the league). At this point just snap it and close your eyes.`,
        `${pct(mine * 100)} runs. ${poss(The)} playbook is one page and it's a handoff. They may as well snap the ball and close their eyes.`,
        `${The} run it ${pct(mine * 100)} of the time. The QB is just a guy who hands people the ball and watches.`,
      ]);
      if (passRank <= 3 && mine <= 0.35) add("passheavy", R - 0.5, [
        `${The} throw it on **${pct((1 - mine) * 100)} of their plays**. Their running back has filed a missing persons report on himself.`,
        `${pct((1 - mine) * 100)} passes. ${The} play Madden like it's 7-on-7 at the park.`,
      ]);
    }
  }

  // ---------- division and the standings ----------
  const div = d.teams.filter((t) => t.division === team.division);
  if (div.length >= 3 && res.length >= 4) {
    const sorted = [...div].sort((x, y) => winPct(y) - winPct(x));
    const last = sorted[sorted.length - 1].id === team.id && winPct(sorted[sorted.length - 2]) > winPct(team);
    if (last) add("divlast", R, [
      `${The} are **dead last in the ${team.division}** at ${rec(team)}.`,
      `Bottom of the ${team.division}: ${the}, ${rec(team)}. Every rival is looking down at them.`,
      `There are ${div.length} teams in the ${team.division}, and ${the} are the worst one.`,
    ]);
    const leader = sorted[0];
    if (leader.id !== team.id && leader.rec.w - team.rec.w >= 5) add("divleader", R - 1, [
      `${Tn(leader.id)} have **${leader.rec.w - team.rec.w} more wins** than ${the}, and they play in the same division.`,
      `${Tn(leader.id)} (${rec(leader)}) and ${the} (${rec(team)}) are in the same division. Only one of them is any good.`,
    ]);
    if (divW === 0 && divL >= 2) add("divwinless", R, [
      `${The} are **0-${divL} in the ${team.division}**. Every rival has had a turn.`,
      `${The} haven't beaten a division rival all year (**0-${divL}**). The ${team.division} uses them for practice.`,
    ]);
  }
  // Roster talent vs record: underachievers.
  if (res.length >= 5) {
    const ovrRank = 1 + d.teams.filter((t) => t.ovr > team.ovr).length;
    const recRank = 1 + d.teams.filter((t) => winPct(t) > winPct(team)).length;
    if (ovrRank <= 12 && recRank >= ovrRank + 10) add("underachieve", R + 0.5, [
      `On paper ${the} have the **${ord(ovrRank)}-best roster** (${team.ovr} OVR). On the field they have the **${ord(recRank)}-best record**. Coaching?`,
      `${The} are ${ord(ovrRank)} in team OVR and ${ord(recRank)} in the standings. Talent isn't the problem${user ? `, ${user}` : ""}.`,
      `${ord(ovrRank)}-best roster, ${rec(team)} record. ${The} are a fantasy team in real life.`,
    ]);
  }
  if (user && losing && res.length >= 4) add("manager", R, [
    `Under ${user}, ${the} are **${rec(team)}**. Fire the GM.`,
    `${user} is running ${the} straight into the ground: **${rec(team)}**.`,
    `Someone should check ${poss(user)} controller. ${The} are ${rec(team)}.`,
    `${The} are **${rec(team)}**. ${user} might want to try the CPU's playbook.`,
    `${user} has ${the} at **${rec(team)}**. The fans have started a petition.`,
  ]);

  // Winning too much is its own roast (Nick, 2026-11-18: "touch grass… must not have a real job or
  // girlfriend because they're still winning madden games"). Only for teams a person runs.
  if (user && res.length >= 5 && winPct(team) >= 0.7) {
    const wp = pct(winPct(team) * 100);
    add("tryhard", R + 1, [
      `${The} are **${rec(team)}** (${wp} wins). ${user}, go touch grass.`,
      `${user} has ${the} winning **${wp}** of their games. Nobody with a real job has this much time for Madden.`,
      `**${wp} win rate** for ${user}. Unemployed behavior, honestly.`,
      `${The} are ${rec(team)}. ${user} is clearly not spending weekends with a girlfriend.`,
      `${user} is ${rec(team)} with ${the}. The grass outside misses you, buddy.`,
      `A **${wp}** win rate in Madden is not the flex ${user} thinks it is. Call your mom. Go outside.`,
      `${user} at **${rec(team)}**: no job, no girlfriend, no losses. Two of those are a problem.`,
      `${The} win ${wp} of the time. ${user} has clearly put in hours that should have gone to a resume.`,
    ], false);
    if (team.rec.streak >= 5) add("tryhard_streak", R, [
      `${user} has won **${team.rec.streak} straight**. The sun is out, man. Look at it.`,
      `**${team.rec.streak} wins in a row** for ${the}. ${user} hasn't seen daylight since the preseason.`,
    ], false);
    const blowW = wins.filter((r) => r.diff >= 28).length;
    if (blowW >= 2) add("tryhard_blowouts", R, [
      `${user} has won by 28+ **${blowW} times** this season. Running up the score on your friends is crazy work.`,
      `${blowW} wins by four touchdowns or more. ${user} is playing like rent depends on it.`,
    ], false);
  }

  // ---------- head to head ----------
  // A loss to a worse team (the worst one they lost to).
  {
    const bad = losses.map((r) => ({ r, o: byId.get(r.opp)! })).filter((x) => x.o && x.o.rec.w <= x.o.rec.l && winPct(x.o) < winPct(team))
      .sort((x, y) => winPct(x.o) - winPct(y.o))[0];
    if (bad) {
      const { r, o } = bad, O = o.name;
      add("badloss", R + 1, o.rec.w === 1 ? [
        `${poss(Tn(o.id))} only win of the season? **${The}**, ${score(r)} in ${wk(r.g)}.`,
        `${Tn(o.id)} are ${rec(o)}. Their one win came against ${the}.`,
        `${Tn(o.id)} have won exactly one game all year, and ${the} were it (${score(r)}, ${wk(r.g)}).`,
      ] : [
        `${The} lost to the **${rec(o)} ${O}** ${score(r)} in ${wk(r.g)}. ${The} are one of only ${o.rec.w} teams they've beaten.`,
        `Of ${poss(tn(o.id))} ${o.rec.w} wins this season, one came against ${the}.`,
        `${Tn(o.id)} are ${rec(o)}. ${The} still found a way to lose to them (${score(r)}, ${wk(r.g)}).`,
      ]);
    }
  }
  // Lost to a CPU team (only a roast if a person runs this one).
  if (user) {
    const cpu = losses.filter((r) => byId.get(r.opp) && !byId.get(r.opp)!.user);
    if (cpu.length === 1) {
      const r = cpu[0];
      add("cpuloss", R + 1.5, [
        `${The} lost to ${tn(r.opp)} ${score(r)} in ${wk(r.g)}. Nobody was even holding the controller. It was the CPU.`,
        `${user} got beat by the computer: ${tn(r.opp)} (CPU) won ${score(r)} in ${wk(r.g)}.`,
        `Losing to a real person is one thing. ${The} lost to the **CPU-run** ${byId.get(r.opp)!.name}, ${score(r)}.`,
      ]);
    } else if (cpu.length >= 2) {
      const names = [...new Set(cpu.map((r) => byId.get(r.opp)!.name))].join(", ");
      add("cpuloss", R + 1.5, [
        `${The} have lost **${cpu.length} games to CPU teams** this season (${names}). The AI has their number.`,
        `${user} is **${cpu.length} losses deep against the CPU** this season (${names}). Maybe try All-Madden on the practice field.`,
      ]);
    }
  }
  // Swept / owned by one team.
  {
    const byOpp = new Map<number, typeof res>();
    for (const r of res) { if (!byOpp.has(r.opp)) byOpp.set(r.opp, []); byOpp.get(r.opp)!.push(r); }
    const owner = [...byOpp.entries()].filter(([, rs]) => rs.length >= 2 && rs.every((r) => r.diff < 0))
      .sort((x, y) => x[1].reduce((s, r) => s + r.diff, 0) - y[1].reduce((s, r) => s + r.diff, 0))[0];
    if (owner) {
      const [o, rs] = owner;
      const us = rs.reduce((s, r) => s + r.us, 0), them = rs.reduce((s, r) => s + r.them, 0);
      add("swept", R + 1, [
        `${Tn(o)} are **${rs.length}-0 against ${the}** this season, ${them}-${us} combined. Landlord behavior.`,
        `${The} have played ${tn(o)} ${rs.length} times. They've lost all ${rs.length}, by **${them - us} points** combined.`,
        `${Tn(o)} own ${the}. ${rs.length} games, ${rs.length} losses, ${them}-${us} combined. Pay rent.`,
      ]);
    }
  }
  // An opponent's highest-scoring game of the season came against them.
  {
    let best: { o: number; pts: number; avg: number; g: Game } | null = null;
    for (const r of res) {
      const list = scored.get(r.opp) || [];
      if (list.length < 3) continue;
      const max = Math.max(...list.map((x) => x.pts));
      if (r.them !== max || max < 28) continue;
      const avg = (list.reduce((s, x) => s + x.pts, 0) - max) / (list.length - 1);
      if (max - avg >= 10 && (!best || max - avg > best.pts - best.avg)) best = { o: r.opp, pts: max, avg, g: r.g };
    }
    if (best) add("theirhigh", R, [
      `${poss(Tn(best.o))} highest-scoring game of the season (**${best.pts}**) came against ${poss(the)} defense. They average ${best.avg.toFixed(1)} the rest of the time.`,
      `${Tn(best.o)} average ${best.avg.toFixed(1)} points against everybody else. Against ${the} they hung **${best.pts}**.`,
      `Need a confidence boost? Play ${the}. ${Tn(best.o)} scored a season-high **${best.pts}** on them in ${wk(best.g)}.`,
    ]);
  }
  // Their lowest output came against a bad defense.
  if (res.length >= 3) {
    const low = res.reduce((x, y) => (y.us < x.us ? y : x));
    const oa = c.teamAgg.get(low.opp);
    if (oa?.gp) {
      const rank = 1 + [...c.teamAgg.values()].filter((x) => x.gp && x.pa / x.gp > oa.pa / oa.gp).length;
      if (rank <= 10 && oa.pa / oa.gp - low.us >= 12) add("baddefense", R, [
        `${The} scored **${low.us}** against ${tn(low.opp)}, a defense that gives up ${(oa.pa / oa.gp).toFixed(1)} a game (${nth(rank, "most")} in the league).`,
        `${Tn(low.opp)} let everybody score. Everybody except ${the}, who managed **${low.us}** in ${wk(low.g)}.`,
      ]);
    }
  }
  // Lost to a team spending a lot less.
  {
    const cheap = losses.map((r) => ({ r, gap: team.cap.spent - (byId.get(r.opp)?.cap.spent ?? Infinity) })).filter((x) => x.gap >= 25e6).sort((x, y) => y.gap - x.gap)[0];
    if (cheap) add("outspent", R - 0.5, [
      `${The} spend **${money(cheap.gap)} more** than ${tn(cheap.r.opp)} and lost to them ${score(cheap.r)} in ${wk(cheap.r.g)}.`,
      `${Tn(cheap.r.opp)} beat ${the} ${score(cheap.r)} with **${money(cheap.gap)} less** in payroll. Money well spent.`,
    ]);
  }
  // Record against good teams / who the wins came against.
  {
    const good = res.filter((r) => { const o = byId.get(r.opp); return o && winPct(o) > 0.5; });
    const gw = good.filter((r) => r.diff > 0).length, gl = good.filter((r) => r.diff < 0).length;
    if (gw === 0 && gl >= 3) add("vsgood", R, [
      `${The} are **0-${gl} against teams with a winning record**. They only beat up on the weak.`,
      `Against anybody decent, ${the} are **0-${gl}**. Paper tigers.`,
    ]);
    if (wins.length >= 2) {
      const ow = wins.reduce((s, r) => s + (byId.get(r.opp)?.rec.w ?? 0), 0), ol = wins.reduce((s, r) => s + (byId.get(r.opp)?.rec.l ?? 0), 0);
      if (ow + ol >= 10 && ow / (ow + ol) < 0.4) add("softwins", R - 0.5, [
        `${poss(The)} ${wins.length} wins came against teams with a combined record of **${ow}-${ol}**. Nobody's impressed.`,
        `${The} have ${plural(wins.length, "win")}. Combined record of the teams they beat: **${ow}-${ol}**. Asterisks all around.`,
      ]);
    }
  }
  // An opposing player's monster day against them.
  {
    const ids = new Set(res.map((r) => r.g.id));
    const vs = d.lines.filter((l) => ids.has(l.g) && l.t !== team.id);
    const top = (f: (l: (typeof vs)[number]) => number) => vs.reduce<(typeof vs)[number] | null>((x, l) => (f(l) > (x ? f(x) : 0) ? l : x), null);
    const gOf = (l: { g: number }) => c.games.get(l.g)!;
    const qb = top((l) => l.py || 0);
    if (qb && ((qb.py || 0) >= 350 || (qb.ptd || 0) >= 4)) {
      const who = pname(players.get(qb.p));
      add("torch_pass", R, [
        `${who} threw for **${qb.py} yards and ${plural(qb.ptd || 0, "TD")}** on ${the} in ${wk(gOf(qb))}. The secondary is still looking for him.`,
        `${who} had **${qb.py} passing yards** against ${the} in ${wk(gOf(qb))}. Easiest game of his life.`,
        `${poss(The)} pass defense, a short story: ${who}, ${qb.py} yards, ${plural(qb.ptd || 0, "touchdown")}, ${wk(gOf(qb))}.`,
      ]);
    }
    const rb = top((l) => l.ry || 0);
    if (rb && (rb.ry || 0) >= 140) {
      const who = pname(players.get(rb.p));
      add("torch_rush", R, [
        `${who} ran for **${rb.ry} yards** on ${the} in ${wk(gOf(rb))}. Tackling: optional.`,
        `${who} went for **${rb.ry} rushing yards** against ${the} in ${wk(gOf(rb))}. Nobody wanted to tackle him.`,
      ]);
    }
    const wr = top((l) => l.rcy || 0);
    if (wr && (wr.rcy || 0) >= 140) {
      const who = pname(players.get(wr.p));
      add("torch_rec", R, [
        `${who} caught ${wr.rc || 0} balls for **${wr.rcy} yards** against ${the} in ${wk(gOf(wr))}. Nobody covered him. Nobody.`,
        `${who} put up **${wr.rcy} receiving yards** on ${the} in ${wk(gOf(wr))}. He was open the whole game.`,
      ]);
    }
    const sk = top((l) => l.sk || 0);
    if (sk && (sk.sk || 0) >= 3) {
      const who = pname(players.get(sk.p));
      add("torch_sack", R, [
        `${who} sacked ${poss(the)} QB **${sk.sk} times** in ${wk(gOf(sk))}. Did anyone try blocking him?`,
        `${who} lived in ${poss(the)} backfield in ${wk(gOf(sk))}: **${sk.sk} sacks**.`,
      ]);
    }
    const pk = top((l) => l.int || 0);
    if (pk && (pk.int || 0) >= 2) {
      const who = pname(players.get(pk.p));
      add("torch_int", R, [
        `${who} picked off ${poss(the)} QB **${pk.int} times** in ${wk(gOf(pk))}. Best receiver on the field.`,
        `${poss(The)} QB found ${who} **${pk.int} times** in ${wk(gOf(pk))}. Wrong jersey ${pk.int === 2 ? "both times" : "every time"}.`,
      ]);
    }
  }
  // One player on another team out-producing this team's whole unit.
  if (a?.gp && a.gp >= 4) {
    const others = [...c.totals.entries()].filter(([, t]) => t.team !== team.id);
    const best = (f: (t: Totals) => number) => others.reduce<[number, Totals & { team: number }] | null>((x, y) => (f(y[1]) > (x ? f(x[1]) : 0) ? y : x), null);
    const mine = [...c.totals.values()].filter((t) => t.team === team.id);
    const sum = (f: (t: Totals) => number) => mine.reduce((s, t) => s + f(t), 0);
    const one = (key: string, f: (t: Totals) => number, ours: number, what: string, unit: string) => {
      const b = best(f);
      if (!b || f(b[1]) <= ours || f(b[1]) < 3) return;
      const who = pname(players.get(b[0])), his = f(b[1]);
      add(key, R + 0.5, [
        `${who} (${tn(b[1].team)}) has **${n(his)} ${what} by himself**. ${poss(The)} entire ${unit} has ${n(ours)}.`,
        `${poss(The)} whole ${unit}: ${n(ours)} ${what}. ${who}, one guy: **${n(his)}**.`,
      ]);
    };
    one("oneman_sack", (t) => t.sk, a.sacksBy, "sacks", "defense");
    one("oneman_int", (t) => t.int, a.intsBy, "interceptions", "defense");
    one("oneman_rush", (t) => t.ry, sum((t) => t.ry), "rushing yards", "team");
    one("oneman_td", (t) => t.rtd + t.rctd, sum((t) => t.rtd + t.rctd), "offensive touchdowns", "roster");
  }

  // ---------- roster ----------
  if (active.length >= 20) {
    const xf = active.filter((p) => p.dev === 3).length;
    const withXf = d.teams.filter((t) => d.players.some((p) => !p.gone && !p.ps && p.team === t.id && p.dev === 3)).length;
    if (!xf && withXf >= N / 2) add("noxf", R - 1, [
      `${The} have **zero X-Factors**. ${plural(withXf, "team")} in the league have at least one.`,
      `X-Factors on ${poss(the)} roster: **none**. Not one guy.`,
    ]);
    const ageOf = (id: number) => { const r = d.players.filter((p) => !p.gone && !p.ps && p.team === id); return r.length ? r.reduce((s, p) => s + p.age, 0) / r.length : 0; };
    const mine = ageOf(team.id);
    const oldRank = 1 + d.teams.filter((t) => ageOf(t.id) > mine).length;
    if (oldRank <= 3) add("old", R - 1.5, [
      `${The} have ${nth(oldRank, "oldest")} roster in the league (avg **${mine.toFixed(1)}**). AARP sponsorship incoming.`,
      `${poss(The)} locker room averages **${mine.toFixed(1)} years old**, ${nth(oldRank, "oldest")} in the league. Early bird special after practice.`,
    ]);
  }

  // ---------- league ranks: every bottom-8 unit, not just the worst ----------
  const ts = teamStats(d).get(team.id);
  if (ts && ts.gp >= 3) {
    for (const [o, dk] of PAIRS) for (const k of [o, dk]) {
      const u = UNIT[k];
      const r = ts.rank[k];
      if (!u || r < N - 7) continue;
      const [label, fmt, jabs] = u;
      add(`unit_${k}`, R - 1 + (r - (N - 8)) * 0.2, [
        `${The} rank **${ord(r)} of ${N} in ${label}** (${fmt(ts.v[k])}). ${pick(jabs)}`,
        `${r === N ? "Dead last" : `${cap1(ord(r))} of ${N}`} in ${label}: ${the}, at ${fmt(ts.v[k])}. ${pick(jabs)}`,
        `In ${label}, ${the} rank **${ord(r)}** in the league (${fmt(ts.v[k])}). ${pick(jabs)}`,
      ], false);
    }
  }
  return out;
}
