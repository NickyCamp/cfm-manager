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

import type { Game, LeagueData, Player, StatLine } from "./types";
import type { Market, Outcome } from "./marketTypes";

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

export function propMarkets(d: LeagueData, games: Game[], label: string): Market[] {
  const out: Market[] = [];
  const players = new Map(d.players.map((p) => [p.id, p]));
  const teams = new Map(d.teams.map((t) => [t.id, t]));
  const gameById = new Map(d.games.map((g) => [g.id, g]));

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
      const roles: [Player, Ladder[]][] = [
        ...pick(["QB"], "pa", 1).map((p) => [p, QB] as [Player, Ladder[]]),
        ...pick(["HB", "FB"], "ra", 1).map((p) => [p, RB] as [Player, Ladder[]]),
        ...pick(["WR", "TE", "HB"], "rcy", 2).map((p) => [p, WR] as [Player, Ladder[]]),
        ...pick(["LEDG", "REDG", "LE", "RE", "DT", "SAM", "WILL", "MIKE", "LOLB", "ROLB", "MLB"], "sk", 1).map((p) => [p, DEF] as [Player, Ladder[]]),
      ];
      const seen = new Set<string>();
      for (const [p, ladders] of roles) {
        const mine = prior.filter((l) => l.p === p.id);
        if (mine.length < 2) continue;
        const inGame = d.lines.find((l) => l.g === g.id && l.p === p.id);
        for (const lad of ladders) {
          const key = `${p.id}:${lad.key}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const xs = mine.map((l) => val(l, lad.key));
          const n = xs.length, mean = xs.reduce((s, x) => s + x, 0) / n;
          // opponent: sacks use what the opponent's line gives up, the rest what its defense allows
          const avg = leagueAvg(lad.key);
          const oppRate = perGame(opp.id, lad.key);
          const factor = avg > 0 && gamesFor.get(opp.id) ? 1 + 0.5 * (oppRate / avg - 1) : 1;
          const mu = Math.max(0, mean * factor);
          if (mu <= 0 && lad.key !== "pint") continue;
          const s2 = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, n - 1);
          const sd = Math.sqrt((n * s2 + 3 * (0.35 * mu) ** 2) / (n + 3)) || 1;
          const chance = (k: number) => (lad.count ? poisAtLeast(Math.max(mu, 0.05), k) : 1 - normCdf((k - 0.5 - mu) / sd));
          let strikes = lad.strikes.map((k) => ({ k, p: chance(k) })).filter((x) => x.p >= 0.04 && x.p <= 0.96);
          if (!strikes.length) strikes = [lad.strikes.map((k) => ({ k, p: chance(k) })).sort((x, y) => Math.abs(x.p - 0.5) - Math.abs(y.p - 0.5))[0]];
          strikes = strikes.sort((x, y) => Math.abs(x.p - 0.5) - Math.abs(y.p - 0.5)).slice(0, lad.key === "py" || lad.key === "ry" || lad.key === "rcy" ? 3 : 2);
          // counts always offer the simple "1+" line (throws an INT, scores a TD, gets a sack)
          if (lad.count && !strikes.some((x) => x.k === 1)) { const p1 = chance(1); if (p1 >= 0.02 && p1 <= 0.98) strikes = [{ k: 1, p: p1 }, ...strikes].slice(0, 2); }
          strikes.sort((x, y) => x.k - y.k);
          for (const { k, p: pr } of strikes) {
            const label = lad.key === "pint" && k === 1 ? `${p.first} ${p.last} throws an INT` : lad.key === "td" && k === 1 ? `${p.first} ${p.last} scores a TD` : lad.key === "sk" && k === 1 ? `${p.first} ${p.last} gets a sack` : lad.key === "ptd" && k === 1 ? `${p.first} ${p.last} throws a TD` : `${p.first} ${p.last} ${k}+ ${lad.unit}`;
            const o: Outcome = {
              id: `${p.id}:${lad.key}:${k}`, label, player: p.id, team: team.id,
              sub: `${team.abbr} ${p.pos} · ${(Math.round(mean * 10) / 10).toString()} ${lad.unit}/game${gamesFor.get(opp.id) && avg > 0 ? ` · ${opp.abbr} ${factor > 1.03 ? "allows more" : factor < 0.97 ? "allows less" : "about average"}` : ""}`,
              p: pr, prev: null, history: [pr], state: "open",
            };
            if (g.final) {
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
        key: `props-${g.id}-${grp}`, cat: "props", title: `${a.name} at ${h.name}: ${titles[grp]}`, subtitle: `${label} · player props, each line its own yes/no`,
        kind: "independent", settled: g.final, status: g.final ? "Settled" : "Open until kickoff",
        rules: `Each line settles on the player's stats in this game's box score (${a.city} ${a.name} at ${h.city} ${h.name}). If he has no stat line in the game, Yes loses. Chances come from his per-game averages in earlier games this season, nudged toward what the opponent allows; yards, attempts and catches use his own game-to-game spread, TDs, INTs and sacks a Poisson count. Play money only.`,
        outcomes: outs,
      });
    }
  }
  return out;
}
