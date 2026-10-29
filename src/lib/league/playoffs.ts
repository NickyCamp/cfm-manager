// Playoff picture and draft order with the NFL's tiebreaking procedures
// (nfl.com/standings/tie-breaking-procedures), computed from the league's
// regular-season results. Ported from the NCL site's playoffs.js / draft.js.
//
// Ties count as half a win. Only one club advances per tiebreaker step; when
// clubs drop out of a tie the procedure restarts from step 1 with the rest.
// Stand-ins: "net touchdowns" counts rushing, receiving and defensive TDs from
// the box scores (return TDs aren't exported), and a coin toss is replaced by
// alphabetical order.

import type { LeagueData, Team } from "./types";

export const REG_WEEKS = 18; // weeks 0-17 are the regular season; 18+ playoffs

type GameRow = { opp: number; pf: number; pa: number; res: number; conf: boolean; div: boolean; tdf: number; tda: number };
export type Club = {
  id: number; team: Team; name: string; abbr: string; conf: string; div: string;
  games: GameRow[]; left: number; opps: number[]; // opps = full regular-season schedule (played + to play)
  w: number; l: number; t: number; pts: number; gp: number; pct: number; maxPts: number; pf: number; pa: number;
  leagueRank: number; confRank: number;
};
type Step = { label: string; detail?: string; out?: Club[] };
export type Ordered = { c: Club; tiedWith: Club[]; story: Step[] };
export type Seed = Ordered & { seed: number; mark: "" | "*" | "z" | "x" | "e"; how: string };

export const recText = (w: number, l: number, t: number) => `${w}-${l}${t ? `-${t}` : ""}`;
function rec(games: GameRow[]) {
  const w = games.filter((g) => g.res === 1).length, l = games.filter((g) => g.res === 0).length, t = games.filter((g) => g.res === 0.5).length;
  return { pct: games.length ? (w + t / 2) / games.length : 0, n: games.length, text: recText(w, l, t) };
}
export const divRecord = (c: Club) => rec(c.games.filter((g) => g.div)).text;
export const confRecord = (c: Club) => rec(c.games.filter((g) => g.conf)).text;
const fmtNet = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const pct3 = (x: number) => x.toFixed(3).replace(/^0/, "");
const EPS = 1e-9;

function build(d: LeagueData) {
  const T = new Map<number, Club>();
  for (const t of d.teams) {
    T.set(t.id, {
      id: t.id, team: t, name: `${t.city} ${t.name}`, abbr: t.abbr, conf: t.conference, div: t.division, games: [], left: 0, opps: [],
      w: 0, l: 0, t: 0, pts: 0, gp: 0, pct: 0, maxPts: 0, pf: 0, pa: 0, leagueRank: 0, confRank: 0,
    });
  }
  // touchdowns by game and team from the box scores
  const tds = new Map<string, number>();
  for (const s of d.lines) {
    const n = (s.rtd || 0) + (s.rctd || 0) + (s.dtd || 0);
    if (n) tds.set(`${s.g}:${s.t}`, (tds.get(`${s.g}:${s.t}`) || 0) + n);
  }
  for (const g of d.games) {
    if (g.stage !== 1 || g.week >= REG_WEEKS) continue;
    const h = T.get(g.home), a = T.get(g.away);
    if (!h || !a) continue;
    h.opps.push(a.id); a.opps.push(h.id);
    if (!g.final) { h.left++; a.left++; continue; }
    const add = (me: Club, op: Club, pf: number, pa: number) => me.games.push({
      opp: op.id, pf, pa, res: pf > pa ? 1 : pf < pa ? 0 : 0.5, conf: me.conf === op.conf, div: me.div === op.div,
      tdf: tds.get(`${g.id}:${me.id}`) || 0, tda: tds.get(`${g.id}:${op.id}`) || 0,
    });
    add(h, a, g.hs, g.as);
    add(a, h, g.as, g.hs);
  }
  const all = [...T.values()];
  for (const c of all) {
    c.w = c.games.filter((g) => g.res === 1).length;
    c.l = c.games.filter((g) => g.res === 0).length;
    c.t = c.games.filter((g) => g.res === 0.5).length;
    c.pts = c.w + c.t / 2; c.gp = c.games.length; c.pct = c.gp ? c.pts / c.gp : 0; c.maxPts = c.pts + c.left;
    c.pf = c.games.reduce((s, g) => s + g.pf, 0); c.pa = c.games.reduce((s, g) => s + g.pa, 0);
  }
  // combined ranking in points scored + points allowed (ties share a rank)
  const rankBy = (list: Club[], key: "pf" | "pa", desc: boolean) =>
    new Map(list.map((c) => [c.id, 1 + list.filter((o) => (desc ? o[key] > c[key] : o[key] < c[key])).length]));
  const lpf = rankBy(all, "pf", true), lpa = rankBy(all, "pa", false);
  for (const c of all) c.leagueRank = lpf.get(c.id)! + lpa.get(c.id)!;
  for (const conf of new Set(all.map((c) => c.conf))) {
    const cl = all.filter((c) => c.conf === conf);
    const cpf = rankBy(cl, "pf", true), cpa = rankBy(cl, "pa", false);
    for (const c of cl) c.confRank = cpf.get(c.id)! + cpa.get(c.id)!;
  }
  return T;
}

