// Mock prediction markets (Kalshi-style) for a league: Super Bowl, conference
// and division winners, playoff spots, #1 seeds, win totals, awards, stat
// leaders and this week's games. Every price is a probability from a Monte
// Carlo simulation of the rest of the season; nothing here is real money.
//
// Model
// - Team strength: a simple rating system (points per game above average,
//   adjusted for opponents) from finished stage-1 games, margins capped at 24,
//   blended with a prior from team overall (worth K games). Home field 1.5 pts.
//   Win chance = normal CDF(rating gap / 13).
// - Rest of the regular season is simulated game by game. While games are
//   left, seeds use wins with a rating-based tiebreak (an approximation); once
//   the regular season is over the exact NFL-tiebreaker seeds from
//   playoffPicture are used. Playoffs re-seed like the NFL; real playoff
//   results are used where the game has been played.
// - Players: season totals so far + per-team-game pace × team games left
//   (injured weeks / IR removed), times one random form factor per player per
//   simulation. Awards are scored from those projected totals (MVP adds team
//   wins), with a little voter randomness until the season ends.
// - Price history: the same model rerun "as of" each finished week, using only
//   games and stat lines from before that week.
//
// Prices are deterministic for a given data file (seeded random numbers).

import { playoffPicture } from "./playoffs";
import { seasonTotals, type Totals } from "./derive";
import type { Game, LeagueData, Player, Team } from "./types";

export const REG_LAST = 17;               // last regular-season week (0-based)
const HFA = 1.5;
const GAME_SD = 13;
const PRIOR_GAMES = 5;
const PTS_PER_OVR = 0.8;
const MARGIN_CAP = 24;
const SIMS_NOW = 4000;
const SIMS_HISTORY = 500;
const QB_MVP = 1.3;            // MVP voters lean QB

import { type Checkpoint, type Market, type MarketBook, type Outcome } from "./marketTypes";
export * from "./marketTypes";

// ---------------------------------------------------------------- random

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussFrom(r: () => number) {
  let spare: number | null = null;
  return () => {
    if (spare != null) { const s = spare; spare = null; return s; }
    let u = 0, v = 0;
    while (u === 0) u = r();
    while (v === 0) v = r();
    const m = Math.sqrt(-2 * Math.log(u));
    spare = m * Math.sin(2 * Math.PI * v);
    return m * Math.cos(2 * Math.PI * v);
  };
}
// normal CDF (Abramowitz–Stegun 7.1.26)
function phi(x: number) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

// ---------------------------------------------------------------- cutoffs

const isReg = (g: Game) => g.stage === 1 && g.week <= REG_LAST;
const hasTeams = (g: Game) => Boolean(g.home && g.away);
/** A game counts as played at checkpoint c when it's final and its week is before c. */
const playedAt = (g: Game, c: number) => g.stage === 1 && g.final && hasTeams(g) && g.week < c;

const CP_NOW = 99;

function checkpointLabel(c: number) {
  if (c === 0) return "Preseason";
  if (c <= 18) return `Wk ${c}`;
  if (c === 19) return "WC";
  if (c === 20) return "Div";
  if (c === 21) return "Conf";
  return "SB";
}

/** Finished checkpoints (every game before week c final) plus "Now" if the current week is part-played. */
function checkpoints(d: LeagueData): Checkpoint[] {
  const s1 = d.games.filter((g) => g.stage === 1 && hasTeams(g));
  const out: Checkpoint[] = [{ c: 0, label: "Preseason" }];
  const marks = [...Array.from({ length: 18 }, (_, i) => i + 1), 19, 20, 21, 23];
  for (const c of marks) {
    const before = s1.filter((g) => g.week < c);
    const prevC = out[out.length - 1].c;
    const inWindow = s1.filter((g) => g.week >= prevC && g.week < c);
    if (!inWindow.length || !before.every((g) => g.final)) break;
    out.push({ c, label: checkpointLabel(c) });
  }
  const last = out[out.length - 1].c;
  if (s1.some((g) => g.final && g.week >= last)) out.push({ c: CP_NOW, label: "Now" });
  return out;
}

// ---------------------------------------------------------------- ratings

function ratings(d: LeagueData, c: number) {
  const ids = d.teams.map((t) => t.id);
  const avgOvr = d.teams.reduce((a, t) => a + t.ovr, 0) / Math.max(1, d.teams.length);
  const prior = new Map(d.teams.map((t) => [t.id, (t.ovr - avgOvr) * PTS_PER_OVR]));
  const games = d.games.filter((g) => playedAt(g, c));
  const r = new Map(prior);
  for (let it = 0; it < 25; it++) {
    const sum = new Map(ids.map((id) => [id, 0])), n = new Map(ids.map((id) => [id, 0]));
    for (const g of games) {
      const m = Math.max(-MARGIN_CAP, Math.min(MARGIN_CAP, g.hs - g.as));
      const neutral = g.week === 22;
      const hfa = neutral ? 0 : HFA;
      sum.set(g.home, sum.get(g.home)! + m - hfa + (r.get(g.away) || 0));
      sum.set(g.away, sum.get(g.away)! - m + hfa + (r.get(g.home) || 0));
      n.set(g.home, n.get(g.home)! + 1);
      n.set(g.away, n.get(g.away)! + 1);
    }
    for (const id of ids) r.set(id, (sum.get(id)! + PRIOR_GAMES * prior.get(id)!) / (n.get(id)! + PRIOR_GAMES));
  }
  return r;
}

