// Per-game player prop markets for this week's games (Nick, 2026-11-13):
// "Will X throw for 250+ yards / throw an interception / score a TD?"
//
// Who: each team's main QB, RB and top two pass-catchers (most volume in the
// team's last four games, on the roster now, not hurt), plus its top pass rusher.
// Lines: Kalshi-style ladders ("250+ pass yds") picked around his average.
// Chance: his per-game average from earlier stage-1 games, nudged halfway toward
// what this opponent allows vs. the league average. Yards/attempts/catches use a
// normal curve with his own game-to-game spread; TDs, INTs and sacks are Poisson.
// Settles on his line in that game's box score; no line (didn't play) = No.
//
// Early season (Nick, 2026-11-20): props used to need 2 games this season, so Weeks 1–2 had none.
// Now a player with fewer than EARLY games this season is priced from last season's per-game
// numbers (prevSeason.ts), or from his position and OVR when he has none (rookies), blended with
// what he's done so far. Because that guess is shakier, those players get only the broad lines
// (yards, TDs, INTs, sacks; no attempts/completions/carries/catches), priced with wider odds, and
// the harder-to-reach rungs (about 15–45%) rather than coin flips.

import type { Game, LeagueData, Player, StatLine } from "./types";
import type { Market, Outcome } from "./marketTypes";
import type { PrevPlayer } from "./prevSeason";

type Key = "py" | "pa" | "pc" | "ptd" | "pint" | "ry" | "ra" | "rcy" | "rc" | "td" | "sk";
type Ladder = { key: Key; unit: string; strikes: number[]; count: boolean; group: "pass" | "run" | "td" };
const QB: Ladder[] = [
  { key: "py", unit: "pass yds", strikes: [150, 200, 250, 300, 350, 400], count: false, group: "pass" },
  { key: "pa", unit: "pass att", strikes: [25, 30, 35, 40, 45], count: false, group: "pass" },
  { key: "pc", unit: "completions", strikes: [15, 20, 25, 30], count: false, group: "pass" },
  { key: "ptd", unit: "pass TD", strikes: [1, 2, 3, 4], count: true, group: "pass" },
  { key: "pint", unit: "INT thrown", strikes: [1, 2, 3], count: true, group: "pass" },
];
const RB: Ladder[] = [
  { key: "ry", unit: "rush yds", strikes: [40, 60, 80, 100, 125, 150], count: false, group: "run" },
  { key: "ra", unit: "carries", strikes: [10, 15, 20, 25], count: false, group: "run" },
  { key: "td", unit: "TD (rush/rec)", strikes: [1, 2], count: true, group: "td" },
];
const WR: Ladder[] = [
  { key: "rcy", unit: "rec yds", strikes: [40, 60, 80, 100, 125, 150], count: false, group: "run" },
  { key: "rc", unit: "catches", strikes: [3, 5, 7, 9], count: false, group: "run" },
  { key: "td", unit: "TD (rush/rec)", strikes: [1], count: true, group: "td" },
];
const DEF: Ladder[] = [{ key: "sk", unit: "sacks", strikes: [1, 2], count: true, group: "td" }];

const val = (l: StatLine, k: Key) => (k === "td" ? (l.rtd || 0) + (l.rctd || 0) : (l[k] as number | undefined) || 0);

function normCdf(x: number) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}
/** P(X >= k) for X ~ Poisson(lam). */
function poisAtLeast(lam: number, k: number) {
  let p = Math.exp(-lam), cdf = 0;
  for (let i = 0; i < k; i++) { cdf += p; p *= lam / (i + 1); }
  return Math.max(0, 1 - cdf);
}

/** Fewer games than this this season: lean on last season / ratings and offer only the harder, broader lines. */
const EARLY = 4;
/** Volume lines left out early in the season (too specific for a guess). */
const SPECIFIC: Key[] = ["pa", "pc", "ra", "rc"];
const EDGE = ["LEDG", "REDG", "LE", "RE", "DT", "SAM", "WILL", "MIKE", "LOLB", "ROLB", "MLB"];

/** What a starter in this role does per game in a user league, at 80 OVR (rough Madden numbers, used only
 *  when the player has no last-season stats: rookies, players who didn't play). */
