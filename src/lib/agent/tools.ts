// The agent API's tools (Nick, 2026-11-24). One definition serves both doors:
//   • MCP (/api/mcp): each tool below is an MCP tool an AI agent can call.
//   • REST (/api/v1/l/<slug>/<tool>): the same tool, args from the query string, JSON back.
//
// Answers are deliberately small and pre-digested (names, records, "$45.2M") rather than raw EA
// fields, so an agent can talk about the league without drowning in a 5 MB data file or inventing
// numbers. Everything is read-only and comes from the same helpers the site pages use.

import { getLeagueData, getLeagueHistory } from "@/lib/league/load";
import {
  LEADER_CATS, boxScore, capSeason, committedByTeam, capYears, defaultScoresWeek, gamesForWeek, indexes, inferredDeadCap,
  passerRating, record, seasonTotals, streakText, teamCapProjection, teamPlayers, weekTitle, type Totals,
} from "@/lib/league/derive";
import { projectPlayer } from "@/lib/league/projection";
import { playoffPicture, draftOrder, REG_WEEKS } from "@/lib/league/playoffs";
import { buildDevTracker, STAT_LABEL } from "@/lib/league/dev";
import { RATING_KEYS, RATING_LABEL } from "@/lib/league/ratings";
import { lineText, playerSeasons, seasonLabel, seasonLog, seasonRow, totalsText } from "@/lib/league/playerSeasons";
import { leagueCap, projectedLeagueCap, CAP_GROWTH_PER_YEAR } from "@/lib/league/cap";
import { DEV_LABEL, type Game, type LeagueData, type Player, type Team } from "@/lib/league/types";
import type { TxEvent } from "@/lib/league/history";
import { weekDigest } from "./digest";

// ---------- small formatters ----------

export const $m = (n: number | null | undefined) => (n == null ? null : `${n < 0 ? "-" : ""}$${(Math.abs(n) / 1e6).toFixed(Math.abs(n) >= 1e7 ? 1 : 2)}M`);
export const teamName = (t?: Team) => (t ? `${t.city} ${t.name}` : "Free agent");
export const pname = (p?: Player) => (p ? (p.nick ? `${p.first} "${p.nick}" ${p.last}` : `${p.first} ${p.last}`) : "Unknown");
export const devName = (dev: number) => DEV_LABEL[dev] ?? "Normal";
const heightText = (inches: number) => (inches ? `${Math.floor(inches / 12)}'${inches % 12}"` : null);

export class ToolError extends Error {}

/** Short player card used in lists. */
export function playerBrief(d: LeagueData, p: Player) {
  const t = d.teams.find((x) => x.id === p.team);
  return {
    id: p.id, name: pname(p), pos: p.pos, team: t?.abbr ?? "FA", ovr: p.ovr, dev: devName(p.dev), age: p.age,
    ...(p.team ? { cap_hit: $m(p.contract.capHit), years_left: p.contract.yearsLeft } : {}),
    ...(p.injury ? { injured_weeks: p.injury } : {}), ...(p.ps ? { practice_squad: true } : {}),
  };
}

// ---------- lookups ----------

