// /compare (Nick, 2026-11-28): two players side by side like Stathead's head-to-head page.
// By stats (default) or by Madden ratings. Stats are one season (default: the current league season,
// or any year: a league season or a real NFL season), league career totals, or career totals with
// real NFL seasons too. The better number in each row gets the green, like Stathead.
// The picture is drawn by compareImage.tsx; this file only works out the rows.
import { REG_SEASON_LAST_WEEK, addLine, indexes, passerRating, zeroTotals, type Totals } from "../league/derive";
import { leagueAwardsByYear } from "../league/load";
import { money } from "../league/format";
import { playerSeasons, seasonKey, type StatSeason } from "../league/playerSeasons";
import { RATING_KEYS, RATING_LABEL, type RatingKey } from "../league/ratings";
import { RATING_GROUPS, ratingFocus } from "../league/ratingGroups";
import { DEV_LABEL, type LeagueData, type Player } from "../league/types";

export type CompareBy = "stats" | "ratings";
/** season: one season · career: every league season · all: league seasons + real NFL seasons. */
export type CompareView = "season" | "career" | "all";
/** Which player's cell gets the green: 0 = first, 1 = second, -1 = neither (tie or not compared). */
export type Side = 0 | 1 | -1;
export type CmpRow = { label: string; a: string; b: string; win: Side; text?: boolean };
export type CmpSection = { title: string; rows: CmpRow[] };
export type Comparison = { title: string; sections: CmpSection[]; notes: string[]; edges: [number, number] };

const fmt = (n: number, dp = 0) => n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
/** Higher wins unless `low`; null on either side = no green. */
function side(a: number | null, b: number | null, low = false): Side {
  if (a == null || b == null || a === b) return -1;
  return (low ? a < b : a > b) ? 0 : 1;
}

// ---------- seasons in scope ----------

/** The league season with that year, else his real NFL one ("2025" finds 2025 NCL first, then 2025 NFL). */
export function findSeason(seasons: StatSeason[], want: string): StatSeason | undefined {
  const w = want.trim().toLowerCase();
  const yr = w.replace(/\D/g, "");
  return seasons.find((s) => seasonKey(s) === w)
    ?? (w.startsWith("nfl") ? undefined : seasons.find((s) => s.kind === "league" && String(s.year) === yr))
    ?? seasons.find((s) => seasonKey(s) === `nfl-${yr}`);
}

/** The season key /compare will use for a year box value (or the current season). Null if neither player has it. */
export function seasonKeyFor(d: LeagueData, a: StatSeason[], b: StatSeason[], year?: string): string | null {
  if (!year) return String(d.season.year);
  const s = findSeason(a, year) ?? findSeason(b, year);
  return s ? seasonKey(s) : null;
}

function inScope(seasons: StatSeason[], view: CompareView, key: string): StatSeason[] {
  if (view === "season") return seasons.filter((s) => seasonKey(s) === key);
  return view === "career" ? seasons.filter((s) => s.kind === "league") : seasons;
}

// ---------- stats ----------

type Entry = { key: string; team: string; post: boolean; result: "W" | "L" | "T" | null; line: Partial<Record<string, number>> };

/** Every regular-season and playoff game he has a line in (preseason left out). */
function entries(s: StatSeason, p: Player): Entry[] {
  const res = (us: number, them: number) => (us > them ? "W" : us < them ? "L" : "T") as Entry["result"];
  if (s.kind === "nfl") {
    return s.log.filter((e) => e.game.season === s.year).map(({ game: g, team, line }) => {
      const home = g.home === team;
      return { key: `nfl-${g.id}`, team, post: g.post, result: res(home ? g.hs : g.as, home ? g.as : g.hs), line: line as Entry["line"] };
    });
  }
  const { games } = indexes(s.d);
  const out: Entry[] = [];
  for (const l of s.d.lines) {
    if (l.p !== p.id) continue;
    const g = games.get(l.g);
    if (!g || g.stage !== 1) continue;
    const home = g.home === l.t;
    out.push({ key: `${s.year}-${g.id}`, team: String(l.t), post: g.week > REG_SEASON_LAST_WEEK, result: g.final ? res(home ? g.hs : g.as, home ? g.as : g.hs) : null, line: l as Entry["line"] });
  }
  return out;
}

