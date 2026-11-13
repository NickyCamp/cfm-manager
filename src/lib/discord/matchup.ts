// /tws: a team's game this week and how the two teams compare, offense against
// defense, as per-game averages with league ranks. Pure; works on LeagueData.
import type { Game, LeagueData, Team } from "../league/types";

export type StatKey =
  | "pts" | "yds" | "pass" | "rush" | "third" | "rz" | "give" | "sackd"      // offense
  | "pa" | "ydsA" | "passA" | "rushA" | "thirdA" | "rzA" | "take" | "sacks"; // defense

type Acc = { gp: number; sum: Record<string, number>; third: [number, number]; thirdA: [number, number]; rz: [number, number]; rzA: [number, number] };

// [offense stat, the defense stat it runs into, label, higher is better for the offense]
export const PAIRS: [StatKey, StatKey, string, boolean][] = [
  ["pts", "pa", "Points", true],
  ["yds", "ydsA", "Total yds", true],
  ["pass", "passA", "Pass yds", true],
  ["rush", "rushA", "Rush yds", true],
  ["third", "thirdA", "3rd down %", true],
  ["rz", "rzA", "Red zone TD%", true],
  ["give", "take", "Turnovers", false],
  ["sackd", "sacks", "Sacks", false],
];
// For ranking: does a bigger number rank higher?
const HIGH_GOOD: Record<StatKey, boolean> = {
  pts: true, yds: true, pass: true, rush: true, third: true, rz: true, give: false, sackd: false,
  pa: false, ydsA: false, passA: false, rushA: false, thirdA: false, rzA: false, take: true, sacks: true,
};

export type TeamStats = { gp: number; v: Record<StatKey, number>; rank: Record<StatKey, number> };

/** Per-game averages and league ranks for every team, from this season's finished games (regular season + playoffs). */
export function teamStats(d: LeagueData): Map<number, TeamStats> {
  const games = new Map(d.games.filter((g) => g.stage === 1 && g.final && g.home && g.away).map((g) => [g.id, g]));
  const rows = new Map<string, LeagueData["teamGames"][number]>();
  for (const r of d.teamGames) if (games.has(r.g)) rows.set(`${r.g}:${r.t}`, r);
  const acc = new Map<number, Acc>();
  const get = (t: number) => {
    let a = acc.get(t);
    if (!a) { a = { gp: 0, sum: {}, third: [0, 0], thirdA: [0, 0], rz: [0, 0], rzA: [0, 0] }; acc.set(t, a); }
    return a;
  };
  const add = (a: Acc, k: string, v: number) => { a.sum[k] = (a.sum[k] || 0) + v; };
  for (const g of games.values()) {
    for (const [t, o, pf, pa] of [[g.home, g.away, g.hs, g.as], [g.away, g.home, g.as, g.hs]]) {
      const me = rows.get(`${g.id}:${t}`), op = rows.get(`${g.id}:${o}`);
      if (!me || !op) continue;
      const a = get(t);
      a.gp++;
      add(a, "pts", pf); add(a, "pa", pa);
      add(a, "yds", me.yds); add(a, "pass", me.passYds); add(a, "rush", me.rushYds);
      add(a, "ydsA", op.yds); add(a, "passA", op.passYds); add(a, "rushA", op.rushYds);
      add(a, "give", me.turnovers); add(a, "take", me.takeaways);
      add(a, "sacks", me.sacks); add(a, "sackd", op.sacks);
      a.third[0] += me.third[0]; a.third[1] += me.third[1];
      a.thirdA[0] += op.third[0]; a.thirdA[1] += op.third[1];
      a.rz[0] += me.redZone[0]; a.rz[1] += me.redZone[1];
      a.rzA[0] += op.redZone[0]; a.rzA[1] += op.redZone[1];
    }
  }
  const out = new Map<number, TeamStats>();
  for (const [t, a] of acc) {
    const per = (k: string) => (a.gp ? (a.sum[k] || 0) / a.gp : 0);
    const pct = ([m, n]: [number, number]) => (n ? (m / n) * 100 : 0);
    const v = {
      pts: per("pts"), yds: per("yds"), pass: per("pass"), rush: per("rush"), third: pct(a.third), rz: pct(a.rz), give: per("give"), sackd: per("sackd"),
      pa: per("pa"), ydsA: per("ydsA"), passA: per("passA"), rushA: per("rushA"), thirdA: pct(a.thirdA), rzA: pct(a.rzA), take: per("take"), sacks: per("sacks"),
    } as Record<StatKey, number>;
    out.set(t, { gp: a.gp, v, rank: {} as Record<StatKey, number> });
  }
  // Rank 1 = best in the league; ties share a rank.
  const all = [...out.values()];
  for (const k of Object.keys(HIGH_GOOD) as StatKey[]) {
    const vals = all.map((s) => s.v[k]);
    for (const s of all) {
      const better = vals.filter((x) => (HIGH_GOOD[k] ? x > s.v[k] + 1e-9 : x < s.v[k] - 1e-9)).length;
      s.rank[k] = better + 1;
    }
  }
  return out;
}