export function findTeam(d: LeagueData, q: unknown): Team {
  const s = String(q ?? "").trim().toLowerCase();
  if (!s) throw new ToolError("Name a team (abbreviation like PHI, or a name like Eagles).");
  const t = d.teams.find((t) => String(t.id) === s || t.abbr.toLowerCase() === s)
    || d.teams.find((t) => t.name.toLowerCase() === s || `${t.city} ${t.name}`.toLowerCase() === s || t.city.toLowerCase() === s)
    || d.teams.find((t) => `${t.city} ${t.name}`.toLowerCase().includes(s) || (t.user && t.user.toLowerCase() === s));
  if (!t) throw new ToolError(`No team matches "${q}". Teams: ${d.teams.map((t) => t.abbr).sort().join(", ")}.`);
  return t;
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

export function findPlayers(d: LeagueData, q: string, team?: Team): Player[] {
  const s = norm(q);
  if (!s) return [];
  if (/^\d+$/.test(s)) { const p = d.players.find((x) => x.id === Number(s)); return p ? [p] : []; }
  const pool = d.players.filter((p) => !p.gone && (!team || p.team === team.id));
  const full = (p: Player) => norm(`${p.first} ${p.last}`);
  const exact = pool.filter((p) => full(p) === s || (p.nick && norm(p.nick) === s));
  if (exact.length) return exact.sort((a, b) => b.ovr - a.ovr);
  const words = s.split(" ");
  return pool.filter((p) => { const f = `${full(p)} ${p.nick ? norm(p.nick) : ""}`; return words.every((w) => f.includes(w)); }).sort((a, b) => b.ovr - a.ovr);
}

function onePlayer(d: LeagueData, q: unknown, teamQ?: unknown): Player {
  const team = teamQ ? findTeam(d, teamQ) : undefined;
  const hits = findPlayers(d, String(q ?? ""), team);
  if (!hits.length) throw new ToolError(`No player matches "${q}"${team ? ` on ${team.abbr}` : ""}. Try find_players with part of the name.`);
  return hits[0];
}

const PLAYOFF_NAMES: Record<string, number> = { wildcard: 18, "wild card": 18, divisional: 19, conference: 20, "conference championship": 20, superbowl: 22, "super bowl": 22 };

/** Week args: week (1-based, as people say it, or a playoff round name) + stage ("regular", "preseason"). Default: the latest week with a final. */
export function resolveWeek(d: LeagueData, a: Record<string, unknown>): { stage: number; week: number } {
  const w = a.week;
  const stageArg = String(a.stage ?? "").toLowerCase();
  if (w == null || w === "" || String(w).toLowerCase() === "latest") return defaultScoresWeek(d);
  if (String(w).toLowerCase() === "current") return { stage: Math.min(d.season.stage, 1), week: d.season.week };
  const named = PLAYOFF_NAMES[String(w).toLowerCase().trim()];
  if (named != null) return { stage: 1, week: named };
  const n = Number(w);
  if (!Number.isFinite(n) || n < 1 || n > 23) throw new ToolError(`week should be 1–18, a playoff round (wildcard, divisional, conference, superbowl), "current" or "latest".`);
  return { stage: stageArg.startsWith("pre") ? 0 : 1, week: Math.round(n) - 1 };
}


/** One game, both ways round, as a line an agent can read aloud. */
export function gameBrief(d: LeagueData, g: Game) {
  const { teams } = indexes(d);
  const h = teams.get(g.home), a = teams.get(g.away);
  const out: Record<string, unknown> = {
    game_id: g.id, week: weekTitle(d, g.stage, g.week),
    away: a?.abbr ?? "TBD", home: h?.abbr ?? "TBD",
    away_user: a?.user || "CPU", home_user: h?.user || "CPU",
  };
  if (g.final) {
    out.score = `${a?.abbr} ${g.as}, ${h?.abbr} ${g.hs}`;
    out.winner = g.hs > g.as ? h?.abbr : g.as > g.hs ? a?.abbr : "tie";
    out.how = g.forced ? `forced ${g.forced.kind} by admins` : g.disconnect ? "disconnect" : g.simmed === true ? "simmed" : g.simmed === false ? "played" : "unknown";
  } else out.status = "not played yet";
  if (g.gotw) out.game_of_the_week = true;
  return out;
}

// ---------- the tools ----------

type Args = Record<string, unknown>;
type Ctx = { slug: string; d: LeagueData };
type Prop = { type: "string" | "integer" | "boolean"; description: string; enum?: string[] };
export type ToolDef = { name: string; title: string; description: string; props: Record<string, Prop>; required?: string[]; run: (c: Ctx, a: Args) => unknown | Promise<unknown> };

const WEEK: Prop = { type: "string", description: "Week number 1-18 (as said aloud), a playoff round (wildcard, divisional, conference, superbowl), 'current' or 'latest' (default: latest week with a final score)." };
const STAGE: Prop = { type: "string", description: "regular (default) or preseason.", enum: ["regular", "preseason"] };
const TEAM: Prop = { type: "string", description: "Team abbreviation (PHI), name (Eagles), city, or the user who runs it." };
const int = (v: unknown, def: number, max: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), max) : def; };