const winProb = (r: Map<number, number>, home: number, away: number, neutral = false) =>
  phi(((r.get(home) || 0) - (r.get(away) || 0) + (neutral ? 0 : HFA)) / GAME_SD);

/** Preseason expected wins from the overall-based prior over the full schedule (sets the win-total lines). */
function preseasonWins(d: LeagueData) {
  const r = ratings(d, 0);
  const e = new Map(d.teams.map((t) => [t.id, 0]));
  for (const g of d.games) {
    if (!isReg(g) || !hasTeams(g)) continue;
    const p = winProb(r, g.home, g.away);
    e.set(g.home, e.get(g.home)! + p);
    e.set(g.away, e.get(g.away)! + 1 - p);
  }
  return e;
}

// ---------------------------------------------------------------- players

type AwardKey = "mvp" | "opoy" | "dpoy" | "oroy" | "droy";
type LeadKey = "py" | "ry" | "rcy" | "sk" | "int";
const AWARDS: { key: AwardKey; title: string; short: string; def: boolean; rookie: boolean }[] = [
  { key: "mvp", title: "Most Valuable Player", short: "MVP", def: false, rookie: false },
  { key: "opoy", title: "Offensive Player of the Year", short: "OPOY", def: false, rookie: false },
  { key: "dpoy", title: "Defensive Player of the Year", short: "DPOY", def: true, rookie: false },
  { key: "oroy", title: "Offensive Rookie of the Year", short: "OROY", def: false, rookie: true },
  { key: "droy", title: "Defensive Rookie of the Year", short: "DROY", def: true, rookie: true },
];
const LEADS: { key: LeadKey; title: string; unit: string }[] = [
  { key: "py", title: "Passing yards leader", unit: "pass yds" },
  { key: "ry", title: "Rushing yards leader", unit: "rush yds" },
  { key: "rcy", title: "Receiving yards leader", unit: "rec yds" },
  { key: "sk", title: "Sack leader", unit: "sacks" },
  { key: "int", title: "Interceptions leader", unit: "INT" },
];
const STAT_KEYS = ["py", "ptd", "pint", "ry", "rtd", "rfum", "rc", "rcy", "rctd", "tk", "sk", "int", "ff", "fr", "pd", "dtd", "sfty"] as const;
type S = Record<(typeof STAT_KEYS)[number], number>;

const offScore = (s: S, passW: number) =>
  passW * (s.py * 0.04 + s.ptd * 4 - s.pint * 2) + s.ry * 0.1 + s.rtd * 6 + s.rcy * 0.1 + s.rctd * 6 + s.rc * 0.5 - s.rfum * 2;
const defScore = (s: S) => s.tk + s.sk * 8 + s.int * 10 + s.ff * 6 + s.fr * 4 + s.pd * 2.5 + s.dtd * 12 + s.sfty * 6;

function awardScore(key: AwardKey, s: S, pos: string, teamWins: number) {
  switch (key) {
    case "mvp": return offScore(s, 1) * (pos === "QB" ? QB_MVP : 1) + teamWins * 8;
    case "opoy": return offScore(s, 0.7);
    case "oroy": return offScore(s, 0.8);
    case "dpoy": case "droy": return defScore(s);
  }
}

type Cand = { id: number; team: number; pos: string; cur: S; rest: S };

// ---------------------------------------------------------------- one snapshot

type Snap = {
  team: Map<number, { po: number; div: number; seed1: number; conf: number; sb: number; wins: number; over: number }>;
  awards: Record<AwardKey, Map<number, number>>;
  leads: Record<LeadKey, Map<number, number>>;
  coy: Map<number, number>;           // team id → chance its coach wins
  games: Map<number, number>;         // game id → home win chance
  regDone: boolean;
};

