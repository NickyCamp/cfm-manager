// Read-side helpers over LeagueData: lookups, standings, schedules, box
// scores, season totals and leaders. Pure functions; safe to call per request.

import type { Game, LeagueData, Player, StatLine, Team, Week } from "./types";
import { isCapSet, leagueCap, projectedLeagueCap } from "./cap";
import { projectPlayer } from "./projection";


export const REG_SEASON_LAST_WEEK = 17;

export function indexes(d: LeagueData) {
  const teams = new Map(d.teams.map((t) => [t.id, t]));
  const byAbbr = new Map(d.teams.map((t) => [t.abbr.toLowerCase(), t]));
  const players = new Map(d.players.map((p) => [p.id, p]));
  const games = new Map(d.games.map((g) => [g.id, g]));
  return { teams, byAbbr, players, games };
}

export const weekKey = (stage: number, week: number) => `s${stage}w${week}`;

export function parseWeekKey(k: string | undefined): { stage: number; week: number } | null {
  const m = /^s(\d)w(\d{1,2})$/.exec(k || "");
  return m ? { stage: Number(m[1]), week: Number(m[2]) } : null;
}

export function weekTitle(d: LeagueData, stage: number, week: number) {
  if (stage === d.season.stage && week === d.season.week && stage >= 2) return d.season.title; // offseason
  return d.weeks.find((w) => w.stage === stage && w.week === week)?.title || (stage === 0 ? `Preseason Week ${week + 1}` : `Week ${week + 1}`);
}

/** The week the scores page opens on: the current week if any game is final, otherwise the last week with a final. */
export function defaultScoresWeek(d: LeagueData): { stage: number; week: number } {
  const cur = d.games.filter((g) => g.stage === d.season.stage && g.week === d.season.week);
  if (cur.some((g) => g.final)) return { stage: d.season.stage, week: d.season.week };
  const lastFinal = [...d.games].reverse().find((g) => g.final);
  return lastFinal ? { stage: lastFinal.stage, week: lastFinal.week } : { stage: d.season.stage, week: d.season.week };
}

export function gamesForWeek(d: LeagueData, stage: number, week: number): Game[] {
  return d.games.filter((g) => g.stage === stage && g.week === week);
}

export function weeksWithGames(d: LeagueData): Week[] {
  const have = new Set(d.games.filter((g) => g.home || g.away).map((g) => weekKey(g.stage, g.week)));
  return d.weeks.filter((w) => have.has(weekKey(w.stage, w.week)));
}

export const record = (t: Team) => `${t.rec.w}-${t.rec.l}${t.rec.t ? `-${t.rec.t}` : ""}`;
export const streakText = (n: number) => (n > 0 ? `W${n}` : n < 0 ? `L${-n}` : "—");

/** Conference → division → teams, ordered by win %, then EA's own seed/rank as the tiebreak. */
export function standings(d: LeagueData) {
  const order = (a: Team, b: Team) =>
    b.rec.pct - a.rec.pct || (a.rec.seed || 99) - (b.rec.seed || 99) || (a.rec.rank || 99) - (b.rec.rank || 99) || (b.rec.pf - b.rec.pa) - (a.rec.pf - a.rec.pa);
  const confs = new Map<string, Map<string, Team[]>>();
  for (const t of d.teams) {
    const c = t.conference || "League";
    if (!confs.has(c)) confs.set(c, new Map());
    const divs = confs.get(c)!;
    if (!divs.has(t.division)) divs.set(t.division, []);
    divs.get(t.division)!.push(t);
  }
  return [...confs.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([conf, divs]) => ({
      conf,
      divisions: [...divs.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([div, ts]) => ({ div, teams: ts.sort(order) })),
      // EA's seeds, 1–7, when it has given them.
      seeds: [...divs.values()].flat().filter((t) => t.rec.seed > 0 && t.rec.seed <= 7).sort((a, b) => a.rec.seed - b.rec.seed),
    }));
}

export function teamSchedule(d: LeagueData, teamId: number) {
  return d.games.filter((g) => g.home === teamId || g.away === teamId);
}

export function boxScore(d: LeagueData, gameId: number) {
  const lines = d.lines.filter((l) => l.g === gameId);
  const teamStats = d.teamGames.filter((t) => t.g === gameId);
  return { lines, teamStats };
}

// ---------- season totals ----------

export type Totals = Required<Omit<StatLine, "g" | "p" | "t">> & { gp: number };