export const TOOLS: ToolDef[] = [
  {
    name: "league_info", title: "League overview",
    description: "Start here. The league's current season and week, last data sync, every team with its user (the human running it), record and overall, and the salary cap baseline.",
    props: {},
    run: ({ d }) => {
      const thisWeek = d.games.filter((g) => g.stage === d.season.stage && g.week === d.season.week && g.home && g.away);
      return {
        season: d.season.year, phase: d.season.stage === 0 ? "preseason" : d.season.stage === 1 ? "regular season / playoffs" : "offseason",
        week: d.season.title, data_pulled_at: d.pulledAt,
        this_week: { games: thisWeek.length, final: thisWeek.filter((g) => g.final).length },
        salary_cap: { this_season: $m(leagueCap(d.teams)), cap_season: capSeason(d), grows_per_year: $m(CAP_GROWTH_PER_YEAR) },
        teams: [...d.teams].sort((a, b) => a.conference.localeCompare(b.conference) || a.division.localeCompare(b.division) || b.rec.pct - a.rec.pct)
          .map((t) => ({ abbr: t.abbr, team: teamName(t), division: t.division, user: t.user || "CPU", record: record(t), ovr: t.ovr })),
        notes: "Users are the league members (PSN/Xbox names). 'Simmed' games were auto-simulated by Madden; 'played' games were played by the users. Money is in Madden dollars.",
      };
    },
  },
  {
    name: "week_digest", title: "Week digest (podcast rundown)",
    description: "Everything worth talking about from one league week in one call: every result (upsets, blowouts, nail-biters, played vs simmed), the best individual performances, trades/signings/releases/extensions, dev trait upgrades, big rating jumps, injuries, streaks, the playoff picture, cap trouble, players on track for dev upgrades, and next week's matchups. Best first call when preparing an episode.",
    props: { week: WEEK, stage: STAGE },
    run: async ({ slug, d }, a) => weekDigest(d, await getLeagueHistory(slug), resolveWeek(d, a)),
  },
  {
    name: "standings", title: "Standings",
    description: "Division standings (record, points for/against, streak, user) and each conference's playoff seeds by NFL tiebreakers, with clinch marks.",
    props: { conference: { type: "string", description: "AFC or NFC (default both).", enum: ["AFC", "NFC"] } },
    run: ({ d }, a) => {
      const pic = playoffPicture(d);
      const conf = String(a.conference ?? "").toUpperCase();
      const divs = [...pic.divRows.entries()].filter(([dv]) => !conf || dv.startsWith(conf)).map(([div, rows]) => ({
        division: div,
        teams: rows.map(({ c }) => ({ abbr: c.abbr, user: c.team.user || "CPU", record: record(c.team), pf: c.team.rec.pf, pa: c.team.rec.pa, streak: streakText(c.team.rec.streak), div_record: `${c.team.rec.divW}-${c.team.rec.divL}${c.team.rec.divT ? `-${c.team.rec.divT}` : ""}` })),
      }));
      const seeds = Object.fromEntries(Object.entries(pic.conf).filter(([cf]) => !conf || cf === conf).map(([cf, list]) => [cf, list.slice(0, 7).map((s) => ({ seed: s.seed, abbr: s.c.abbr, record: record(s.c.team), how: s.how, clinched: MARK[s.mark] }))]));
      return { through_week: pic.throughWeek, divisions: divs, playoff_seeds: seeds, mark_key: "clinched: '#1 seed', 'division', 'playoff spot', 'eliminated' or null" };
    },
  },
  {
    name: "playoff_picture", title: "Playoff picture & draft order",
    description: "Each conference's seeds 1-7 (with the tiebreaker that decided close spots), teams in the hunt with games back, clinched/eliminated, and the projected top of next year's draft order.",
    props: {},
    run: ({ d }) => {
      const pic = playoffPicture(d);
      const conf = Object.fromEntries(Object.entries(pic.conf).map(([cf, list]) => {
        const seven = list[6];
        return [cf, list.map((s) => ({
          seed: s.seed, abbr: s.c.abbr, user: s.c.team.user || "CPU", record: record(s.c.team), how: s.seed <= 7 ? s.how : "in the hunt",
          ...(s.seed > 7 && seven ? { games_back_of_7th: (seven.c.w - s.c.w + (s.c.l - seven.c.l)) / 2 } : {}),
          clinched: MARK[s.mark], ...(s.tiedWith.length ? { tiebreak: s.story[s.story.length - 1]?.label ?? null } : {}),
        })).slice(0, 12)];
      }));
      let draft: unknown = null;
      try { draft = draftOrder(d).slots.slice(0, 12).map((x, i) => ({ pick: i + 1, abbr: x.c.abbr, record: record(x.c.team), ...(x.why ? { note: x.why } : {}) })); } catch { /* early season */ }
      return { through_week: pic.throughWeek, regular_season_done: pic.regularSeasonDone, conferences: conf, projected_draft_top_12: draft, note: "Draft order shows each team's own pick; traded picks aren't in EA's data." };
    },
  },
  {
    name: "games", title: "Scores & schedule",
    description: "Scores and matchups for a week (with users and played/simmed), or a whole season schedule for one team.",
    props: { week: WEEK, stage: STAGE, team: TEAM },
    run: ({ d }, a) => {
      if (a.team && (a.week == null || a.week === "")) {
        const t = findTeam(d, a.team);
        const gs = d.games.filter((g) => (g.home === t.id || g.away === t.id) && g.home && g.away).sort((x, y) => x.stage - y.stage || x.week - y.week);
        return { team: t.abbr, record: record(t), games: gs.map((g) => gameBrief(d, g)) };
      }
      const w = resolveWeek(d, a);
      let gs = gamesForWeek(d, w.stage, w.week).filter((g) => g.home || g.away);
      if (a.team) { const t = findTeam(d, a.team); gs = gs.filter((g) => g.home === t.id || g.away === t.id); }
      return { week: weekTitle(d, w.stage, w.week), games: gs.map((g) => gameBrief(d, g)) };
    },
  },
  {
    name: "box_score", title: "Box score",
    description: "Full box score for one game: score, team stats (yards, 3rd down, red zone, turnovers...) and every player's stat line. Give game_id (from games/week_digest), or team + week.",
    props: { game_id: { type: "integer", description: "Game id from games or week_digest." }, team: TEAM, week: WEEK, stage: STAGE },
    run: ({ d }, a) => {
      let g: Game | undefined;
      if (a.game_id != null && a.game_id !== "") g = d.games.find((x) => x.id === Number(a.game_id));
      else if (a.team) { const t = findTeam(d, a.team); const w = resolveWeek(d, a); g = gamesForWeek(d, w.stage, w.week).find((x) => x.home === t.id || x.away === t.id); }
      if (!g) throw new ToolError("Game not found. Pass game_id, or team plus week.");
      const { teams, players } = indexes(d);
      const bx = boxScore(d, g.id);
      const side = (tid: number) => {
        const ts = bx.teamStats.find((x) => x.t === tid);
        return {
          team: teams.get(tid)?.abbr,
          ...(ts ? { team_stats: { total_yds: ts.yds, pass_yds: ts.passYds, rush_yds: ts.rushYds, first_downs: ts.firstDowns, third_down: `${ts.third[0]}/${ts.third[1]}`, fourth_down: `${ts.fourth[0]}/${ts.fourth[1]}`, red_zone_tds: `${ts.redZone[0]}/${ts.redZone[1]}`, turnovers: ts.turnovers, takeaways: ts.takeaways, sacks: ts.sacks, penalties: `${ts.penalties}-${ts.penaltyYds}` } } : {}),
          players: bx.lines.filter((l) => l.t === tid).map((l) => { const p = players.get(l.p); return { name: pname(p), pos: p?.pos, line: lineText(l as Partial<Record<string, number>>) }; }),
        };
      };
      return { ...gameBrief(d, g), away_box: side(g.away), home_box: side(g.home) };
    },
  },
  {
    name: "find_players", title: "Find players",
    description: "Search and filter players: by name, team, position, minimum overall, dev trait, free agents only. Sorted by overall unless sort is given.",
    props: {
      query: { type: "string", description: "Part of a name or nickname." }, team: TEAM,
      position: { type: "string", description: "QB, HB, WR, TE, LT, LG, C, RG, RT, LEDG, REDG, DT, SAM, MIKE, WILL, CB, FS, SS, K, P..." },
      min_ovr: { type: "integer", description: "Minimum overall." },
      dev: { type: "string", description: "Dev trait.", enum: ["Normal", "Star", "Superstar", "X-Factor"] },
      free_agents: { type: "boolean", description: "Only unsigned players." },
      sort: { type: "string", description: "ovr (default), age, cap_hit, speed, young (youngest first).", enum: ["ovr", "age", "cap_hit", "speed", "young"] },
      limit: { type: "integer", description: "Max results (default 25, max 100)." },
    },
    run: ({ d }, a) => {
      let ps = a.query ? findPlayers(d, String(a.query)) : d.players.filter((p) => !p.gone);
      if (a.team) { const t = findTeam(d, a.team); ps = ps.filter((p) => p.team === t.id); }
      if (a.free_agents === true || a.free_agents === "true") ps = ps.filter((p) => !p.team);
      if (a.position) { const pos = String(a.position).toUpperCase(); ps = ps.filter((p) => p.pos === pos || (pos === "EDGE" && /EDG|^LE$|^RE$/.test(p.pos)) || (pos === "LB" && /SAM|MIKE|WILL|OLB|MLB/.test(p.pos)) || (pos === "S" && /FS|SS/.test(p.pos))); }
      if (a.min_ovr) ps = ps.filter((p) => p.ovr >= Number(a.min_ovr));
      if (a.dev) { const i = DEV_LABEL.findIndex((x) => x.toLowerCase() === String(a.dev).toLowerCase()); if (i >= 0) ps = ps.filter((p) => p.dev === i); }
      const spd = RATING_KEYS.indexOf("speedRating");
      const key: Record<string, (p: Player) => number> = { ovr: (p) => -p.ovr, age: (p) => -p.age, young: (p) => p.age, cap_hit: (p) => -p.contract.capHit, speed: (p) => -(p.ratings?.[spd] ?? 0) };
      const k = key[String(a.sort ?? "ovr")] ?? key.ovr;
      const lim = int(a.limit, 25, 100);
      const out = [...ps].sort((x, y) => k(x) - k(y) || y.ovr - x.ovr).slice(0, lim);
      return { count: ps.length, showing: out.length, players: out.map((p) => ({ ...playerBrief(d, p), ...(a.sort === "speed" ? { speed: p.ratings?.[spd] } : {}) })) };
    },
  },
  {
    name: "player", title: "Player profile",
    description: "One player in depth: bio, overall, dev trait, ratings, abilities, contract and projected cap hit by year, this season's stats and game log, past league seasons and real-NFL career seasons, and his transaction/rating history in this league.",
    props: { player: { type: "string", description: "Name (or player id)." }, team: TEAM },
    required: ["player"],
    run: async ({ slug, d }, a) => {
      const p = onePlayer(d, a.player, a.team);
      const t = d.teams.find((x) => x.id === p.team);
      const cy = capSeason(d);
      const pr = p.team ? projectPlayer(p, cy) : null;
      const r = p.ratings || [];
      const ratings = Object.fromEntries(RATING_KEYS.map((k, i) => [RATING_LABEL[k] ?? k, r[i]]).filter(([, v]) => typeof v === "number" && (v as number) >= 40).sort((x, y) => (y[1] as number) - (x[1] as number)));
      const seasons = await playerSeasons(slug, d, p).catch(() => []);
      const rows = seasons.map((s) => ({ s, row: seasonRow(s, p) })).filter((x) => x.row);
      const cur = seasons.find((s) => s.kind === "league" && !s.past);
      const hist = await getLeagueHistory(slug);
      const events = (hist?.events || []).filter((e) => e.p === p.id).slice(-15).reverse();
      return {
        ...playerBrief(d, p), team_name: teamName(t),
        bio: { height: heightText(p.height), weight: p.weight, college: p.college, years_pro: p.yearsPro, draft: p.draft?.round ? `${p.draft.year} round ${p.draft.round}, pick ${p.draft.pick}` : "undrafted", jersey: p.jersey },
        ...(p.injury ? { injury: `out ${p.injury} week(s)${p.ir ? ", on IR" : ""}` } : {}),
        abilities: p.abilities.map((x) => `${x.title} (${x.tier})`),
        ratings,
        contract: p.team ? {
          length: p.contract.length, years_left: p.contract.yearsLeft, total_salary: $m(p.contract.salary), total_bonus: $m(p.contract.bonus),
          cap_hit_this_season: $m(p.contract.capHit), cut_now: { dead_money: $m(p.contract.releasePenalty), cap_savings: $m(p.contract.releaseSavings) },
          projected_cap_hits: pr ? Object.fromEntries(Object.entries(pr.hits).map(([y, v]) => [y, $m(v)])) : null,
          ...(pr && Object.keys(pr.dead).length ? { void_year_dead_money: Object.fromEntries(Object.entries(pr.dead).map(([y, v]) => [y, $m(v)])) } : {}),
          projection_basis: pr?.source,
        } : { status: "free agent" },
        ...(p.desired?.salary ? { maddens_contract_ask: { per_year: $m(p.desired.salary), bonus: $m(p.desired.bonus), years: p.desired.length } } : {}),
        season_stats: rows.map(({ s, row }) => ({ season: seasonLabel(s, "league"), team: row!.team, games: row!.t.gp, line: totalsText(row!.t) })).slice(0, 12),
        this_season_game_log: cur ? seasonLog(cur, p).slice(-17) : [],
        league_history: events.map(eventText(d)),
        note: "season_stats: 'league' seasons are this Madden league; 'NFL' seasons are his real-life career before the league began.",
      };
    },
  },
  {
    name: "team", title: "Team profile",
    description: "One team in depth: user, record, division place, playoff seed, salary cap now and projected for future seasons (with dead money), biggest contracts, expiring deals, roster by position, schedule with results, team stat leaders, and recent transactions.",
    props: { team: TEAM },
    required: ["team"],
    run: async ({ slug, d }, a) => {
      const t = findTeam(d, a.team);
      const pic = playoffPicture(d);
      const seed = pic.conf[t.conference]?.find((s) => s.c.id === t.id);
      const roster = teamPlayers(d, t.id);
      const cap = teamCapProjection(d, t);
      const tot = seasonTotals(d, (l) => l.t === t.id);
      const { players } = indexes(d);
      const lead = (k: keyof Totals, label: string) => { const best = [...tot.entries()].filter(([, x]) => x[k] > 0).sort(([, x], [, y]) => y[k] - x[k])[0]; return best ? `${label}: ${pname(players.get(best[0]))} ${best[1][k]}` : null; };
      const hist = await getLeagueHistory(slug);
      const tx = (hist?.events || []).filter((e) => e.from === t.id || e.to === t.id || (e.kind !== "trade" && d.players.find((p) => p.id === e.p)?.team === t.id)).slice(-20).reverse();
      const byPos = new Map<string, Player[]>();
      for (const p of roster.filter((p) => !p.ps).sort((x, y) => y.ovr - x.ovr)) byPos.set(p.pos, [...(byPos.get(p.pos) || []), p]);
      return {
        abbr: t.abbr, team: teamName(t), user: t.user || "CPU", division: t.division, ovr: t.ovr,
        record: record(t), streak: streakText(t.rec.streak), points_for: t.rec.pf, points_against: t.rec.pa,
        home: `${t.rec.homeW}-${t.rec.homeL}`, away: `${t.rec.awayW}-${t.rec.awayL}`,
        playoff_seed: seed ? { seed: seed.seed, how: seed.seed <= 7 ? seed.how : "outside the top 7", clinched: MARK[seed.mark] } : null,
        rankings: { offense_yds: t.ranks.offYds, defense_yds: t.ranks.defYds, pass_off: t.ranks.offPass, rush_off: t.ranks.offRush, pass_def: t.ranks.defPass, rush_def: t.ranks.defRush },
        cap: {
          by_season: cap.totals.map((x) => ({ season: x.year, cap: $m(x.cap), committed: $m(x.committed), space: $m(x.space), players_signed: x.players, ...(x.capSet ? {} : { cap_is_projection: true }) })),
          dead_money_now: $m(inferredDeadCap(t, roster.filter((p) => !p.ps))),
          biggest_cap_hits: cap.rows.slice(0, 8).map((r) => `${r.p.pos} ${pname(r.p)} ${$m(r.p.contract.capHit)} (${r.p.contract.yearsLeft} yr left)`),
          expiring_this_season: cap.rows.filter((r) => r.p.contract.yearsLeft <= 1).sort((x, y) => y.p.ovr - x.p.ovr).slice(0, 10).map((r) => `${r.p.pos} ${pname(r.p)} ${r.p.ovr} OVR, age ${r.p.age}`),
        },
        roster: Object.fromEntries([...byPos.entries()].map(([pos, ps]) => [pos, ps.map((p) => `${pname(p)} ${p.ovr}${p.dev ? ` ${devName(p.dev)}` : ""}, ${p.age}y${p.injury ? `, injured ${p.injury}wk` : ""}`)])),
        practice_squad: roster.filter((p) => p.ps).length,
        stat_leaders: [lead("py", "Passing yds"), lead("ptd", "Passing TD"), lead("ry", "Rushing yds"), lead("rcy", "Receiving yds"), lead("rctd", "Receiving TD"), lead("tk", "Tackles"), lead("sk", "Sacks"), lead("int", "Interceptions")].filter(Boolean),
        schedule: d.games.filter((g) => (g.home === t.id || g.away === t.id) && g.home && g.away && g.stage >= 1).sort((x, y) => x.week - y.week).map((g) => gameBrief(d, g)),
        recent_transactions: tx.map(eventText(d)),
      };
    },
  },
  {
    name: "leaders", title: "Stat leaders",
    description: "Regular-season stat leaders. Categories: passing yards/TDs, passer rating, rushing yards/TDs, receiving yards/receptions/TDs, tackles, sacks, interceptions, forced fumbles, field goals. Omit category for the top 5 in each.",
    props: {
      category: { type: "string", description: "Stat category.", enum: [...LEADER_CATS.map((c) => c.key as string), "rating"] },
      team: TEAM, limit: { type: "integer", description: "How many (default 10 with a category, 5 without; max 50)." },
    },
    run: ({ d }, a) => {
      const tm = a.team ? findTeam(d, a.team) : null;
      const tot = seasonTotals(d, tm ? (l) => l.t === tm.id : undefined);
      const { players, teams } = indexes(d);
      const row = (id: number, x: Totals & { team: number }, v: number | string) => ({ name: pname(players.get(id)), pos: players.get(id)?.pos, team: teams.get(x.team)?.abbr, value: v, games: x.gp });
      if (a.category === "rating") {
        const lim = int(a.limit, 10, 50);
        const qbs = [...tot.entries()].filter(([, x]) => x.pa >= Math.max(14, x.gp * 10)).sort(([, x], [, y]) => passerRating(y) - passerRating(x)).slice(0, lim);
        return { category: "Passer rating (min 10 att/game)", leaders: qbs.map(([id, x]) => row(id, x, passerRating(x).toFixed(1))) };
      }
      const cats = a.category ? LEADER_CATS.filter((c) => c.key === a.category) : LEADER_CATS;
      if (!cats.length) throw new ToolError(`Unknown category. Use one of: ${LEADER_CATS.map((c) => c.key).join(", ")}, rating.`);
      const lim = int(a.limit, a.category ? 10 : 5, 50);
      return { season: d.season.year, ...(tm ? { team: tm.abbr } : {}), categories: cats.map((c) => ({ category: c.label, key: c.key, leaders: [...tot.entries()].filter(([, x]) => x[c.key] > 0).sort(([, x], [, y]) => y[c.key] - x[c.key]).slice(0, lim).map(([id, x]) => row(id, x, x[c.key])) })) };
    },
  },
  {
    name: "transactions", title: "Transactions",
    description: "The league's transaction log, newest first: trades, signings, releases, extensions, restructures, draft picks arriving, retirements, dev trait changes, rating changes and position changes. Filter by team, kind or player.",
    props: {
      team: TEAM, player: { type: "string", description: "Player name." },
      kind: { type: "string", description: "Only one kind.", enum: ["trade", "signed", "released", "extended", "restructured", "drafted", "retired", "expired", "dev", "rating", "position"] },
      limit: { type: "integer", description: "How many (default 40, max 200)." },
    },
    run: async ({ slug, d }, a) => {
      const hist = await getLeagueHistory(slug);
      let ev = [...(hist?.events || [])].reverse();
      if (a.kind) ev = ev.filter((e) => e.kind === a.kind);
      if (a.team) { const t = findTeam(d, a.team); ev = ev.filter((e) => e.from === t.id || e.to === t.id || (!e.from && !e.to && d.players.find((p) => p.id === e.p)?.team === t.id)); }
      if (a.player) { const ids = new Set(findPlayers(d, String(a.player)).map((p) => p.id)); ev = ev.filter((e) => ids.has(e.p)); }
      return { tracked_since: hist?.trackedSince ?? null, count: ev.length, events: ev.slice(0, int(a.limit, 40, 200)).map(eventText(d)) };
    },
  },
  {
    name: "cap_overview", title: "League salary cap",
    description: "Every team's cap space this season and projected for the next seasons (Madden's own numbers now; projections use each contract's real or modeled cap hits and the league's cap growth), the biggest cap hits in the league, and teams in cap trouble.",
    props: { limit: { type: "integer", description: "How many of the biggest contracts to list (default 15, max 50)." } },
    run: ({ d }, a) => {
      const years = capYears(d).slice(0, 4);
      const base = leagueCap(d.teams), cy = capSeason(d);
      const committed = committedByTeam(d, years);
      const teams = d.teams.map((t) => ({
        abbr: t.abbr, user: t.user || "CPU",
        seasons: years.map((y, i) => { const c = committed.get(t.id)![i]; const cap = i === 0 ? t.cap.room : projectedLeagueCap(base, cy, y, d.knownCaps); return { season: y, space: $m(i === 0 ? t.cap.available : cap - c), committed: $m(c) }; }),
        _now: t.cap.available,
      })).sort((x, y) => x._now - y._now).map(({ _now, ...r }) => { void _now; return r; });
      const top = d.players.filter((p) => p.team && !p.gone).sort((x, y) => y.contract.capHit - x.contract.capHit).slice(0, int(a.limit, 15, 50));
      return {
        cap_season: cy, league_cap: Object.fromEntries(years.map((y) => [y, $m(projectedLeagueCap(base, cy, y, d.knownCaps))])),
        teams_tightest_first: teams,
        over_the_cap: d.teams.filter((t) => t.cap.available < 0).map((t) => `${t.abbr} ${$m(t.cap.available)}`),
        biggest_cap_hits: top.map((p) => `${d.teams.find((t) => t.id === p.team)?.abbr} ${p.pos} ${pname(p)} ${$m(p.contract.capHit)}`),
      };
    },
  },
  {
    name: "dev_watch", title: "Dev trait watch",
    description: "Players on pace for a dev trait upgrade (Normal→Star→Superstar→X-Factor) at season's end, by the league's stat-rank rules: who's on track, close, or blocked by too few starts.",
    props: { team: TEAM, status: { type: "string", description: "on (default: on track + close), blocked, close, all.", enum: ["on", "close", "blocked", "all"] }, limit: { type: "integer", description: "Max (default 25)." } },
    run: ({ d }, a) => {
      let rows = buildDevTracker(d);
      const st = String(a.status ?? "on");
      rows = st === "all" ? rows.filter((r) => r.status !== "no" && r.status !== "maxed") : st === "on" ? rows.filter((r) => r.status === "on" || r.status === "close") : rows.filter((r) => r.status === st);
      if (a.team) { const t = findTeam(d, a.team); rows = rows.filter((r) => r.p.team === t.id); }
      return {
        rule: "Within his position group, a player's average rank across the listed stats must reach the cutoff for the next trait, with enough starts.",
        players: rows.slice(0, int(a.limit, 25, 100)).map((r) => ({
          ...playerBrief(d, r.p), status: r.status, next_trait: r.next, avg_rank: Number(r.avg.toFixed(1)), needs_rank: r.need,
          stats: r.stats.map((s) => `${STAT_LABEL[s.id]} ${s.value} (#${s.rank})`), games: r.gp, games_left: r.left, ...(r.via ? { via: r.via } : {}),
        })),
      };
    },
  },
];