function snapshot(d: LeagueData, c: number, sims: number, lines: Map<number, number>, expWins: Map<number, number>, now: boolean): Snap {
  const R = ratings(d, c);
  const teams = d.teams;
  const idx = new Map(teams.map((t, i) => [t.id, i]));
  const N = teams.length;

  // regular season so far
  const baseW = new Float64Array(N);
  const played = new Int32Array(N);
  const rest: Game[] = [];
  for (const g of d.games) {
    if (!isReg(g) || !hasTeams(g)) continue;
    const h = idx.get(g.home), a = idx.get(g.away);
    if (h == null || a == null) continue;
    if (playedAt(g, c)) {
      played[h]++; played[a]++;
      if (g.hs > g.as) baseW[h] += 1; else if (g.as > g.hs) baseW[a] += 1; else { baseW[h] += 0.5; baseW[a] += 0.5; }
    } else rest.push(g);
  }
  const restP = rest.map((g) => winProb(R, g.home, g.away));
  const restH = rest.map((g) => idx.get(g.home)!), restA = rest.map((g) => idx.get(g.away)!);
  const regDone = rest.length === 0 && played.some((x) => x > 0);

  // exact seeds once the regular season is over (as of c)
  let fixedSeeds: Map<string, number[]> | null = null;
  if (regDone) {
    const dc = c >= CP_NOW ? d : { ...d, games: d.games.map((g) => (g.stage === 1 && g.week >= c ? { ...g, final: false } : g)) };
    const pic = playoffPicture(dc);
    fixedSeeds = new Map(Object.entries(pic.conf).map(([cf, seeds]) => [cf, seeds.slice(0, 7).map((s) => s.c.id)]));
  }
  // real playoff results (as of c)
  const realPO = new Map<string, number>();
  for (const g of d.games) {
    if (g.stage !== 1 || g.week <= REG_LAST || !playedAt(g, c)) continue;
    realPO.set(`${g.week}:${Math.min(g.home, g.away)}:${Math.max(g.home, g.away)}`, g.hs > g.as ? g.home : g.away);
  }

  const confs = [...new Set(teams.map((t) => t.conference))].sort();
  const divsByConf = new Map(confs.map((cf) => [cf, [...new Set(teams.filter((t) => t.conference === cf).map((t) => t.division))].sort()]));
  const divTeams = new Map<string, number[]>();
  teams.forEach((t, i) => { if (!divTeams.has(t.division)) divTeams.set(t.division, []); divTeams.get(t.division)!.push(i); });

  // player candidates
  const players = new Map(d.players.map((p) => [p.id, p]));
  const playedIds = new Set(d.games.filter((g) => playedAt(g, c) && isReg(g)).map((g) => g.id));
  const totals = seasonTotals(d, (l) => playedIds.has(l.g));
  const remaining = new Int32Array(N);
  for (const g of rest) { remaining[idx.get(g.home)!]++; remaining[idx.get(g.away)!]++; }
  const cands: Cand[] = [];
  for (const [pid, t] of totals) {
    const p = players.get(pid);
    if (!p) continue;
    const ti = idx.get(t.team);
    const tp = ti == null ? 0 : played[ti];
    let left = ti == null ? 0 : remaining[ti];
    if (now) {
      if (p.gone || p.team === 0 || p.ir) left = 0;
      else if (p.injury > 0) left = Math.max(0, left - p.injury);
      if (p.team !== t.team) left = p.team && idx.has(p.team) ? remaining[idx.get(p.team)!] : 0;
    }
    const cur = {} as S, restS = {} as S;
    for (const k of STAT_KEYS) {
      cur[k] = (t as Totals)[k] || 0;
      restS[k] = tp > 0 ? (cur[k] / tp) * left : 0;
    }
    cands.push({ id: pid, team: p.team && idx.has(p.team) && now ? p.team : t.team, pos: p.pos, cur, rest: restS });
  }
  const expected = (cd: Cand) => { const s = {} as S; for (const k of STAT_KEYS) s[k] = cd.cur[k] + cd.rest[k]; return s; };
  const expTeamW = (team: number) => { const i = idx.get(team); return i == null ? 0 : baseW[i] + remaining[i] / 2; };
  const awardCands = new Map<AwardKey, Cand[]>();
  for (const a of AWARDS) {
    const pool = cands.filter((cd) => !a.rookie || players.get(cd.id)?.yearsPro === 0);
    const scored = pool.map((cd) => ({ cd, s: awardScore(a.key, expected(cd), cd.pos, expTeamW(cd.team)) })).filter((x) => x.s > 0);
    scored.sort((x, y) => y.s - x.s);
    awardCands.set(a.key, scored.slice(0, 25).map((x) => x.cd));
  }
  const leadCands = new Map<LeadKey, Cand[]>();
  for (const l of LEADS) {
    const scored = cands.map((cd) => ({ cd, s: cd.cur[l.key] + cd.rest[l.key] })).filter((x) => x.s > 0).sort((x, y) => y.s - x.s);
    leadCands.set(l.key, scored.slice(0, 20).map((x) => x.cd));
  }
  const candList = [...new Map([...awardCands.values(), ...leadCands.values()].flat().map((cd) => [cd.id, cd])).values()];
  const cPos = new Map(candList.map((cd, i) => [cd.id, i]));
  const coyTeams = teams.map((t, i) => ({ t, i })).filter((x) => x.t.user);
  const passOf = (x: S) => x.py * 0.04 + x.ptd * 4 - x.pint * 2;
  const offOf = (x: S) => offScore(x, 0);
  const comp = candList.map((cd) => ({
    pass: [passOf(cd.cur), passOf(cd.rest)], off: [offOf(cd.cur), offOf(cd.rest)], def: [defScore(cd.cur), defScore(cd.rest)],
  }));
  // form spread: wide early (small samples), tighter as games pile up
  const formSd = candList.map((cd) => { const ti = idx.get(cd.team); const tp = ti == null ? 0 : played[ti]; return 0.2 + 0.5 / (1 + tp / 3); });
  const awardIdx = new Map(AWARDS.map((a) => [a.key, awardCands.get(a.key)!.map((cd) => cPos.get(cd.id)!)]));
  const leadIdx = new Map(LEADS.map((l) => [l.key, leadCands.get(l.key)!.map((cd) => cPos.get(cd.id)!)]));

  // counters
  const cnt = { po: new Float64Array(N), div: new Float64Array(N), seed1: new Float64Array(N), conf: new Float64Array(N), sb: new Float64Array(N), wins: new Float64Array(N), over: new Float64Array(N) };
  const awardCnt = Object.fromEntries(AWARDS.map((a) => [a.key, new Map<number, number>()])) as Record<AwardKey, Map<number, number>>;
  const leadCnt = Object.fromEntries(LEADS.map((l) => [l.key, new Map<number, number>()])) as Record<LeadKey, Map<number, number>>;
  const coyCnt = new Map<number, number>();
  const inc = (m: Map<number, number>, k: number) => m.set(k, (m.get(k) || 0) + 1);

  const rand = rng(0x5eed ^ (c * 7919) ^ (sims * 31));
  const gauss = gaussFrom(rand);
  const W = new Float64Array(N);
  const form = new Float64Array(candList.length);
  const tb = new Float64Array(N);
  const ratingArr = teams.map((t) => R.get(t.id) || 0);
  const seasonOver = regDone;

  const playGame = (week: number, hi: number, ai: number, neutral: boolean) => {
    const h = teams[hi].id, a = teams[ai].id;
    const real = realPO.get(`${week}:${Math.min(h, a)}:${Math.max(h, a)}`);
    if (real != null) return real === h ? hi : ai;
    return rand() < winProb(R, h, a, neutral) ? hi : ai;
  };

  for (let s = 0; s < sims; s++) {
    W.set(baseW);
    for (let k = 0; k < rest.length; k++) { if (rand() < restP[k]) W[restH[k]]++; else W[restA[k]]++; }
    for (let i = 0; i < N; i++) {
      cnt.wins[i] += W[i];
      if (W[i] > (lines.get(teams[i].id) ?? 99)) cnt.over[i]++;
      tb[i] = W[i] + ratingArr[i] * 0.004 + rand() * 0.002;
    }
    // seeds
    const champs: number[] = [];
    for (const cf of confs) {
      let seeds: number[];
      if (fixedSeeds) seeds = (fixedSeeds.get(cf) || []).map((id) => idx.get(id)!);
      else {
        const winners = divsByConf.get(cf)!.map((dv) => divTeams.get(dv)!.reduce((b, i) => (tb[i] > tb[b] ? i : b)));
        winners.sort((x, y) => tb[y] - tb[x]);
        const others = teams.map((_, i) => i).filter((i) => teams[i].conference === cf && !winners.includes(i)).sort((x, y) => tb[y] - tb[x]);
        seeds = [...winners, ...others.slice(0, 3)];
      }
      seeds.forEach((i, k) => { cnt.po[i]++; if (k < 4) cnt.div[i]++; if (k === 0) cnt.seed1[i]++; });
      // bracket
      if (seeds.length < 7) { champs.push(seeds[0]); continue; }
      const seedOf = new Map(seeds.map((i, k) => [i, k]));
      const bySeed = (arr: number[]) => arr.sort((x, y) => seedOf.get(x)! - seedOf.get(y)!);
      const wc = [playGame(18, seeds[1], seeds[6], false), playGame(18, seeds[2], seeds[5], false), playGame(18, seeds[3], seeds[4], false)];
      const r2 = bySeed([seeds[0], ...wc]);
      const dv = [playGame(19, r2[0], r2[3], false), playGame(19, r2[1], r2[2], false)];
      const r3 = bySeed(dv);
      const ch = playGame(20, r3[0], r3[1], false);
      cnt.conf[ch]++;
      champs.push(ch);
    }
    if (champs.length === 2) cnt.sb[playGame(22, champs[0], champs[1], true)]++;

    // players: every score is linear in the stats, so each candidate's
    // components are precomputed (so far + rest of season) and scaled by form.
    for (let k = 0; k < candList.length; k++) form[k] = Math.max(0, 1 + formSd[k] * gauss());
    for (const a of AWARDS) {
      let best = -1, bestS = -Infinity;
      for (const k of awardIdx.get(a.key)!) {
        const cp = comp[k], f = form[k], cd = candList[k];
        const pass = cp.pass[0] + cp.pass[1] * f, off = cp.off[0] + cp.off[1] * f, def = cp.def[0] + cp.def[1] * f;
        const ti = idx.get(cd.team);
        let sc: number;
        if (a.key === "mvp") sc = (pass + off) * (cd.pos === "QB" ? QB_MVP : 1) + (ti == null ? 0 : W[ti]) * 8;
        else if (a.key === "opoy") sc = pass * 0.7 + off;
        else if (a.key === "oroy") sc = pass * 0.8 + off;
        else sc = def;
        if (!seasonOver) sc *= 1 + 0.06 * gauss();
        if (sc > bestS) { bestS = sc; best = cd.id; }
      }
      if (best >= 0) inc(awardCnt[a.key], best);
    }
    for (const l of LEADS) {
      let best = -1, bestS = -Infinity;
      for (const k of leadIdx.get(l.key)!) {
        const cd = candList[k];
        const v = cd.cur[l.key] + cd.rest[l.key] * form[k];
        if (v > bestS) { bestS = v; best = cd.id; }
      }
      if (best >= 0) inc(leadCnt[l.key], best);
    }
    if (coyTeams.length) {
      let best = -1, bestS = -Infinity;
      for (const { t, i } of coyTeams) {
        let sc = W[i] - (expWins.get(t.id) || 0);
        if (!seasonOver) sc += 0.8 * gauss();
        else sc += ratingArr[i] * 1e-4;
        if (sc > bestS) { bestS = sc; best = t.id; }
      }
      inc(coyCnt, best);
    }
  }

  const team = new Map(teams.map((t, i) => [t.id, {
    po: cnt.po[i] / sims, div: cnt.div[i] / sims, seed1: cnt.seed1[i] / sims, conf: cnt.conf[i] / sims, sb: cnt.sb[i] / sims,
    wins: cnt.wins[i] / sims, over: cnt.over[i] / sims,
  }]));
  const norm = (m: Map<number, number>) => new Map([...m].map(([k, v]) => [k, v / sims]));
  const games = new Map<number, number>();
  for (const g of d.games) {
    if (g.stage !== 1 || !hasTeams(g)) continue;
    games.set(g.id, winProb(R, g.home, g.away, g.week === 22));
  }
  return {
    team,
    awards: Object.fromEntries(AWARDS.map((a) => [a.key, norm(awardCnt[a.key])])) as Snap["awards"],
    leads: Object.fromEntries(LEADS.map((l) => [l.key, norm(leadCnt[l.key])])) as Snap["leads"],
    coy: norm(coyCnt),
    games,
    regDone,
  };
}

