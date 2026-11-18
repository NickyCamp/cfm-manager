// More /funfact roasts (Nick, 2026-11-18: "Add more"). Mostly ones that work on good players and
// winning teams too, since they had the fewest: position-relevant bad ratings, size, draft
// busts, cheaper/better teammates, rookies out-producing them, stat-padding winners, frauds.
import { REG_SEASON_LAST_WEEK, type Totals } from "../league/derive";
import type { Game, LeagueData, Player, Team } from "../league/types";
import { RATING_KEYS } from "../league/ratings";
import { esc, money, n, nth, ord, pct, pick, plural, poss, tail, type Fact } from "./factFormat";

const W = 4; // weight, same band as the other roasts
const regGame = (g: Game | undefined) => Boolean(g && g.stage === 1 && g.week <= REG_SEASON_LAST_WEEK);
const feet = (inches: number) => `${Math.floor(inches / 12)}'${inches % 12}"`;
type Tot = Map<number, Totals & { team: number }>;

const POS_GROUP: Record<string, string> = {
  QB: "QB", HB: "HB", FB: "HB", WR: "WR", TE: "TE", LT: "OL", LG: "OL", C: "OL", RG: "OL", RT: "OL",
  LEDG: "DL", REDG: "DL", LE: "DL", RE: "DL", DT: "DL", SAM: "LB", MIKE: "LB", WILL: "LB", LOLB: "LB", MLB: "LB", ROLB: "LB",
  CB: "DB", FS: "DB", SS: "DB", K: "K", P: "P",
};
export function extraPlayerRoasts(d: LeagueData, totals: Tot, p: Player, t: (Totals & { team: number }) | undefined): Fact[] {
  const out: Fact[] = [];
  const add = (key: string, weight: number, variants: string[], jab = true) => {
    const text = pick(variants);
    out.push({ key: `p:${key}`, weight, text: jab ? tail(text) : text });
  };
  const who = p.last, full = `${p.first} ${p.last}`;
  const grp = POS_GROUP[p.pos] || "";
  const team = d.teams.find((x) => x.id === p.team);
  const Team = team ? `The ${team.name}` : "";
  const cap = p.contract.capHit;
  const rating = (k: string) => (p.ratings ? p.ratings[RATING_KEYS.indexOf(k as (typeof RATING_KEYS)[number])] ?? 0 : 0);

  // Free agent / practice squad.
  if (!p.team) add("fa", W + 1, [
    `${full} is a free agent. **32 teams** looked at him and said no thanks.`,
    `Nobody in the league wants ${full}. Not even the CPU teams, and they'll take anybody.`,
  ]);
  else if (p.ps) add("ps", W, [
    `${full} is on ${poss(team ? `the ${team.name}` : "his team")} **practice squad**. Couldn't even make the 53.`,
    `${who} is on the practice squad. He holds the tackling dummies.`,
  ]);

  // (Position ratings and speed: ratingRoasts.ts.)
  if (p.ratings) {
    const inj = rating("injuryRating");
    if (inj && inj < 75) add("glass", W - 1, [
      `${who} has **${inj} injury**. He's made of glass and bad decisions.`,
      `${poss(who)} injury rating is **${inj}**. Bubble wrap him before kickoff.`,
    ]);
  }
  if (p.injury > 0 && p.team) add("hurt", W - 0.5, [
    `${who} is hurt again (out **${plural(p.injury, "more week")}**)${cap >= 5e6 ? ` on a ${money(cap)} cap hit` : ""}. Expensive spectator.`,
    `${who} is in street clothes for **${plural(p.injury, "more week")}**. The trainers know him by first name.`,
  ]);

  // Size.
  if (grp === "QB" && p.height && p.height <= 72) add("short", W - 1, [
    `${who} is **${feet(p.height)}**. He needs a step stool to see over his own line.`,
    `At ${feet(p.height)}, ${who} has thrown more passes into his linemen's backs than he'd admit.`,
  ]);
  if (p.weight >= 335) add("big", W - 1.5, [
    `${who} weighs **${p.weight} pounds**. The team buffet has a picture of him on the wall.`,
    `${p.weight} lbs. ${who} has never missed a meal and it shows.`,
  ]);
  if (grp === "DB" && p.weight && p.weight <= 180) add("tiny", W - 1.5, [
    `${who} weighs **${p.weight} pounds** soaking wet. Running backs use him as a speed bump.`,
  ]);

  // Draft, dev, experience.
  if (p.draft.round === 1 && p.draft.pick <= 15 && p.yearsPro >= 2 && p.ovr < 76) add("bust", W + 0.5, [
    `${who} went **${ord(p.draft.pick)} overall** in ${p.draft.year}. He's a **${p.ovr}**. Bust.`,
    `A top-15 pick (${ord(p.draft.pick)} in ${p.draft.year}) and still only a ${p.ovr} overall. Whoever drafted ${who} should be fired.`,
  ]);
  if (p.dev === 0 && p.age <= 25 && p.ovr >= 70) add("normaldev", W - 1.5, [
    `${who} is **Normal dev**. Even EA doesn't believe in him.`,
    `${who}: young, Normal dev, going nowhere. The game itself gave up on him.`,
  ]);
  if (p.dev === 3 && p.ovr < 85) add("fakexf", W, [
    `${who} is an **X-Factor at ${p.ovr} overall**. Fake superstar.`,
    `X-Factor ${who}, a ${p.ovr} OVR. The zone ability is the only thing carrying him.`,
  ]);
  if (p.yearsPro >= 7 && p.ovr < 72 && p.team) add("journeyman", W - 1, [
    `${who} has been in the league **${p.yearsPro} years** and he's still a **${p.ovr}**. Peak achieved.`,
    `${p.yearsPro} seasons, ${p.ovr} overall. ${who} is a professional backup and nothing more.`,
  ]);
  if (p.ovr >= 80 && (!p.abilities || p.abilities.length === 0)) add("noabilities", W - 1.5, [
    `${who} is ${p.ovr >= 80 && p.ovr < 90 ? "an" : "a"} ${p.ovr} overall with **zero abilities**. No superpowers. Just a guy.`,
  ]);
  if (p.team && p.contract.yearsLeft === 1 && p.age >= 30 && p.ovr < 82) add("lastdeal", W - 1, [
    `${who} is ${p.age} in the **last year of his deal**. Hope he saved his money.`,
    `Contract year for ${p.age}-year-old ${who}. The market for a ${p.ovr} his age is a handshake.`,
  ]);

  // A cheaper teammate at his position who's better.
  if (p.team && cap >= 5e6) {
    const mate = d.players.filter((x) => !x.gone && x.team === p.team && x.id !== p.id && POS_GROUP[x.pos] === grp && x.pos === p.pos && x.ovr > p.ovr && x.contract.capHit < cap * 0.5)
      .sort((a, b) => b.ovr - a.ovr)[0];
    if (mate) add("cheapermate", W + 0.5, [
      `${mate.first} ${mate.last} plays the same spot as ${who}, is a **${mate.ovr}** (vs ${p.ovr}) and makes **${money(cap - mate.contract.capHit)} less**.`,
      `${who} (${p.ovr}, ${money(cap)}) is getting outplayed by teammate ${mate.last} (${mate.ovr}, ${money(mate.contract.capHit)}). Awkward.`,
    ]);
  }
  // A rookie at his position with better numbers.
  if (t && t.gp && cap >= 8e6) {
    const val = (x: Totals) => (grp === "QB" ? x.py : grp === "HB" ? x.ry : grp === "WR" || grp === "TE" ? x.rcy : grp === "DL" ? x.sk : grp === "DB" ? x.int : 0);
    const what = grp === "QB" ? "passing yards" : grp === "HB" ? "rushing yards" : grp === "WR" || grp === "TE" ? "receiving yards" : grp === "DL" ? "sacks" : grp === "DB" ? "interceptions" : "";
    if (what) {
      const rook = d.players.filter((x) => !x.gone && x.team && x.yearsPro === 0 && POS_GROUP[x.pos] === grp)
        .map((x) => ({ x, v: val(totals.get(x.id) || ({} as Totals)) || 0 })).filter((r) => r.v > val(t)).sort((a, b) => b.v - a.v)[0];
      if (rook) add("rookie", W + 0.5, [
        `${rook.x.first} ${rook.x.last}, a **rookie** making ${money(rook.x.contract.capHit)}, has more ${what} (${n(rook.v)}) than ${who} (${n(val(t))}) on ${money(cap)}.`,
        `A rookie (${rook.x.last}) has out-produced ${who} in ${what}, ${n(rook.v)} to ${n(val(t))}. ${who} is getting paid ${money(cap)} to lose to a kid.`,
      ]);
    }
  }
  // QB efficiency, which can hit good QBs too.
  if (t && t.pa >= 100) {
    const ypa = t.py / t.pa, comp = (t.pc / t.pa) * 100;
    const qbs = [...totals.values()].filter((x) => x.pa >= 100);
    const ypaRank = 1 + qbs.filter((x) => x.py / x.pa < ypa).length;
    if (ypaRank <= 6) add("ypa", W, [
      `${who} averages **${ypa.toFixed(1)} yards per attempt**, ${nth(ypaRank, "worst")} among starters. Dink, dunk, punt.`,
      `${ypa.toFixed(1)} yards an attempt. ${who} throws checkdowns like he's scared of the sky.`,
    ]);
    if (comp < 60) add("comp", W, [
      `${who} completes **${pct(comp)}** of his passes. Flip a coin, it's about the same.`,
      `${pct(comp)} completions. ${poss(who)} receivers have to dive for everything.`,
    ]);
  }
  // The highest-paid guy on a losing team.
  if (team && team.rec.l > team.rec.w && cap > 0) {
    const top = d.players.filter((x) => !x.gone && x.team === team.id).reduce((a, b) => (b.contract.capHit > a.contract.capHit ? b : a));
    if (top.id === p.id) add("franchise", W, [
      `${who} is the **highest-paid player** on a **${team.rec.w}-${team.rec.l}** team. Franchise player of a franchise going nowhere.`,
      `${Team} built around ${who} (${money(cap)}). They're ${team.rec.w}-${team.rec.l}. Great foundation.`,
    ]);
  }
  return out;
}