type Rec = [w: number, l: number, t: number];
type Agg = { reg: Totals; rec: Rec; prec: Rec; games: Entry[] };

function aggregate(seasons: StatSeason[], p: Player): Agg {
  const reg = zeroTotals(), rec: Rec = [0, 0, 0], prec: Rec = [0, 0, 0];
  const games = seasons.flatMap((s) => entries(s, p));
  // QBs: record in games he really played QB in (10+ attempts), like Stathead's QBrec.
  const counts = (e: Entry) => p.pos !== "QB" || (e.line.pa ?? 0) >= 10;
  for (const e of games) {
    if (!e.post) addLine(reg, e.line);
    if (!e.result || !counts(e)) continue;
    const r = e.post ? prec : rec;
    r[e.result === "W" ? 0 : e.result === "L" ? 1 : 2]++;
  }
  return { reg, rec, prec, games };
}

const recText = (r: Rec) => (r[0] + r[1] + r[2] ? `${r[0]}-${r[1]}${r[2] ? `-${r[2]}` : ""}` : "–");
const recPct = (r: Rec) => (r[0] + r[1] + r[2] ? (r[0] + r[2] / 2) / (r[0] + r[1] + r[2]) : null);

/** opt: a stat real NFL logs or older builds may not track; the row is left out when both are 0. */
type StatDef = { label: string; v: (t: Totals) => number | null; dp?: number; low?: boolean; opt?: boolean; show?: (t: Totals) => string };
const per = (a: number, b: number) => (b ? a / b : null);
const pct = (a: number, b: number) => (b ? (a / b) * 100 : null);
const made = (m: keyof Totals, a: keyof Totals) => (t: Totals) => (t[a] ? `${t[m]}/${t[a]}` : "–");

const STAT_GROUPS: { key: string; title: string; rows: StatDef[]; volume: (t: Totals) => boolean }[] = [
  { key: "pass", title: "Passing", volume: (t) => t.pa >= 20, rows: [
    { label: "Cmp%", v: (t) => pct(t.pc, t.pa), dp: 1 },
    { label: "Pass Yds", v: (t) => (t.pa ? t.py : null) },
    { label: "Pass Y/A", v: (t) => per(t.py, t.pa), dp: 1 },
    { label: "Pass Y/G", v: (t) => (t.pa ? per(t.py, t.gp) : null), dp: 1 },
    { label: "Pass TD", v: (t) => (t.pa ? t.ptd : null) },
    { label: "Int", v: (t) => (t.pa ? t.pint : null), low: true },
    { label: "Rate", v: (t) => (t.pa ? passerRating(t) : null), dp: 1 },
    { label: "Sacked", v: (t) => (t.pa ? t.psk : null), low: true },
  ] },
  { key: "rush", title: "Rushing", volume: (t) => t.ra >= 20, rows: [
    { label: "Rush Att", v: (t) => (t.ra ? t.ra : null) },
    { label: "Rush Yds", v: (t) => (t.ra ? t.ry : null) },
    { label: "Rush Y/A", v: (t) => per(t.ry, t.ra), dp: 1 },
    { label: "Rush Y/G", v: (t) => (t.ra ? per(t.ry, t.gp) : null), dp: 1 },
    { label: "Rush TD", v: (t) => (t.ra ? t.rtd : null) },
    { label: "Broken tkl", opt: true, v: (t) => (t.ra ? t.rbt : null) },
    { label: "Fumbles", v: (t) => (t.ra || t.rc ? t.rfum : null), low: true },
  ] },
  { key: "rec", title: "Receiving", volume: (t) => t.rc >= 10, rows: [
    { label: "Rec", v: (t) => (t.rc ? t.rc : null) },
    { label: "Rec Yds", v: (t) => (t.rc ? t.rcy : null) },
    { label: "Y/Rec", v: (t) => per(t.rcy, t.rc), dp: 1 },
    { label: "Rec Y/G", v: (t) => (t.rc ? per(t.rcy, t.gp) : null), dp: 1 },
    { label: "Rec TD", v: (t) => (t.rc ? t.rctd : null) },
    { label: "YAC", opt: true, v: (t) => (t.rc ? t.rcyac : null) },
    { label: "Drops", opt: true, v: (t) => (t.rc ? t.rcdrop : null), low: true },
  ] },
  { key: "def", title: "Defense", volume: (t) => t.tk >= 30 || t.sk >= 3 || t.int >= 2, rows: [
    { label: "Tackles", v: (t) => t.tk },
    { label: "Sacks", v: (t) => t.sk, dp: 1, show: (t) => (Number.isInteger(t.sk) ? fmt(t.sk) : fmt(t.sk, 1)) },
    { label: "Int", v: (t) => t.int },
    { label: "Pass def", v: (t) => t.pd },
    { label: "Forced fum", v: (t) => t.ff },
    { label: "Fum rec", opt: true, v: (t) => t.fr },
    { label: "Def TD", opt: true, v: (t) => t.dtd },
  ] },
  { key: "kick", title: "Kicking", volume: (t) => t.fga >= 3, rows: [
    { label: "FG", v: (t) => (t.fga ? t.fgm : null), show: made("fgm", "fga") },
    { label: "FG%", v: (t) => pct(t.fgm, t.fga), dp: 1 },
    { label: "FG long", v: (t) => (t.fga ? t.fglng : null) },
    { label: "XP", v: (t) => (t.xpa ? t.xpm : null), show: made("xpm", "xpa") },
  ] },
  { key: "punt", title: "Punting", volume: (t) => t.pnt >= 5, rows: [
    { label: "Punts", v: (t) => (t.pnt ? t.pnt : null) },
    { label: "Avg", v: (t) => per(t.pnty, t.pnt), dp: 1 },
    { label: "Net avg", v: (t) => per(t.pntnet, t.pnt), dp: 1 },
    { label: "Inside 20", v: (t) => (t.pnt ? t.pnt20 : null) },
  ] },
];