type Measure = { label: string; val: (c: Club) => number | null; show: (c: Club) => string };
function measures(T: Map<number, Club>, group: Club[], mode: "div" | "wc"): Record<string, Measure> {
  const ids = new Set(group.map((c) => c.id));
  let common = null as Set<number> | null;
  for (const c of group) {
    const o = new Set(c.games.map((g) => g.opp).filter((x) => !ids.has(x)));
    common = common ? new Set([...common].filter((x: number) => o.has(x))) : o;
  }
  const cm = common || new Set<number>();
  const sov = (c: Club) => {
    let w = 0, n = 0;
    for (const g of c.games) if (g.res > 0) { const o = T.get(g.opp)!; w += o.pts * g.res; n += o.gp * g.res; }
    return n ? w / n : 0;
  };
  const sos = (c: Club) => {
    let w = 0, n = 0;
    for (const g of c.games) { const o = T.get(g.opp)!; w += o.pts; n += o.gp; }
    return n ? w / n : 0;
  };
  const net = (gs: GameRow[]) => gs.reduce((s, g) => s + g.pf - g.pa, 0);
  const netTd = (c: Club) => c.games.reduce((s, g) => s + g.tdf - g.tda, 0);
  const recM = (label: string, f: (c: Club) => GameRow[], minGames = 0): Measure => ({
    label, val: (c) => { const r = rec(f(c)); return minGames && r.n < minGames ? null : r.pct; }, show: (c) => rec(f(c)).text,
  });
  return {
    h2h: recM("Head-to-head", (c) => c.games.filter((g) => ids.has(g.opp))),
    div: recM("Division record", (c) => c.games.filter((g) => g.div)),
    common: recM("Record vs. common opponents", (c) => c.games.filter((g) => cm.has(g.opp)), mode === "wc" ? 4 : 0),
    conf: recM("Conference record", (c) => c.games.filter((g) => g.conf)),
    sov: { label: "Strength of victory", val: sov, show: (c) => pct3(sov(c)) },
    sos: { label: "Strength of schedule", val: sos, show: (c) => pct3(sos(c)) },
    confRank: { label: "Conference points rank (scored + allowed)", val: (c) => -c.confRank, show: (c) => String(c.confRank) },
    leagueRank: { label: "League points rank (scored + allowed)", val: (c) => -c.leagueRank, show: (c) => String(c.leagueRank) },
    netCommon: { label: "Net points vs. common opponents", val: (c) => net(c.games.filter((g) => cm.has(g.opp))), show: (c) => fmtNet(net(c.games.filter((g) => cm.has(g.opp)))) },
    netConf: { label: "Net points in conference games", val: (c) => net(c.games.filter((g) => g.conf)), show: (c) => fmtNet(net(c.games.filter((g) => g.conf))) },
    netAll: { label: "Net points", val: (c) => net(c.games), show: (c) => fmtNet(net(c.games)) },
    netTd: { label: "Net touchdowns", val: netTd, show: (c) => fmtNet(netTd(c)) },
    coin: { label: "Coin toss (alphabetical stand-in)", val: (c) => -c.name.charCodeAt(0) * 1000 - (c.name.charCodeAt(1) || 0), show: () => "" },
    // 3+ club wild-card ties: head-to-head only counts as a sweep
    sweep: {
      label: "Head-to-head sweep",
      val: (c) => {
        const others = group.filter((o) => o.id !== c.id);
        const vs = (o: Club) => c.games.filter((g) => g.opp === o.id);
        if (others.every((o) => vs(o).length && vs(o).every((g) => g.res === 1))) return 1;
        if (others.every((o) => vs(o).length && vs(o).every((g) => g.res === 0))) return -1;
        return 0;
      },
      show: (c) => rec(c.games.filter((g) => ids.has(g.opp))).text,
    },
  };
}