function ratingsBase(p: Player, k: Key): number {
  const pos = p.pos;
  const base: Partial<Record<Key, number>> =
    pos === "QB" ? { py: 235, pa: 33, pc: 21, ptd: 1.6, pint: 0.8 }
    : pos === "HB" || pos === "FB" ? { ry: 65, ra: 15, td: 0.55, rcy: 20, rc: 2.5 }
    : pos === "WR" ? { rcy: 60, rc: 4.5, td: 0.4 }
    : pos === "TE" ? { rcy: 40, rc: 3.5, td: 0.3 }
    : ["LEDG", "REDG", "LE", "RE"].includes(pos) ? { sk: 0.5 }
    : pos === "DT" ? { sk: 0.3 }
    : EDGE.includes(pos) ? { sk: 0.3 } : {};
  const v = base[k] ?? 0;
  const f = Math.min(1.4, Math.max(0.6, 1 + 0.025 * ((p.ovr || 80) - 80)));
  if (k === "pint") return v * Math.min(1.4, Math.max(0.6, 2 - f)); // better QBs throw fewer picks
  if (k === "pa" || k === "ra") return v; // volume follows the play calling more than the rating
  return v * f;
}

/** How this league's starters compare with ratingsBase (user leagues run hot: NCL 2027's starting QBs
 *  averaged over 300 pass yds): last season's top-32 per position (top 64 WRs), per game, over the
 *  80-OVR base. 1 when there's no last season. Clamped 0.6–2. */
function leagueScale(d: LeagueData, prev: Record<string, PrevPlayer>): (p: Player, k: Key) => number {
  const memo = new Map<string, number>();
  const group = (pos: string) => (pos === "FB" ? "HB" : ["LEDG", "REDG", "LE", "RE"].includes(pos) ? "EDGE" : EDGE.includes(pos) && pos !== "DT" ? "LB" : pos);
  const byGroup = new Map<string, Player[]>();
  for (const p of d.players) if (prev[String(p.id)]?.n >= 6) { const g = group(p.pos); if (!byGroup.has(g)) byGroup.set(g, []); byGroup.get(g)!.push(p); }
  return (p, k) => {
    const g = group(p.pos), id = `${g}:${k}`;
    if (memo.has(id)) return memo.get(id)!;
    const base = ratingsBase({ ...p, ovr: 80 }, k);
    const per = (x: Player) => (prev[String(x.id)].s[k] || 0) / prev[String(x.id)].n;
    const top = (byGroup.get(g) || []).map(per).sort((a, b) => b - a).slice(0, g === "WR" ? 64 : 32);
    const v = base > 0 && top.length >= 8 ? Math.min(2, Math.max(0.6, top.reduce((s, x) => s + x, 0) / top.length / base)) : 1;
    memo.set(id, v);
    return v;
  };
}

type Prior = { mean: number; sd: number; w: number; basis: "prev" | "ratings"; n?: number };
/** His starting point before this season's games: last season's per-game numbers, else ratings. */
function priorFor(p: Player, k: Key, prev: PrevPlayer | undefined, scale: (p: Player, k: Key) => number): Prior {
  if (prev && prev.n >= 2) {
    const n = prev.n, s = prev.s[k] || 0, q = prev.q[k] || 0;
    const mean = s / n;
    const varr = Math.max(0, (q - n * mean * mean) / Math.max(1, n - 1));
    // a full season counts as about 3 games of evidence; less if he barely played or changed teams
    const w = Math.min(3, n / 4) * (prev.t && prev.t !== p.team ? 0.67 : 1);
    return { mean, sd: Math.sqrt(varr) || 0.4 * mean, w: Math.max(0.75, w), basis: "prev", n };
  }
  const mean = ratingsBase(p, k) * scale(p, k);
  return { mean, sd: 0.45 * mean, w: 1.5, basis: "ratings" };
}