const MARK: Record<string, string | null> = { "": null, "*": "#1 seed", z: "division", x: "playoff spot", e: "eliminated" };

/** A transaction log event as one readable line plus its week. */
export const eventText = (d: LeagueData) => (e: TxEvent) => {
  const ab = (id?: number) => (id ? d.teams.find((t) => t.id === id)?.abbr ?? "?" : "FA");
  const who = `${e.pos} ${e.name}`;
  const deal = (c?: number[]) => (c ? `${c[0]} yr, ${$m(c[2] + c[3])} total, ${$m(c[4])} cap hit` : "");
  let text: string;
  switch (e.kind) {
    case "trade": text = `${who} traded ${ab(e.from)} → ${ab(e.to)}`; break;
    case "signed": text = `${ab(e.to)} signed ${who}${e.after ? ` (${deal(e.after)})` : ""}`; break;
    case "released": text = `${ab(e.from)} released ${who}`; break;
    case "extended": text = `${ab(e.to || e.from)} extended ${who}${e.after ? ` (${deal(e.after)})` : ""}`; break;
    case "restructured": text = `${ab(e.to || e.from)} restructured ${who}${e.before && e.after ? ` (${$m(e.before[2] - e.after[2])} salary → bonus)` : ""}`; break;
    case "drafted": text = `${ab(e.to)} drafted ${who}`; break;
    case "retired": text = `${who} retired`; break;
    case "expired": text = `${who}'s contract expired (${ab(e.from)})`; break;
    case "dev": text = `${who} dev trait ${devName(e.change?.[0] ?? 0)} → ${devName(e.change?.[1] ?? 0)}`; break;
    case "rating": text = `${who} overall ${e.change?.[0]} → ${e.change?.[1]}`; break;
    case "position": text = `${e.name} moved ${e.move?.[0]} → ${e.move?.[1]}`; break;
    default: text = `${who} ${e.kind}`;
  }
  return { week: `${e.wk.year} ${e.wk.title}`, kind: e.kind, text };
};