const STEPS = {
  div: ["h2h", "div", "common", "conf", "sov", "sos", "confRank", "leagueRank", "netCommon", "netAll", "netTd", "coin"],
  wc2: ["h2h", "conf", "common", "sov", "sos", "confRank", "leagueRank", "netConf", "netAll", "netTd", "coin"],
  wc3: ["sweep", "conf", "common", "sov", "sos", "confRank", "leagueRank", "netConf", "netAll", "netTd", "coin"],
};
const byName = (a: Club, b: Club) => a.name.localeCompare(b.name);

/** The one club that wins a tie. */
function breakTie(T: Map<number, Club>, group: Club[], mode: "div" | "wc", divOrder?: Map<string, Club[]>): { c: Club; story: Step[] } {
  let g = group.slice();
  const story: Step[] = [];
  for (let guard = 0; guard < 20; guard++) {
    if (g.length === 1) return { c: g[0], story };
    let kind: keyof typeof STEPS | "wc2noh2h" = mode === "div" ? "div" : g.length === 2 ? "wc2" : "wc3";
    if (mode !== "div") {
      if (new Set(g.map((c) => c.div)).size === 1) kind = "div";
      else if (g.length > 2 && divOrder) {
        // step 1: only the highest-ranked club from each division stays in a wild-card tie
        const rank = (c: Club) => divOrder.get(c.div)!.indexOf(c);
        const keep = g.filter((c) => !g.some((o) => o.div === c.div && rank(o) < rank(c)));
        if (keep.length < g.length) {
          story.push({ label: "Only the top club from each division stays in a wild-card tie", out: g.filter((c) => !keep.includes(c)) });
          g = keep;
          continue;
        }
      }
      if (g.length === 2 && kind !== "div") kind = g[0].games.some((x) => x.opp === g[1].id) ? "wc2" : "wc2noh2h";
    }
    const steps = kind === "wc2noh2h" ? STEPS.wc2.slice(1) : STEPS[kind];
    const M = measures(T, g, mode);
    let moved = false;
    for (const s of steps) {
      const m = M[s];
      const vals = g.map((c) => m.val(c));
      if (vals.some((v) => v == null)) continue; // e.g. fewer than four common games
      const best = Math.max(...(vals as number[]));
      const top = g.filter((_, i) => Math.abs((vals[i] as number) - best) < EPS);
      if (top.length === g.length) continue;
      const detail = g.map((c) => { const v = m.show(c); return v ? `${c.abbr} ${v}` : ""; }).filter(Boolean).join(", ");
      story.push({ label: m.label, detail, out: g.filter((c) => !top.includes(c)) });
      if (top.length === 1) return { c: top[0], story };
      g = top;
      moved = true;
      break;
    }
    if (!moved) return { c: g.sort(byName)[0], story };
  }
  return { c: g[0], story };
}

/** Orders clubs by record; ties are settled one club at a time. */
function order(T: Map<number, Club>, list: Club[], mode: "div" | "wc", divOrder?: Map<string, Club[]>): Ordered[] {
  const left = list.slice(), out: Ordered[] = [];
  while (left.length) {
    const best = Math.max(...left.map((c) => c.pct));
    const tied = left.filter((c) => Math.abs(c.pct - best) < EPS);
    const r = tied.length === 1 ? { c: tied[0], story: [] } : breakTie(T, tied, mode, divOrder);
    out.push({ c: r.c, tiedWith: tied.length > 1 ? tied.filter((x) => x !== r.c) : [], story: r.story });
    left.splice(left.indexOf(r.c), 1);
  }
  return out;
}

export function tieNote(r: Ordered) {
  if (!r.tiedWith.length) return "";
  const last = r.story[r.story.length - 1];
  const vs = r.tiedWith.map((c) => c.abbr).join(", ");
  if (!last) return `Tied with ${vs}`;
  return `Ahead of ${vs} on ${last.label.toLowerCase()}${last.detail ? ` (${last.detail})` : ""}`;
}

export type Picture = {
  T: Map<number, Club>;
  conf: Record<string, Seed[]>;     // every club in the conference, seeds 1-7 first
  divRows: Map<string, Ordered[]>;
  throughWeek: number;              // last regular-season week with a final (1-based), 0 if none
  regularSeasonDone: boolean;
};