const DEF_POS = new Set(["LE", "RE", "DT", "LEDG", "REDG", "LOLB", "MLB", "ROLB", "SAM", "MIKE", "WILL", "CB", "FS", "SS"]);
const POS_GROUPS: Record<string, string[]> = { QB: ["pass", "rush"], HB: ["rush", "rec"], FB: ["rush", "rec"], WR: ["rec"], TE: ["rec"], K: ["kick"], P: ["punt"] };
const posGroups = (pos: string) => POS_GROUPS[pos] ?? (DEF_POS.has(pos) ? ["def"] : []);
// Standard (non-PPR) fantasy points, like Stathead's FantPt.
const fantasy = (t: Totals) => t.py * 0.04 + t.ptd * 4 - t.pint * 2 + (t.ry + t.rcy) * 0.1 + (t.rtd + t.rctd) * 6 - t.rfum * 2;

function statRow(d: StatDef, a: Totals, b: Totals): CmpRow {
  const va = d.v(a), vb = d.v(b);
  const show = (t: Totals, v: number | null) => (d.show ? d.show(t) : v == null ? "–" : fmt(v, d.dp ?? 0));
  return { label: d.label, a: show(a, va), b: show(b, vb), win: side(va, vb, d.low) };
}

/** Award keys (markets.ts) → the honor's short name. Position awards share one row. */
function awardName(key: string): string | null {
  const m = /^award-([a-z]+)(?:-[a-z]+)?$/.exec(key);
  if (!m || m[1] === "coy") return null;
  return { mvp: "MVP", opoy: "OPOY", dpoy: "DPOY", oroy: "OROY", droy: "DROY" }[m[1]] ?? "Position POY";
}
const HONORS = ["MVP", "OPOY", "DPOY", "OROY", "DROY", "Position POY"];