const ZERO: Totals = {
  gp: 0, pa: 0, pc: 0, py: 0, ptd: 0, pint: 0, plng: 0, psk: 0, ra: 0, ry: 0, rtd: 0, rlng: 0, rfum: 0, rbt: 0,
  rc: 0, rcy: 0, rctd: 0, rclng: 0, rcdrop: 0, rcyac: 0, tk: 0, sk: 0, int: 0, ff: 0, fr: 0, dtd: 0, pd: 0, sfty: 0,
  fga: 0, fgm: 0, fglng: 0, xpa: 0, xpm: 0, pnt: 0, pnty: 0, pntnet: 0, pnt20: 0, pntlng: 0,
};
const MAX_FIELDS = new Set(["plng", "rlng", "rclng", "fglng", "pntlng"]);

/** Regular-season totals per player (playoffs and preseason excluded). */
export function seasonTotals(d: LeagueData, filter?: (l: StatLine) => boolean): Map<number, Totals & { team: number }> {
  const games = new Map(d.games.map((g) => [g.id, g]));
  const out = new Map<number, Totals & { team: number }>();
  for (const l of d.lines) {
    const g = games.get(l.g);
    if (!g || g.stage !== 1 || g.week > REG_SEASON_LAST_WEEK) continue;
    if (filter && !filter(l)) continue;
    let t = out.get(l.p);
    if (!t) { t = { ...ZERO, team: l.t }; out.set(l.p, t); }
    t.gp++;
    t.team = l.t;
    for (const [k, v] of Object.entries(l)) {
      if (k === "g" || k === "p" || k === "t" || typeof v !== "number") continue;
      const key = k as keyof Totals;
      if (MAX_FIELDS.has(k)) t[key] = Math.max(t[key], v);
      else t[key] += v;
    }
  }
  return out;
}

export function passerRating(t: Pick<Totals, "pa" | "pc" | "py" | "ptd" | "pint">) {
  if (!t.pa) return 0;
  const c = (x: number) => Math.max(0, Math.min(2.375, x));
  const a = c((t.pc / t.pa - 0.3) * 5), b = c((t.py / t.pa - 3) * 0.25), cc = c((t.ptd / t.pa) * 20), dd = c(2.375 - (t.pint / t.pa) * 25);
  return ((a + b + cc + dd) / 6) * 100;
}

export type LeaderCat = { key: keyof Totals; label: string; min?: (t: Totals) => boolean };
export const LEADER_CATS: LeaderCat[] = [
  { key: "py", label: "Passing yards" },
  { key: "ptd", label: "Passing TDs" },
  { key: "ry", label: "Rushing yards" },
  { key: "rtd", label: "Rushing TDs" },
  { key: "rcy", label: "Receiving yards" },
  { key: "rc", label: "Receptions" },
  { key: "rctd", label: "Receiving TDs" },
  { key: "tk", label: "Tackles" },
  { key: "sk", label: "Sacks" },
  { key: "int", label: "Interceptions" },
  { key: "ff", label: "Forced fumbles" },
  { key: "fgm", label: "Field goals made" },
];

export function leaders(d: LeagueData, n = 5) {
  const totals = seasonTotals(d);
  const ps = new Map(d.players.map((p) => [p.id, p]));
  return LEADER_CATS.map((c) => ({
    ...c,
    rows: [...totals.entries()]
      .filter(([, t]) => t[c.key] > 0)
      .sort(([, a], [, b]) => b[c.key] - a[c.key])
      .slice(0, n)
      .map(([id, t]) => ({ player: ps.get(id), team: t.team, value: t[c.key] })),
  }));
}

// ---------- rosters & cap ----------

export const POS_GROUPS: { label: string; positions: string[] }[] = [
  { label: "Quarterbacks", positions: ["QB"] },
  { label: "Running backs", positions: ["HB", "FB"] },
  { label: "Receivers", positions: ["WR", "TE"] },
  { label: "Offensive line", positions: ["LT", "LG", "C", "RG", "RT"] },
  { label: "Defensive line", positions: ["LEDG", "REDG", "LE", "RE", "DT"] },
  { label: "Linebackers", positions: ["SAM", "MIKE", "WILL", "LOLB", "MLB", "ROLB"] },
  { label: "Secondary", positions: ["CB", "FS", "SS"] },
  { label: "Specialists", positions: ["K", "P", "LS"] },
];