const cache = new WeakMap<object, Picture>();
export function playoffPicture(d: LeagueData): Picture {
  const hit = cache.get(d);
  if (hit) return hit;
  const T = build(d);
  const all = [...T.values()];
  const divOrder = new Map<string, Club[]>(), divRows = new Map<string, Ordered[]>();
  for (const div of [...new Set(all.map((c) => c.div))].sort()) {
    const rows = order(T, all.filter((c) => c.div === div), "div");
    divRows.set(div, rows);
    divOrder.set(div, rows.map((r) => r.c));
  }
  const conf: Record<string, Seed[]> = {};
  for (const cf of [...new Set(all.map((c) => c.conf))].sort()) {
    const winners = [...divOrder.entries()].filter(([dv]) => T.get(divOrder.get(dv)![0].id)!.conf === cf).map(([, l]) => l[0]);
    const winRows = order(T, winners, "wc", divOrder);
    const restRows = order(T, all.filter((c) => c.conf === cf && !winners.includes(c)), "wc", divOrder);
    const cl = all.filter((c) => c.conf === cf);
    const seeds: Seed[] = [...winRows, ...restRows].map((r, i) => ({ ...r, seed: i + 1, mark: "", how: i < winRows.length ? "Division winner" : "Wild card" }));
    // clinch / elimination marks; conservative (ignores who plays whom in the games left)
    for (const s of seeds) {
      const c = s.c;
      const rivals = cl.filter((o) => o.div === c.div && o !== c), others = cl.filter((o) => o !== c);
      if (others.every((o) => o.maxPts < c.pts)) s.mark = "*";
      else if (rivals.every((o) => o.maxPts < c.pts)) s.mark = "z";
      else if (others.filter((o) => o.maxPts >= c.pts).length <= 6) s.mark = "x";
      else if (rivals.some((o) => o.pts > c.maxPts) && others.filter((o) => o.pts > c.maxPts).length >= 7) s.mark = "e";
    }
    conf[cf] = seeds;
  }
  const played = d.games.filter((g) => g.stage === 1 && g.week < REG_WEEKS && g.final && g.home && g.away);
  const throughWeek = played.length ? Math.max(...played.map((g) => g.week)) + 1 : 0;
  const regularSeasonDone = all.every((c) => c.left === 0) && played.length > 0;
  const pic = { T, conf, divRows, throughWeek, regularSeasonDone };
  cache.set(d, pic);
  return pic;
}

// ---------------- draft order ----------------

export const PLAYOFF_ROUNDS: [number, string][] = [[18, "Wild Card"], [19, "Divisional"], [20, "Conference Championship"], [22, "Super Bowl"]];

/** Who wins a tie between clubs from anywhere in the league (the winner picks later). */
function draftTieWinner(T: Map<number, Club>, group: Club[], divOrder: Map<string, Club[]>) {
  if (new Set(group.map((c) => c.div)).size === 1) return breakTie(T, group, "div", divOrder);
  if (new Set(group.map((c) => c.conf)).size === 1) return breakTie(T, group, "wc", divOrder);
  // interconference: head-to-head (two clubs that met), common games (min 4), SOV, league points rank, net points, net TDs, coin
  const M = measures(T, group, "wc");
  const steps = ["common", "sov", "leagueRank", "netAll", "netTd", "coin"];
  if (group.length === 2 && group[0].games.some((g) => g.opp === group[1].id)) steps.unshift("h2h");
  let g = group.slice();
  for (const s of steps) {
    const vals = g.map((c) => M[s].val(c));
    if (vals.some((v) => v == null)) continue;
    const best = Math.max(...(vals as number[]));
    const top = g.filter((_, i) => Math.abs((vals[i] as number) - best) < EPS);
    if (top.length < g.length) {
      const story: Step[] = [{ label: M[s].label, detail: g.map((c) => `${c.abbr} ${M[s].show(c)}`).join(", ") }];
      if (top.length === 1) return { c: top[0], story };
      g = top;
    }
  }
  return { c: g.sort(byName)[0], story: [{ label: "Coin toss (alphabetical stand-in)" }] as Step[] };
}

export type DraftSlot = { c: Club; why: string; group: number; tiedGroup: number }; // tiedGroup: id of the same-record block (rotates in later rounds)
export const DRAFT_GROUP: Record<number, string> = {
  1: "Non-playoff", 2: "Lost in the Wild Card round", 3: "Lost in the Divisional round", 4: "Lost in the Conference Championship",
  5: "Lost the Super Bowl", 6: "Super Bowl champion",
};