export const toolByName = (n: string) => TOOLS.find((t) => t.name === n);

/** Runs a tool for a league. Throws ToolError for bad input. */
export async function runTool(slug: string, name: string, args: Args) {
  const tool = toolByName(name);
  if (!tool) throw new ToolError(`Unknown tool "${name}". Tools: ${TOOLS.map((t) => t.name).join(", ")}.`);
  for (const r of tool.required || []) if (args[r] == null || args[r] === "") throw new ToolError(`${name} needs "${r}".`);
  const d = await getLeagueData(slug);
  if (!d) throw new Error("The league's data couldn't be loaded right now.");
  return tool.run({ slug, d }, args);
}

/** JSON Schema for a tool's arguments (MCP inputSchema). */
export function inputSchema(t: ToolDef) {
  return { type: "object", properties: Object.fromEntries(Object.entries(t.props).map(([k, p]) => [k, { type: p.type, description: p.description, ...(p.enum ? { enum: p.enum } : {}) }])), ...(t.required?.length ? { required: t.required } : {}), additionalProperties: false };
}

/** Coerce REST query-string values to the tool's declared types. */
export function argsFromQuery(t: ToolDef, q: URLSearchParams): Args {
  const out: Args = {};
  for (const [k, p] of Object.entries(t.props)) {
    const v = q.get(k);
    if (v == null || v === "") continue;
    out[k] = p.type === "integer" ? Number(v) : p.type === "boolean" ? v === "true" || v === "1" : v;
  }
  return out;
}