/** The team's game this week, or (on a bye or if it's been played and the week hasn't moved) its next unplayed one. */
export function currentGame(d: LeagueData, team: Team): { game: Game | null; bye: boolean } {
  const mine = (g: Game) => g.home && g.away && (g.home === team.id || g.away === team.id);
  const now = d.games.find((g) => g.stage === d.season.stage && g.week === d.season.week && mine(g));
  if (now) return { game: now, bye: false };
  const next = d.games
    .filter((g) => mine(g) && !g.final && (g.stage > d.season.stage || (g.stage === d.season.stage && g.week > d.season.week)))
    .sort((a, b) => a.stage - b.stage || a.week - b.week)[0];
  return { game: next || null, bye: true };
}

const fmt = (k: StatKey, v: number) => (k === "third" || k === "thirdA" || k === "rz" || k === "rzA" ? `${v.toFixed(0)}%` : v >= 100 ? v.toFixed(0) : v.toFixed(1));

/** A monospace table: one team's offense against the other's defense. */
export function sideTable(off: Team, offS: TeamStats, def: Team, defS: TeamStats) {
  const head = `${"Per game".padEnd(13)}${`${off.abbr} OFF`.padStart(9)}  ${`${def.abbr} DEF`.padStart(9)}`;
  const lines = PAIRS.map(([o, dk, label]) => {
    const left = `${fmt(o, offS.v[o]).padStart(5)} #${String(offS.rank[o]).padEnd(2)}`;
    const right = `${fmt(dk, defS.v[dk]).padStart(5)} #${String(defS.rank[dk]).padEnd(2)}`;
    return `${label.padEnd(13)}${left}  ${right}`;
  });
  return "```\n" + [head, ...lines].join("\n") + "\n```";
}

// How a matchup reads in the mismatch list.
const EDGE_LABEL: Partial<Record<StatKey, string>> = { give: "ball security", sackd: "pass protection", third: "3rd down", rz: "red zone", yds: "total yards", pass: "passing", rush: "rushing" };

/** Biggest mismatches: where one side's unit ranks far better than the unit it faces. */
export function edges(a: Team, aS: TeamStats, b: Team, bS: TeamStats, max = 3) {
  const out: { gap: number; text: string }[] = [];
  for (const [off, offS, def, defS] of [[a, aS, b, bS], [b, bS, a, aS]] as const) {
    for (const [o, dk, label] of PAIRS) {
      if (o === "pts") continue;
      const what = EDGE_LABEL[o] || label.toLowerCase();
      const gap = defS.rank[dk] - offS.rank[o]; // positive: offense better ranked than the defense it faces
      if (gap >= 10) out.push({ gap, text: `Edge **${off.abbr}** on ${what}: #${offS.rank[o]} offense vs ${def.abbr}'s #${defS.rank[dk]} defense` });
      if (gap <= -10) out.push({ gap: -gap, text: `Edge **${def.abbr}** on ${what}: #${defS.rank[dk]} defense vs ${off.abbr}'s #${offS.rank[o]} offense` });
    }
  }
  return out.sort((x, y) => y.gap - x.gap).slice(0, max).map((x) => x.text);
}