async function honors(slug: string, a: Player, b: Player, years: number[]): Promise<CmpSection | null> {
  if (!years.length) return null;
  const all = await leagueAwardsByYear(slug);
  const count = new Map<string, [number, number]>();
  for (const y of years) {
    for (const [key, id] of Object.entries(all[String(y)] ?? {})) {
      const name = awardName(key);
      const k = String(id) === String(a.id) ? 0 : String(id) === String(b.id) ? 1 : null;
      if (!name || k == null) continue;
      const c = count.get(name) ?? [0, 0];
      c[k]++;
      count.set(name, c);
    }
  }
  const rows = HONORS.filter((h) => count.has(h)).map((h) => {
    const [x, y] = count.get(h)!;
    return { label: h, a: x ? String(x) : "", b: y ? String(y) : "", win: side(x, y) };
  });
  return rows.length ? { title: "Awards", rows } : null;
}

async function statsComparison(slug: string, d: LeagueData, league: string, a: Player, b: Player, view: CompareView, year?: string): Promise<Comparison | string> {
  const [sa, sb] = await Promise.all([playerSeasons(slug, d, a), playerSeasons(slug, d, b)]);
  const key = seasonKeyFor(d, sa, sb, year);
  if (view === "season" && !key) return `Neither player has a ${year} season (league seasons, or real NFL seasons 2004-2025).`;
  const k = key ?? String(d.season.year);
  const scopeA = inScope(sa, view, k), scopeB = inScope(sb, view, k);
  const A = aggregate(scopeA, a), B = aggregate(scopeB, b);
  const nfl = k.startsWith("nfl-");
  const title = view === "season" ? (nfl ? `${k.slice(4)} NFL season` : `${k} ${league} season`)
    : view === "career" ? `${league} career totals` : `Career totals · ${league} + real NFL`;

  const sections: CmpSection[] = [];
  // Head-to-head: games they played against each other (any season in scope), from the first player's side.
  const mine = new Map(A.games.map((e) => [e.key, e]));
  const h2h: Record<"reg" | "post", Rec> = { reg: [0, 0, 0], post: [0, 0, 0] };
  for (const e of B.games) {
    const x = mine.get(e.key);
    if (!x || x.team === e.team || !x.result) continue;
    h2h[x.post ? "post" : "reg"][x.result === "W" ? 0 : x.result === "L" ? 1 : 2]++;
  }
  const flip = (r: Rec): Rec => [r[1], r[0], r[2]];
  const h2hRows = (["reg", "post"] as const).filter((s) => h2h[s].some(Boolean)).map((s) => ({
    label: s === "reg" ? "Reg season" : "Playoffs", a: recText(h2h[s]), b: recText(flip(h2h[s])), win: side(h2h[s][0], h2h[s][1]),
  }));
  if (h2hRows.length) sections.push({ title: "Head-to-head", rows: h2hRows });

  const ta = A.reg, tb = B.reg;
  const bothQb = a.pos === "QB" && b.pos === "QB";
  const overall: CmpRow[] = [
    { label: "G", a: fmt(ta.gp), b: fmt(tb.gp), win: side(ta.gp, tb.gp) },
    { label: bothQb ? "QB rec" : "Team rec", a: recText(A.rec), b: recText(B.rec), win: side(recPct(A.rec), recPct(B.rec)) },
  ];
  if (A.prec.some(Boolean) || B.prec.some(Boolean)) overall.push({ label: "Playoff rec", a: recText(A.prec), b: recText(B.prec), win: side(A.prec[0], B.prec[0]) });
  sections.push({ title: "Overall", rows: overall });

  const wanted = new Set([...posGroups(a.pos), ...posGroups(b.pos)]);
  const groups = STAT_GROUPS.filter((g) => wanted.has(g.key) || g.volume(ta) || g.volume(tb));
  for (const g of groups) sections.push({ title: g.title, rows: g.rows.filter((r) => !r.opt || r.v(ta) || r.v(tb)).map((r) => statRow(r, ta, tb)) });
  if (groups.some((g) => ["pass", "rush", "rec"].includes(g.key))) {
    const fa = ta.gp ? fantasy(ta) : null, fb = tb.gp ? fantasy(tb) : null;
    sections.push({ title: "Fantasy", rows: [{ label: "FantPt", a: fa == null ? "–" : fmt(fa, 1), b: fb == null ? "–" : fmt(fb, 1), win: side(fa, fb) }] });
  }

  const awardYears = [...new Set([...scopeA, ...scopeB].filter((s) => s.kind === "league").map((s) => s.year))];
  const hon = await honors(slug, a, b, awardYears);
  if (hon) sections.push(hon);

  const notes = ["Regular-season stats; playoffs count only in the records"];
  if (bothQb) notes.push("QB rec = games with 10+ pass attempts");
  for (const [p, t] of [[a, ta], [b, tb]] as const) if (!t.gp) notes.push(`${p.first} ${p.last} has no regular-season games here`);
  if ([...scopeA, ...scopeB].some((s) => s.kind === "league" && s.d.partialStats)) notes.push("Some seasons only have partial stats saved");
  if (nfl || view === "all") notes.push("Real NFL games from nflverse");
  return finish(title, sections, notes);
}