export function rosterGroups(players: Player[]) {
  const active = players.filter((p) => !p.ps);
  const used = new Set<number>();
  const groups = POS_GROUPS.map((g) => {
    const ps = active.filter((p) => g.positions.includes(p.pos)).sort((a, b) => b.ovr - a.ovr);
    ps.forEach((p) => used.add(p.id));
    return { label: g.label, players: ps };
  });
  const other = active.filter((p) => !used.has(p.id));
  if (other.length) groups.push({ label: "Other", players: other });
  const ps = players.filter((p) => p.ps).sort((a, b) => b.ovr - a.ovr);
  if (ps.length) groups.push({ label: "Practice squad", players: ps });
  return groups.filter((g) => g.players.length);
}

export function teamPlayers(d: LeagueData, teamId: number) {
  return d.players.filter((p) => p.team === teamId && !p.gone);
}

/** Dead money not attached to anyone on the roster: cap spent minus the roster's cap hits. */
export function inferredDeadCap(team: Team, roster: Player[]) {
  const sum = roster.reduce((a, p) => a + p.contract.capHit, 0);
  return Math.max(0, team.cap.spent - sum);
}

export const fullName = (p: Player | undefined) => (p ? (p.nick ? `${p.first} "${p.nick}" ${p.last}` : `${p.first} ${p.last}`) : "Unknown player");

// ---------- future cap ----------

export const PROJECTION_YEARS = 4;

/** The season EA's contracts and team caps describe (next season once Madden rolls contracts over in the offseason). */
export const capSeason = (d: LeagueData) => d.season.capYear ?? d.season.year;

/**
 * The next draft: the one after this season (season year + 1), until that draft
 * has happened in the offseason. Then it's the one after. The draft class has
 * arrived once contracts have rolled over (capYear moved on) and signed players
 * with 0 years pro show up again.
 */
export function nextDraftYear(d: LeagueData) {
  const y = d.season.year;
  const rolled = (d.season.capYear ?? y) > y;
  const drafted = rolled && d.players.some((p) => p.team && !p.gone && p.yearsPro === 0);
  return y + (drafted ? 2 : 1);
}

export function capYears(d: LeagueData) {
  return Array.from({ length: PROJECTION_YEARS + 1 }, (_, i) => capSeason(d) + i);
}

/**
 * Every team's committed cap for each of `years` (years[0] must be the cap season): this season is
 * Madden's own "spent" (dead money included); later seasons add up projected cap hits and void-year
 * bonus of everyone signed (practice squad and departed players left out). The one rule the team Cap
 * tab (teamCapProjection below), the Contract tool and the Trade Tool all use, so they can't disagree.
 * Pass `proj` to reuse projections already worked out.
 */
export function committedByTeam(d: LeagueData, years: number[], proj?: Map<number, ReturnType<typeof projectPlayer>>) {
  const out = new Map<number, number[]>(d.teams.map((t) => [t.id, years.map((_, i) => (i === 0 ? t.cap.spent : 0))]));
  for (const p of d.players) {
    if (p.gone || !p.team || p.ps) continue;
    const row = out.get(p.team);
    if (!row) continue;
    const pr = proj?.get(p.id) ?? projectPlayer(p, capSeason(d));
    years.forEach((y, i) => { if (i > 0) row[i] += (pr.hits[y] || 0) + (pr.dead[y] || 0); });
  }
  return out;
}

/**
 * A team's cap by year. This season uses Madden's own spent/available numbers
 * (they include dead money); later years add up projected cap hits of
 * everyone signed through that year (practice squad left out), plus void-year
 * bonus still counting from deals that have ended, against the league cap
 * grown by the baseline each season.
 */
export function teamCapProjection(d: LeagueData, team: Team) {
  const years = capYears(d);
  const baseCap = leagueCap(d.teams);
  const roster = teamPlayers(d, team.id).filter((p) => !p.ps);
  const rows = roster
    .map((p) => { const pr = projectPlayer(p, capSeason(d)); return { p, hits: pr.hits, dead: pr.dead }; })
    .sort((a, b) => b.p.contract.capHit - a.p.contract.capHit);
  const totals = years.map((y, i) => {
    if (i === 0) return { year: y, cap: team.cap.room, capSet: true, committed: team.cap.spent, space: team.cap.available, players: rows.filter((r) => r.hits[y] != null).length };
    const committed = rows.reduce((a, r) => a + (r.hits[y] || 0) + (r.dead[y] || 0), 0);
    const cap = projectedLeagueCap(baseCap, capSeason(d), y, d.knownCaps);
    return { year: y, cap, capSet: isCapSet(capSeason(d), y, d.knownCaps), committed, space: cap - committed, players: rows.filter((r) => r.hits[y] != null).length };
  });
  return { years, rows, totals, baseCap };
}