export function extraTeamRoasts(d: LeagueData, team: Team): Fact[] {
  const out: Fact[] = [];
  const add = (key: string, weight: number, variants: string[]) => out.push({ key: `t:${key}`, weight, text: tail(pick(variants)) });
  const The = `The ${team.name}`, the = `the ${team.name}`;
  const byId = new Map(d.teams.map((t) => [t.id, t]));
  const user = team.user ? esc(team.user) : "";
  const roster = d.players.filter((p) => !p.gone && !p.ps && p.team === team.id);
  const res = d.games.filter((g) => g.final && regGame(g) && g.home && g.away && (g.home === team.id || g.away === team.id)).map((g) => {
    const home = g.home === team.id; return { opp: home ? g.away : g.home, us: home ? g.hs : g.as, them: home ? g.as : g.hs };
  });
  const wins = res.filter((r) => r.us > r.them);

  // Winners padding stats on CPU teams.
  if (user && wins.length >= 4) {
    const cpu = wins.filter((r) => byId.get(r.opp) && !byId.get(r.opp)!.user).length;
    if (cpu / wins.length >= 0.5) add("cpupad", W + 0.5, [
      `**${cpu} of ${poss(the)} ${wins.length} wins** came against CPU teams. ${user} is farming the computer.`,
      `${user} is ${team.rec.w}-${team.rec.l}, but ${cpu} of those wins were against nobody (CPU). Fake record.`,
    ]);
  }
  // Frauds: winning record, barely outscoring anyone.
  const margin = res.reduce((s, r) => s + r.us - r.them, 0);
  if (res.length >= 6 && team.rec.w - team.rec.l >= 2 && margin <= 3 * res.length) add("fraud", W, [
    `${The} are **${team.rec.w}-${team.rec.l}** with a point differential of just **${margin >= 0 ? "+" : ""}${margin}**. Frauds. Pure luck.`,
    `${team.rec.w}-${team.rec.l} and only ${margin >= 0 ? "+" : ""}${margin} in point differential. ${The} are one bounce away from reality.`,
  ]);
  // Talent: lowest-rated rosters.
  const ovrRank = 1 + d.teams.filter((t) => t.ovr < team.ovr).length;
  if (ovrRank <= 5) add("lowovr", W, [
    `${The} have ${nth(ovrRank, "worst")} roster in the league (**${team.ovr} OVR**). Madden's own ratings are laughing at them.`,
    `Team OVR: **${team.ovr}**, ${nth(ovrRank, "lowest")} in the league. ${The} are a roster made of practice squad leftovers.`,
  ]);
  // EA's power rank much worse than the record says.
  if (team.rec.rank && res.length >= 5) {
    const recRank = 1 + d.teams.filter((t) => t.rec.w - t.rec.l > team.rec.w - team.rec.l).length;
    if (team.rec.rank - recRank >= 8) add("powerrank", W - 0.5, [
      `${The} are ${team.rec.w}-${team.rec.l}, but EA's own power rankings have them **${ord(team.rec.rank)}**. Even the game knows they're frauds.`,
    ]);
  }
  // Youngest roster.
  if (roster.length >= 20) {
    const ageOf = (id: number) => { const r = d.players.filter((p) => !p.gone && !p.ps && p.team === id); return r.length ? r.reduce((s, p) => s + p.age, 0) / r.length : 99; };
    const mine = ageOf(team.id);
    const youngRank = 1 + d.teams.filter((t) => ageOf(t.id) < mine).length;
    if (youngRank <= 3 && team.rec.l > team.rec.w) add("daycare", W - 1, [
      `${The} have ${nth(youngRank, "youngest")} roster in the league (avg **${mine.toFixed(1)}**) and play like it. It's a daycare.`,
      `${poss(The)} locker room averages ${mine.toFixed(1)} years old. Nap time is mandatory.`,
    ]);
    const normals = roster.filter((p) => p.dev === 0).length / roster.length;
    const share = (id: number) => { const r = d.players.filter((p) => !p.gone && !p.ps && p.team === id); return r.length ? r.filter((p) => p.dev === 0).length / r.length : 0; };
    const nRank = 1 + d.teams.filter((t) => share(t.id) > normals).length;
    if (nRank <= 4) add("normals", W - 1, [
      `**${pct(normals * 100)}** of ${poss(the)} roster is Normal dev, ${nth(nRank, "most")} in the league. A team of nobodies.`,
    ]);
    // Highest-paid player isn't even their best.
    const top = roster.reduce((a, b) => (b.contract.capHit > a.contract.capHit ? b : a));
    const better = roster.filter((p) => p.ovr > top.ovr).length;
    if (better >= 5) add("toppaid", W, [
      `${poss(The)} highest-paid player, ${top.first} ${top.last} (${money(top.contract.capHit)}), isn't even top 5 on the team in OVR. **${better} teammates** are better.`,
      `${The} pay ${top.last} the most money on the roster. He's their ${ord(better + 1)}-best player.`,
    ]);
    // Their best player is hurt.
    const star = roster.reduce((a, b) => (b.ovr > a.ovr ? b : a));
    if (star.injury > 0 || star.ir) add("starhurt", W - 0.5, [
      `${poss(The)} best player, ${star.first} ${star.last}, is ${star.ir ? "on IR" : `out ${plural(star.injury, "more week")}`}. So now they're just bad.`,
    ]);
  }
  // Tryhard-lite for good-not-great user records.
  if (user && res.length >= 5) {
    const g = team.rec.w + team.rec.l + team.rec.t;
    const wp = g ? team.rec.w / g : 0;
    if (wp >= 0.6 && wp < 0.7) add("tryhardlite", W, [
      `${user} is **${team.rec.w}-${team.rec.l}**. Good enough to be smug, not good enough to matter.`,
      `${The} are ${team.rec.w}-${team.rec.l}. ${user} brags in the group chat like it's 16-1.`,
    ]);
  }
  return out;
}