// ---------- ratings ----------

const val = (p: Player, k: RatingKey) => p.ratings?.[RATING_KEYS.indexOf(k)] ?? null;
const height = (inches: number) => (inches ? `${Math.floor(inches / 12)}'${inches % 12}"` : "–");

function ratingsComparison(d: LeagueData, a: Player, b: Player): Comparison {
  const capYear = d.season.capYear ?? d.season.year;
  const sections: CmpSection[] = [{ title: "Player", rows: [
    { label: "OVR", a: String(a.ovr), b: String(b.ovr), win: side(a.ovr, b.ovr) },
    { label: "Dev", a: DEV_LABEL[a.dev], b: DEV_LABEL[b.dev], win: side(a.dev, b.dev) },
    { label: "Age", a: String(a.age), b: String(b.age), win: -1 },
    { label: "Ht / Wt", a: `${height(a.height)} · ${a.weight}`, b: `${height(b.height)} · ${b.weight}`, win: -1 },
    { label: "Exp", a: a.yearsPro ? `${a.yearsPro} yr${a.yearsPro === 1 ? "" : "s"}` : "Rookie", b: b.yearsPro ? `${b.yearsPro} yr${b.yearsPro === 1 ? "" : "s"}` : "Rookie", win: -1 },
    { label: `${capYear} cap hit`, a: a.team ? money(a.contract.capHit) : "FA", b: b.team ? money(b.contract.capHit) : "FA", win: -1 },
    { label: "Yrs left", a: a.team ? String(a.contract.yearsLeft) : "–", b: b.team ? String(b.contract.yearsLeft) : "–", win: -1 },
  ] }];
  // Physical first, then the groups that matter for either position (a QB vs a WR gets Passing and Receiving).
  const focus = [...new Set([...ratingFocus(a.pos), ...ratingFocus(b.pos)])];
  const names = ["Physical", ...focus];
  for (const name of names) {
    const keys = RATING_GROUPS.find(([n]) => n === name)?.[1] ?? [];
    sections.push({ title: name, rows: keys.map((k) => {
      const x = val(a, k), y = val(b, k);
      return { label: RATING_LABEL[k] ?? k, a: x == null ? "–" : String(x), b: y == null ? "–" : String(y), win: side(x, y) };
    }) });
  }
  const ab = (p: Player) => p.abilities.map((x) => x.title).join(", ") || "None";
  sections.push({ title: "Abilities", rows: [{ label: "", a: ab(a), b: ab(b), win: -1, text: true }] });
  const notes = [`Madden ratings as of the last sync (${d.season.year} ${d.season.title})`];
  if (!a.ratings || !b.ratings) notes.push("Some ratings are missing until the next sync");
  return finish("Madden ratings", sections, notes);
}

function finish(title: string, sections: CmpSection[], notes: string[]): Comparison {
  const edges: [number, number] = [0, 0];
  for (const s of sections) for (const r of s.rows) if (r.win !== -1) edges[r.win]++;
  return { title, sections, notes, edges };
}

/** The comparison, or a message saying why there isn't one. */
export async function comparePlayers(slug: string, d: LeagueData, league: string, a: Player, b: Player, by: CompareBy, view: CompareView, year?: string): Promise<Comparison | string> {
  return by === "ratings" ? ratingsComparison(d, a, b) : statsComparison(slug, d, league, a, b, view, year);
}