/**
 * Draft order (nfl.com, "Draft selection order"): 1-18 non-playoff clubs, worst
 * record first; then Wild Card, Divisional and Conference losers, the Super Bowl
 * loser and the champion, each group worst record first. Ties: lowest strength
 * of schedule picks first, then the tiebreakers (the winner picks later).
 * Before the playoffs, the current top 7 seeds per conference are the playoff group.
 */
export function draftOrder(d: LeagueData) {
  const pic = playoffPicture(d);
  const { T } = pic;
  // strength of schedule over the full regular-season schedule, at opponents' current records
  const sos = new Map<number, number>();
  for (const [id, c] of T) {
    let w = 0, n = 0;
    for (const o of c.opps) { const x = T.get(o)!; w += x.pts; n += x.gp; }
    sos.set(id, n ? w / n : 0);
  }
  const divOrder = new Map([...pic.divRows.entries()].map(([dv, rows]) => [dv, rows.map((r) => r.c)]));
  const exit = new Map<number, number>([...T.keys()].map((id) => [id, 1]));
  for (const seeds of Object.values(pic.conf)) for (const s of seeds.slice(0, 7)) exit.set(s.c.id, 2);
  const po = d.games.filter((g) => g.stage === 1 && g.week >= REG_WEEKS && g.home && g.away);
  const realPlayoffs = po.some((g) => g.final);
  const roundGroup: Record<number, number> = { 18: 2, 19: 3, 20: 4, 22: 5 };
  for (const g of po) {
    if (!g.final) continue;
    const grp = roundGroup[g.week] || 2;
    const loser = g.hs > g.as ? g.away : g.home, winner = loser === g.home ? g.away : g.home;
    exit.set(loser, grp);
    exit.set(winner, g.week === 22 ? 6 : Math.max(exit.get(winner) || 1, grp + 1));
  }

  const slots: DraftSlot[] = [];
  let block = 0;
  for (const grp of [1, 2, 3, 4, 5, 6]) {
    const clubs = [...T.values()].filter((c) => exit.get(c.id) === grp);
    const byPct = new Map<string, Club[]>();
    for (const c of clubs) { const k = c.pct.toFixed(6); byPct.set(k, [...(byPct.get(k) || []), c]); }
    for (const k of [...byPct.keys()].sort((a, b) => Number(a) - Number(b))) {
      const tied = byPct.get(k)!;
      block++;
      const seg: DraftSlot[] = [];
      const bySos = new Map<string, Club[]>();
      for (const c of tied) { const s = sos.get(c.id)!.toFixed(6); bySos.set(s, [...(bySos.get(s) || []), c]); }
      for (const s of [...bySos.keys()].sort((a, b) => Number(a) - Number(b))) {
        const left = bySos.get(s)!.slice(), tail: DraftSlot[] = [];
        while (left.length > 1) {
          const { c, story } = draftTieWinner(T, left, divOrder);
          tail.unshift({ c, group: grp, tiedGroup: block, why: `Same record and strength of schedule as ${left.filter((x) => x !== c).map((x) => x.abbr).join(", ")}; picks later after winning on ${(story[story.length - 1]?.label || "tiebreaker").toLowerCase()}` });
          left.splice(left.indexOf(c), 1);
        }
        if (left.length) tail.unshift({ c: left[0], group: grp, tiedGroup: block, why: "" });
        seg.push(...tail);
      }
      if (tied.length > 1) for (const x of seg) {
        if (!x.why) x.why = `Tied at ${recText(x.c.w, x.c.l, x.c.t)} with ${tied.filter((y) => y !== x.c).map((y) => y.abbr).join(", ")}; lower strength of schedule picks first`;
      }
      slots.push(...seg);
    }
  }
  return { slots, sos, realPlayoffs, pic };
}

/** Round r's order: clubs tied on record rotate (the top of each tied block moves to the bottom each round). */
export function roundOrder(slots: DraftSlot[], r: number) {
  const out: (DraftSlot & { tied: boolean })[] = [];
  for (let i = 0; i < slots.length;) {
    let j = i;
    while (j < slots.length && slots[j].tiedGroup === slots[i].tiedGroup) j++;
    const seg = slots.slice(i, j);
    const shift = seg.length > 1 ? (r - 1) % seg.length : 0;
    for (const x of [...seg.slice(shift), ...seg.slice(0, shift)]) out.push({ ...x, tied: seg.length > 1 });
    i = j;
  }
  return out;
}