// ---------------------------------------------------------------- the book

// Keyed by the data file's build time (the loader hands out a fresh object every
// minute even when nothing changed), a few leagues at a time.
const cache = new Map<string, MarketBook>();

export function marketBook(d: LeagueData): MarketBook {
  const key = `${d.builtAt}|${d.pulledAt}|${d.players.length}|${d.games.length}|${d.teams.map((t) => t.id).join(",")}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const book = buildBook(d);
  cache.set(key, book);
  while (cache.size > 6) cache.delete(cache.keys().next().value!);
  return book;
}


const half = (x: number) => Math.floor(x) + 0.5;
const tname = (t: Team) => `${t.city} ${t.name}`;
const pname = (p: Player | undefined) => (p ? `${p.first} ${p.last}` : "Unknown player");

function buildBook(d: LeagueData): MarketBook {
  const cps = checkpoints(d);
  const exp0 = preseasonWins(d);
  const lines = new Map([...exp0].map(([id, w]) => [id, half(w)]));
  const snaps = cps.map((cp, i) => snapshot(d, cp.c, i === cps.length - 1 ? SIMS_NOW : SIMS_HISTORY, lines, exp0, cp.c === CP_NOW || i === cps.length - 1));
  const now = snaps[snaps.length - 1];
  const prevIdx = snaps.length - 2;
  const teamsById = new Map(d.teams.map((t) => [t.id, t]));
  const players = new Map(d.players.map((p) => [p.id, p]));
  const games = d.games;

  const regGames = games.filter((g) => isReg(g) && hasTeams(g));
  const regDone = regGames.length > 0 && regGames.every((g) => g.final);
  const regRecord = (id: number) => {
    const r = { w: 0, l: 0, t: 0, left: 0 };
    for (const g of regGames) {
      if (g.home !== id && g.away !== id) continue;
      if (!g.final) { r.left++; continue; }
      const mine = g.home === id ? g.hs : g.as, theirs = g.home === id ? g.as : g.hs;
      if (mine > theirs) r.w++; else if (mine < theirs) r.l++; else r.t++;
    }
    return r;
  };
  const poGame = (week: number, pred?: (g: Game) => boolean) => games.find((g) => g.stage === 1 && g.week === week && hasTeams(g) && (!pred || pred(g)));
  const winnerOf = (g: Game | undefined) => (g && g.final ? (g.hs > g.as ? g.home : g.away) : 0);
  // playoff losers so far = out of the postseason markets
  const poLosers = new Set<number>();
  for (const g of games) if (g.stage === 1 && g.week > REG_LAST && g.final && hasTeams(g)) poLosers.add(g.hs > g.as ? g.away : g.home);
  const seeded = regDone ? new Set(Object.values(playoffPicture(d).conf).flatMap((s) => s.slice(0, 7).map((x) => x.c.id))) : null;

  const series = (get: (s: Snap) => number | undefined) => snaps.map((s) => { const v = get(s); return v == null ? null : v; });
  const mk = (id: string, label: string, hist: (number | null)[], extra: Partial<Outcome> = {}): Outcome => {
    const p = hist[hist.length - 1] ?? 0;
    const prev = prevIdx >= 0 ? hist[prevIdx] ?? null : null;
    return { id, label, p, prev, history: hist, state: "open", ...extra };
  };
  const teamOutcome = (t: Team, get: (s: Snap) => number | undefined, sub?: string) =>
    mk(String(t.id), tname(t), series(get), { team: t.id, sub: sub ?? (t.user || "CPU") });
  const settle = (m: Market, winners: Set<string>) => {
    m.settled = true;
    m.status = "Settled";
    for (const o of m.outcomes) { o.state = winners.has(o.id) ? "won" : "lost"; o.p = o.state === "won" ? 1 : 0; }
  };
  const sortOutcomes = (m: Market) => m.outcomes.sort((a, b) => (b.state === "won" ? 1 : 0) - (a.state === "won" ? 1 : 0) || (a.state === "lost" ? 1 : 0) - (b.state === "lost" ? 1 : 0) || b.p - a.p || a.label.localeCompare(b.label));

  const markets: Market[] = [];
  const confs = [...new Set(d.teams.map((t) => t.conference))].sort();
  const confShort = (cf: string) => cf.toUpperCase();
  const regRule = "Settles when the last regular-season game is final.";
  const modelRule = "Prices are chances from CFM Manager's season simulation, not real money.";

  // ---- this week's games
  const cur = d.season;
  const weekGames = games.filter((g) => g.stage === cur.stage && g.week === cur.week && hasTeams(g));
  for (const g of weekGames) {
    if (cur.stage !== 1) break;
    const h = teamsById.get(g.home), a = teamsById.get(g.away);
    if (!h || !a) continue;
    const hp = series((s) => s.games.get(g.id));
    const m: Market = {
      key: `game-${g.id}`, cat: "games", title: `${a.name} at ${h.name}`, subtitle: `${cur.title} · who wins?`, kind: "exclusive",
      settled: false, status: g.final ? "Settled" : "Open until kickoff",
      rules: `Settles on the final score of ${a.city} ${a.name} at ${h.city} ${h.name}. ${g.week === 22 ? "Neutral site." : "Home field is worth about 1.5 points in the model."} ${modelRule}`,
      outcomes: [
        mk(String(a.id), tname(a), hp.map((x) => (x == null ? null : 1 - x)), { team: a.id, sub: a.user || "CPU" }),
        mk(String(h.id), tname(h), hp, { team: h.id, sub: h.user || "CPU" }),
      ],
    };
    if (g.final) settle(m, new Set([String(g.hs > g.as ? g.home : g.away)]));
    markets.push(m);
  }

  // ---- Super Bowl
  {
    const sbG = poGame(22);
    const m: Market = {
      key: "sb", cat: "champion", title: `Super Bowl ${d.season.year} champion`, subtitle: "Who lifts the trophy?", kind: "exclusive",
      settled: false, status: "Open", rules: `Settles on the winner of the Super Bowl. ${modelRule}`,
      outcomes: d.teams.map((t) => teamOutcome(t, (s) => s.team.get(t.id)?.sb)),
    };
    const w = winnerOf(sbG);
    if (w) settle(m, new Set([String(w)]));
    else for (const o of m.outcomes) if (poLosers.has(o.team!) || (seeded && !seeded.has(o.team!))) { o.state = "lost"; o.p = 0; }
    markets.push(m);
  }

  // ---- conference champions
  for (const cf of confs) {
    const m: Market = {
      key: `conf-${cf.toLowerCase()}`, cat: "conference", title: `${confShort(cf)} champion`, subtitle: `Wins the ${confShort(cf)} Championship Game`, kind: "exclusive",
      settled: false, status: "Open", rules: `Settles on the winner of the ${confShort(cf)} Championship Game. ${modelRule}`,
      outcomes: d.teams.filter((t) => t.conference === cf).map((t) => teamOutcome(t, (s) => s.team.get(t.id)?.conf)),
    };
    const g = poGame(20, (x) => teamsById.get(x.home)?.conference === cf);
    const w = winnerOf(g);
    if (w) settle(m, new Set([String(w)]));
    else for (const o of m.outcomes) if (poLosers.has(o.team!) || (seeded && !seeded.has(o.team!))) { o.state = "lost"; o.p = 0; }
    markets.push(m);
  }

  // ---- divisions, playoffs, #1 seed, win totals
  const pic = regDone ? playoffPicture(d) : null;
  const divs = [...new Set(d.teams.map((t) => t.division))].sort();
  for (const dv of divs) {
    const ts = d.teams.filter((t) => t.division === dv);
    const m: Market = {
      key: `div-${dv.toLowerCase().replace(/\s+/g, "-")}`, cat: "division", title: `${dv} winner`, subtitle: "Division title, NFL tiebreakers", kind: "exclusive",
      settled: false, status: regDone ? "Settled" : "Closes after Week 18", rules: `Settles on the ${dv} winner using the NFL's tiebreaking procedures (same as the Playoffs page). ${regRule} ${modelRule}`,
      outcomes: ts.map((t) => teamOutcome(t, (s) => s.team.get(t.id)?.div)),
    };
    if (pic) {
      const winner = pic.divRows.get(dv)?.[0]?.c.id;
      if (winner) settle(m, new Set([String(winner)]));
    }
    markets.push(m);

    const wm: Market = {
      key: `wins-${dv.toLowerCase().replace(/\s+/g, "-")}`, cat: "wins", title: `${dv} win totals`, subtitle: "Over the preseason line? Each team is its own yes/no", kind: "independent",
      settled: false, status: regDone ? "Settled" : "Open", rules: `Each line was set before the season from team overall and schedule, and never moves. Yes wins if the team finishes the regular season with more wins than the line (ties count half). Each team settles when its last regular-season game is final. ${modelRule}`,
      outcomes: ts.map((t) => { const r = regRecord(t.id); return teamOutcome(t, (s) => s.team.get(t.id)?.over, `Over ${lines.get(t.id)} wins · ${r.w}-${r.l}${r.t ? `-${r.t}` : ""} now`); }),
    };
    for (const o of wm.outcomes) {
      const r = regRecord(o.team!);
      const wins = r.w + r.t / 2, left = r.left;
      const line = lines.get(o.team!)!;
      if (left === 0 || wins > line || wins + left < line) { o.state = wins > line ? "won" : "lost"; o.p = o.state === "won" ? 1 : 0; }
    }
    if (wm.outcomes.every((o) => o.state !== "open")) { wm.settled = true; wm.status = "Settled"; }
    markets.push(wm);
  }
  for (const cf of confs) {
    const ts = d.teams.filter((t) => t.conference === cf);
    const po: Market = {
      key: `po-${cf.toLowerCase()}`, cat: "playoffs", title: `${confShort(cf)} playoff teams`, subtitle: "Makes the 7-team field? Each team is its own yes/no", kind: "independent",
      settled: false, status: regDone ? "Settled" : "Closes after Week 18", rules: `Yes wins if the team is one of the 7 ${confShort(cf)} playoff seeds (NFL tiebreakers). ${regRule} ${modelRule}`,
      outcomes: ts.map((t) => teamOutcome(t, (s) => s.team.get(t.id)?.po)),
    };
    const s1: Market = {
      key: `seed1-${cf.toLowerCase()}`, cat: "playoffs", title: `${confShort(cf)} #1 seed`, subtitle: "First-round bye and home field", kind: "exclusive",
      settled: false, status: regDone ? "Settled" : "Closes after Week 18", rules: `Settles on the ${confShort(cf)}'s #1 playoff seed (NFL tiebreakers). ${regRule} ${modelRule}`,
      outcomes: ts.map((t) => teamOutcome(t, (s) => s.team.get(t.id)?.seed1)),
    };
    if (pic) {
      const seeds = (pic.conf[cf] || []).slice(0, 7).map((s) => String(s.c.id));
      settle(po, new Set(seeds));
      settle(s1, new Set(seeds.slice(0, 1)));
    }
    markets.push(po, s1);
  }

  // ---- awards and leaders
  const playerOutcomes = (get: (s: Snap) => Map<number, number>, subOf: (p: Player | undefined) => string) => {
    const ids = new Set<number>();
    for (const s of snaps) for (const [id, v] of get(s)) if (v > 0) ids.add(id);
    return [...ids].map((id) => {
      const p = players.get(id);
      return mk(String(id), pname(p), series((s) => { const m = get(s); return m.size ? (m.get(id) ?? 0) : undefined; }), { player: id, team: p?.team || undefined, sub: subOf(p) });
    });
  };
  const totalsNow = seasonTotals(d);
  const subFor = (p: Player | undefined, keys: [keyof Totals, string][]) => {
    if (!p) return "";
    const t = totalsNow.get(p.id);
    const team = teamsById.get(p.team);
    const stat = t ? keys.filter(([k]) => t[k]).map(([k, l]) => `${t[k]} ${l}`).join(" · ") : "";
    return [`${p.pos}${team ? ` · ${team.abbr}` : ""}`, stat].filter(Boolean).join(" · ");
  };
  for (const a of AWARDS) {
    const keys: [keyof Totals, string][] = a.def ? [["tk", "tkl"], ["sk", "sk"], ["int", "INT"]] : [["py", "pass yds"], ["ptd", "pass TD"], ["ry", "rush yds"], ["rcy", "rec yds"], ["rtd", "rush TD"], ["rctd", "rec TD"]];
    const m: Market = {
      key: `award-${a.key}`, cat: "awards", title: `${a.title} (${a.short})`, subtitle: a.rookie ? "Rookies only" : a.def ? "Defensive players" : "Regular-season production" + (a.key === "mvp" ? " + team wins" : ""),
      kind: "exclusive", settled: false, status: regDone ? "Settled" : "Closes after Week 18",
      rules: `Madden's own awards aren't in EA's export, so this settles on the CFM Manager award formula at the end of the regular season: ${a.def ? "tackles + 8 per sack + 10 per INT + 6 per forced fumble + 4 per recovery + 2.5 per pass defended + 12 per TD + 6 per safety" : `0.04 per passing yard${a.key === "opoy" ? " (×0.7)" : a.key === "oroy" ? " (×0.8)" : ""}, 4 per passing TD, −2 per INT, 0.1 per rushing/receiving yard, 6 per rushing/receiving TD, 0.5 per catch, −2 per fumble${a.key === "mvp" ? "; QBs ×1.3, plus 8 per team win" : ""}`}. Regular season only. ${modelRule}`,
      outcomes: playerOutcomes((s) => s.awards[a.key], (p) => subFor(p, keys)),
    };
    if (regDone) { const top = m.outcomes.reduce<Outcome | null>((b, o) => (!b || o.p > b.p ? o : b), null); settle(m, new Set(top ? [top.id] : [])); }
    if (m.outcomes.length) markets.push(m);
  }
  if (now.coy.size || d.teams.some((t) => t.user)) {
    const ids = new Set<number>();
    for (const s of snaps) for (const [id, v] of s.coy) if (v > 0) ids.add(id);
    const m: Market = {
      key: "award-coy", cat: "awards", title: "Coach of the Year", subtitle: "Most wins above the preseason line (users only)", kind: "exclusive",
      settled: false, status: regDone ? "Settled" : "Closes after Week 18",
      rules: `Settles on the user-run team that beats its preseason win total line by the most at the end of the regular season (ties: better team rating). ${modelRule}`,
      outcomes: [...ids].map((id) => { const t = teamsById.get(id)!; return mk(String(id), t.user || tname(t), series((s) => s.coy.get(id) ?? 0), { team: id, sub: `${tname(t)} · line ${lines.get(id)}` }); }),
    };
    if (regDone) { const top = m.outcomes.reduce<Outcome | null>((b, o) => (!b || o.p > b.p ? o : b), null); settle(m, new Set(top ? [top.id] : [])); }
    if (m.outcomes.length) markets.push(m);
  }
  for (const l of LEADS) {
    const m: Market = {
      key: `lead-${l.key}`, cat: "leaders", title: l.title, subtitle: "Regular-season total", kind: "exclusive",
      settled: false, status: regDone ? "Settled" : "Closes after Week 18",
      rules: `Settles on the league leader in regular-season ${l.unit} (same numbers as the Leaders page). Ties: the first listed wins. ${modelRule}`,
      outcomes: playerOutcomes((s) => s.leads[l.key], (p) => subFor(p, [[l.key, l.unit]])),
    };
    if (regDone) {
      let best: Outcome | null = null, bv = -1;
      for (const o of m.outcomes) { const v = totalsNow.get(Number(o.id))?.[l.key] || 0; if (v > bv) { bv = v; best = o; } }
      settle(m, new Set(best ? [best.id] : []));
    }
    if (m.outcomes.length) markets.push(m);
  }

  for (const m of markets) {
    for (const o of m.outcomes) if (o.state !== "open") o.history[o.history.length - 1] = o.p;
    sortOutcomes(m);
  }
  return {
    markets,
    checkpoints: cps,
    sinceLabel: prevIdx >= 0 ? labelLong(cps[prevIdx]) : null,
    season: d.season.year,
    asOfTitle: `${d.season.year} ${d.season.title}`,
  };
}

function labelLong(cp: Checkpoint) {
  if (cp.c === 0) return "preseason";
  if (cp.c <= 18) return `Week ${cp.c}`;
  return ({ 19: "the Wild Card round", 20: "the Divisional round", 21: "the Conference round", 23: "the Super Bowl" } as Record<number, string>)[cp.c] || cp.label;
}