export function propMarkets(d: LeagueData, games: Game[], label: string): Market[] {
  const out: Market[] = [];
  const players = new Map(d.players.map((p) => [p.id, p]));
  const teams = new Map(d.teams.map((t) => [t.id, t]));
  const gameById = new Map(d.games.map((g) => [g.id, g]));
  const prevPl = d.prevSeason?.players ?? {};
  const prevYear = d.prevSeason?.year ?? d.season.year - 1;
  const scale = leagueScale(d, prevPl);

  for (const g of games) {
    const h = teams.get(g.home), a = teams.get(g.away);
    if (!h || !a) continue;
    // everything known before this game's week
    const before = (l: StatLine) => { const x = gameById.get(l.g); return Boolean(x && x.stage === 1 && x.final && x.week < g.week); };
    const prior = d.lines.filter(before);
    const priorGames = [...new Set(prior.map((l) => l.g))].map((id) => gameById.get(id)!);
    // what each defense allows per game, and the league average
    const allowed = new Map<number, Map<Key, number>>(), gamesFor = new Map<number, number>();
    for (const x of priorGames) for (const t of [x.home, x.away]) gamesFor.set(t, (gamesFor.get(t) || 0) + 1);
    for (const l of prior) {
      const x = gameById.get(l.g)!; const opp = l.t === x.home ? x.away : x.home;
      if (!allowed.has(opp)) allowed.set(opp, new Map());
      const m = allowed.get(opp)!;
      for (const k of ["py", "pa", "pc", "ptd", "pint", "ry", "ra", "rcy", "rc", "td"] as Key[]) m.set(k, (m.get(k) || 0) + val(l, k));
      // sacks a team allows = sacks its opponents' defenders made
      const own = l.t;
      if (!allowed.has(own)) allowed.set(own, new Map());
      allowed.get(own)!.set("sk", (allowed.get(own)!.get("sk") || 0) + (l.sk || 0));
    }
    const perGame = (team: number, k: Key) => (allowed.get(team)?.get(k) || 0) / Math.max(1, gamesFor.get(team) || 0);
    const leagueAvg = (k: Key) => { const ids = [...gamesFor.keys()]; return ids.reduce((s, t) => s + perGame(t, k), 0) / Math.max(1, ids.length); };

    const statsIn = d.lines.some((l) => l.g === g.id); // a final game's props only settle once its box score is in
    const sideMarkets: Record<"pass" | "run" | "td", Outcome[]> = { pass: [], run: [], td: [] };
    for (const [team, opp] of [[a, h], [h, a]] as const) {
      const teamGames = priorGames.filter((x) => x.home === team.id || x.away === team.id).sort((x, y) => y.week - x.week);
      const recent = new Set(teamGames.slice(0, 4).map((x) => x.id));
      const healthy = (p: Player | undefined) => Boolean(p && p.team === team.id && !p.ir && !p.injury && !p.gone);
      const pick = (positions: string[], k: Key, n: number) => {
        const tot = new Map<number, number>();
        for (const l of prior) if (recent.has(l.g) && l.t === team.id && val(l, k) > 0) tot.set(l.p, (tot.get(l.p) || 0) + val(l, k));
        return [...tot].filter(([id]) => healthy(players.get(id)) && positions.includes(players.get(id)!.pos)).sort((x, y) => y[1] - x[1]).slice(0, n).map(([id]) => players.get(id)!);
      };
      // Too few games this season to see who plays: go by the depth chart's likely starters (OVR),
      // with last season's numbers deciding between pass catchers and pass rushers.
      const roster = d.players.filter((p) => healthy(p) && !p.ps);
      const byOvr = (positions: string[], n: number) => roster.filter((p) => positions.includes(p.pos)).sort((x, y) => y.ovr - x.ovr).slice(0, n);
      const expect = (p: Player, k: Key) => priorFor(p, k, prevPl[String(p.id)], scale).mean;
      const starters = (positions: string[], k: Key, pool: number, n: number) => byOvr(positions, pool).sort((x, y) => expect(y, k) - expect(x, k)).slice(0, n);
      const usage = teamGames.length >= 2;
      const roles: [Player, Ladder[]][] = [
        ...(usage ? pick(["QB"], "pa", 1) : byOvr(["QB"], 1)).map((p) => [p, QB] as [Player, Ladder[]]),
        ...(usage ? pick(["HB", "FB"], "ra", 1) : byOvr(["HB"], 1)).map((p) => [p, RB] as [Player, Ladder[]]),
        ...(usage ? pick(["WR", "TE", "HB"], "rcy", 2) : starters(["WR", "TE"], "rcy", 5, 2)).map((p) => [p, WR] as [Player, Ladder[]]),
        ...(usage ? pick(EDGE, "sk", 1) : starters(EDGE, "sk", 6, 1)).map((p) => [p, DEF] as [Player, Ladder[]]),
      ];
      const seen = new Set<string>();
      for (const [p, ladders] of roles) {
        const mine = prior.filter((l) => l.p === p.id);
        const early = mine.length < EARLY;
        const inGame = d.lines.find((l) => l.g === g.id && l.p === p.id);
        for (const lad of ladders) {
          if (early && SPECIFIC.includes(lad.key)) continue;
          const key = `${p.id}:${lad.key}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const xs = mine.map((l) => val(l, lad.key));
          const nCur = xs.length, sumCur = xs.reduce((s, x) => s + x, 0);
          const pr = early ? priorFor(p, lad.key, prevPl[String(p.id)], scale) : null;
          // this season's games, plus (early) his starting point counted as a few games' worth
          const n = nCur + (pr?.w ?? 0);
          const mean = (sumCur + (pr ? pr.w * pr.mean : 0)) / n;
          const curMean = nCur ? sumCur / nCur : 0;
          // opponent: sacks use what the opponent's line gives up, the rest what its defense allows
          const avg = leagueAvg(lad.key);
          const oppRate = perGame(opp.id, lad.key);
          const factor = avg > 0 && gamesFor.get(opp.id) ? 1 + 0.5 * (oppRate / avg - 1) : 1;
          const mu = Math.max(0, mean * factor);
          if (mu <= 0 && lad.key !== "pint") continue;
          const ss = xs.reduce((s, x) => s + (x - curMean) ** 2, 0) + (pr ? pr.w * pr.sd ** 2 : 0);
          const s2 = ss / Math.max(1, n - (pr ? 0 : 1));
          // early: how unsure the starting point is (shrinks as his own games come in) widens the odds
          const unsure = pr ? 0.3 * pr.w / n : 0;
          const sd = Math.sqrt((n * s2 + 3 * (0.35 * mu) ** 2) / (n + 3) + (unsure * mu) ** 2) || 1;
          const chance = (k: number) => lad.count
            ? (unsure ? [1 - unsure, 1, 1 + unsure].reduce((s, f) => s + poisAtLeast(Math.max(mu * f, 0.05), k), 0) / 3 : poisAtLeast(Math.max(mu, 0.05), k))
            : 1 - normCdf((k - 0.5 - mu) / sd);
          const all = lad.strikes.map((k) => ({ k, p: chance(k) }));
          const yards = lad.key === "py" || lad.key === "ry" || lad.key === "rcy";
          let strikes: { k: number; p: number }[];
          if (early) {
            // the harder rungs: about 15–45%, nearest 30% first; fewer lines per stat
            strikes = all.filter((x) => x.p >= 0.15 && x.p <= 0.45).sort((x, y) => Math.abs(x.p - 0.3) - Math.abs(y.p - 0.3)).slice(0, yards ? 2 : 1);
            if (!strikes.length) { const next = all.filter((x) => x.p >= 0.08 && x.p < 0.5).sort((x, y) => y.p - x.p)[0]; if (next) strikes = [next]; }
            if (!strikes.length) continue;
          } else {
            strikes = all.filter((x) => x.p >= 0.04 && x.p <= 0.96);
            if (!strikes.length) strikes = [[...all].sort((x, y) => Math.abs(x.p - 0.5) - Math.abs(y.p - 0.5))[0]];
            strikes = strikes.sort((x, y) => Math.abs(x.p - 0.5) - Math.abs(y.p - 0.5)).slice(0, yards ? 3 : 2);
            // counts always offer the simple "1+" line (throws an INT, scores a TD, gets a sack)
            if (lad.count && !strikes.some((x) => x.k === 1)) { const p1 = chance(1); if (p1 >= 0.02 && p1 <= 0.98) strikes = [{ k: 1, p: p1 }, ...strikes].slice(0, 2); }
          }
          strikes.sort((x, y) => x.k - y.k);
          const r1 = (x: number) => (Math.round(x * 10) / 10).toString();
          const basis = !pr ? `${r1(mean)} ${lad.unit}/game`
            : `${nCur ? `${r1(curMean)} ${lad.unit}/game in ${nCur} game${nCur === 1 ? "" : "s"} · ` : ""}${pr.basis === "prev" ? `${prevYear}: ${r1(pr.mean)}/game` : `no ${prevYear} stats: ratings estimate`}`;
          for (const { k, p: chanceK } of strikes) {
            const label = lad.key === "pint" && k === 1 ? `${p.first} ${p.last} throws an INT` : lad.key === "td" && k === 1 ? `${p.first} ${p.last} scores a TD` : lad.key === "sk" && k === 1 ? `${p.first} ${p.last} gets a sack` : lad.key === "ptd" && k === 1 ? `${p.first} ${p.last} throws a TD` : `${p.first} ${p.last} ${k}+ ${lad.unit}`;
            const o: Outcome = {
              id: `${p.id}:${lad.key}:${k}`, label, player: p.id, team: team.id,
              sub: `${team.abbr} ${p.pos} · ${basis}${gamesFor.get(opp.id) && avg > 0 ? ` · ${opp.abbr} ${factor > 1.03 ? "allows more" : factor < 0.97 ? "allows less" : "about average"}` : ""}`,
              p: chanceK, prev: null, history: [chanceK], state: "open",
            };
            if (g.final && statsIn) {
              const got = inGame ? val(inGame, lad.key) : 0;
              o.state = inGame && got >= k ? "won" : "lost";
              o.p = o.state === "won" ? 1 : 0;
              o.sub = `${(o.sub ?? "").split(" · ")[0]} · ${inGame ? `had ${got}` : "no stats in this game"}`;
            }
            sideMarkets[lad.group].push(o);
          }
        }
      }
    }
    const titles = { pass: "passing", run: "rushing & receiving", td: "touchdowns & sacks" } as const;
    for (const grp of ["pass", "run", "td"] as const) {
      const outs = sideMarkets[grp];
      if (!outs.length) continue;
      out.push({
        key: `props-${g.id}-${grp}`, gameId: g.id, cat: "props", title: `${a.name} at ${h.name}: ${titles[grp]}`, subtitle: `${label} · player props, each line its own yes/no`,
        kind: "independent", settled: g.final && statsIn, status: g.final ? (statsIn ? "Settled" : "Final: waiting for the box score to settle") : "Open until kickoff",
        ...(g.final && !statsIn ? { closed: true } : {}),
        rules: `Each line settles on the player's stats in this game's box score (${a.city} ${a.name} at ${h.city} ${h.name}). If he has no stat line in the game, Yes loses. Trading stops at the kickoff time set for the game, or as soon as EA reports it played (checked live on every trade). Chances come from his per-game averages in earlier games this season, nudged toward what the opponent allows; yards, attempts and catches use his own game-to-game spread, TDs, INTs and sacks a Poisson count. Until a player has ${EARLY} games this season, his numbers start from last season's per-game averages (or his position and OVR if he has none) and only the broader, harder-to-reach lines are offered, with wider odds. Prices then move with members' bets.`,
        outcomes: outs,
      });
    }
  }
  return out;
}

/** Has this game's box score arrived? (Any player stat line at all for it.) */
export const hasBoxScore = (d: LeagueData, gameId: number) => d.lines.some((l) => l.g === gameId);

/** How a prop line finished, straight from the box score (outcome id "<player>:<stat>:<line>").
 *  Used to settle bets even after the league has moved on to the next week. null = not final yet. */
export function propResult(d: LeagueData, gameId: number, outcomeId: string): "won" | "lost" | null {
  const g = d.games.find((x) => x.id === gameId);
  if (!g?.final) return null;
  // Final, but the box score isn't in the data yet: wait for it. Settling now would mark every line
  // "No" (and pay the No side) on stats that simply haven't arrived.
  if (!hasBoxScore(d, gameId)) return null;
  const [pid, key, k] = outcomeId.split(":");
  const line = d.lines.find((l) => l.g === gameId && l.p === Number(pid));
  if (!line || !key || !(Number(k) > 0)) return "lost";
  return val(line, key as Key) >= Number(k) ? "won" : "lost";
}
