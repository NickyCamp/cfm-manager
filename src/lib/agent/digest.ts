// week_digest: one league week, pre-chewed for an AI podcast host (Nick, 2026-11-24).
// Everything here is computed from data the site already has; the agent gets storylines,
// not raw rows, and can call the detail tools (box_score, player, team) to dig in.

import { gamesForWeek, indexes, streakText, record, weekTitle, capSeason } from "@/lib/league/derive";
import { playoffPicture, REG_WEEKS } from "@/lib/league/playoffs";
import { buildDevTracker } from "@/lib/league/dev";
import type { LeagueHistory } from "@/lib/league/history";
import type { Game, LeagueData, StatLine } from "@/lib/league/types";
import { $m, eventText, gameBrief, pname } from "./tools";
import { lineText } from "@/lib/league/playerSeasons";

type W = { stage: number; week: number };

// rough "how big was this game" scores per role, to pick the week's standout lines
const passScore = (l: StatLine) => (l.py || 0) / 25 + (l.ptd || 0) * 4 - (l.pint || 0) * 3;
const rushScore = (l: StatLine) => (l.ry || 0) / 10 + (l.rtd || 0) * 6 - (l.rfum || 0) * 2;
const recScore = (l: StatLine) => (l.rcy || 0) / 10 + (l.rctd || 0) * 6 + (l.rc || 0) * 0.5;
const defScore = (l: StatLine) => (l.tk || 0) * 0.5 + (l.sk || 0) * 3 + (l.int || 0) * 4 + (l.ff || 0) * 2.5 + (l.fr || 0) * 2 + (l.dtd || 0) * 6 + (l.pd || 0) * 1 + (l.sfty || 0) * 3;

export function weekDigest(d: LeagueData, hist: LeagueHistory | null, w: W) {
  const { teams, players } = indexes(d);
  const ab = (id: number) => teams.get(id)?.abbr ?? "?";
  const title = weekTitle(d, w.stage, w.week);
  const games = gamesForWeek(d, w.stage, w.week).filter((g) => g.home && g.away);
  const finals = games.filter((g) => g.final);
  const ids = new Set(finals.map((g) => g.id));
  const lines = d.lines.filter((l) => ids.has(l.g));

  // ---- results with storylines ----
  const results = finals.map((g) => {
    const b = gameBrief(d, g) as Record<string, unknown>;
    const homeWon = g.hs > g.as;
    const win = homeWon ? g.home : g.away, lose = homeWon ? g.away : g.home;
    const margin = Math.abs(g.hs - g.as);
    const tags: string[] = [];
    const ovrGap = (teams.get(lose)?.ovr ?? 0) - (teams.get(win)?.ovr ?? 0);
    if (g.hs !== g.as && ovrGap >= 3) tags.push(`upset (winner's roster is ${ovrGap} OVR lower)`);
    if (margin <= 3 && g.hs !== g.as) tags.push("one-score nail-biter");
    else if (margin >= 21) tags.push("blowout");
    if (g.hs + g.as >= 70) tags.push("shootout");
    if (Math.min(g.hs, g.as) === 0 && g.hs !== g.as) tags.push("shutout");
    const gl = lines.filter((l) => l.g === g.id);
    const best = [...gl].sort((x, y) => Math.max(passScore(y), rushScore(y), recScore(y), defScore(y)) - Math.max(passScore(x), rushScore(x), recScore(x), defScore(x)))[0];
    return {
      ...b, margin, ...(tags.length ? { storylines: tags } : {}),
      ...(best ? { player_of_the_game: `${ab(best.t)} ${players.get(best.p)?.pos} ${pname(players.get(best.p))}: ${lineText(best as Partial<Record<string, number>>)}` } : {}),
    };
  });

  // ---- best individual lines of the week ----
  const top = (score: (l: StatLine) => number, n: number) => [...lines].filter((l) => score(l) > 0).sort((x, y) => score(y) - score(x)).slice(0, n)
    .map((l) => ({ player: pname(players.get(l.p)), pos: players.get(l.p)?.pos, team: ab(l.t), vs: (() => { const g = finals.find((x) => x.id === l.g); return g ? ab(g.home === l.t ? g.away : g.home) : "?"; })(), line: lineText(l as Partial<Record<string, number>>), game_id: l.g }));

  // ---- transactions logged in this league week ----
  const year = d.season.year;
  const inWeek = (hist?.events || []).filter((e) => e.wk.year === year && e.wk.stage === w.stage && e.wk.week === w.week);
  const fmt = eventText(d);
  const of = (k: string) => inWeek.filter((e) => e.kind === k);
  const ratingMoves = of("rating").filter((e) => e.change && Math.abs(e.change[1] - e.change[0]) >= 3).sort((x, y) => Math.abs(y.change![1] - y.change![0]) - Math.abs(x.change![1] - x.change![0]));

  // ---- table and race (current, not as of that week) ----
  const regular = w.stage === 1 && w.week < REG_WEEKS;
  let playoff: unknown = null;
  if (regular || d.season.stage === 1) {
    const pic = playoffPicture(d);
    playoff = Object.fromEntries(Object.entries(pic.conf).map(([cf, list]) => [cf, list.slice(0, 9).map((s) => `${s.seed}. ${s.c.abbr} ${record(s.c.team)}${s.mark === "e" ? " (eliminated)" : s.mark ? " (clinched)" : ""}`)]));
  }
  const streaks = d.teams.filter((t) => Math.abs(t.rec.streak) >= 3).sort((a, b) => b.rec.streak - a.rec.streak).map((t) => `${t.abbr} ${streakText(t.rec.streak)} (${record(t)})`);

  // ---- what's next ----
  const nextGames: Game[] = (() => {
    const later = d.games.filter((g) => g.home && g.away && !g.final && (g.stage > w.stage || (g.stage === w.stage && g.week > w.week)));
    if (!later.length) return [];
    const first = later.reduce((m, g) => (g.stage < m.stage || (g.stage === m.stage && g.week < m.week) ? g : m));
    return later.filter((g) => g.stage === first.stage && g.week === first.week);
  })();
  const unplayed = games.filter((g) => !g.final);

  let dev: unknown = [];
  try { dev = buildDevTracker(d).filter((r) => r.status === "on").slice(0, 8).map((r) => `${r.p.pos} ${pname(r.p)} (${teams.get(r.p.team)?.abbr ?? "FA"}) on pace for ${r.next}`); } catch { /* preseason */ }

  return {
    week: `${year} ${title}`,
    status: `${finals.length} of ${games.length} games final`,
    played_vs_simmed: { played: finals.filter((g) => g.simmed === false).length, simmed: finals.filter((g) => g.simmed === true).length },
    results,
    ...(unplayed.length ? { still_to_play: unplayed.map((g) => `${ab(g.away)} (${teams.get(g.away)?.user || "CPU"}) at ${ab(g.home)} (${teams.get(g.home)?.user || "CPU"})`) } : {}),
    top_performances: { passing: top(passScore, 3), rushing: top(rushScore, 3), receiving: top(recScore, 3), defense: top(defScore, 4) },
    moves_this_week: {
      trades: of("trade").map((e) => fmt(e).text),
      signings: of("signed").slice(0, 12).map((e) => fmt(e).text),
      releases: of("released").slice(0, 12).map((e) => fmt(e).text),
      extensions: of("extended").map((e) => fmt(e).text),
      restructures: of("restructured").map((e) => fmt(e).text),
      dev_trait_changes: of("dev").map((e) => fmt(e).text),
      big_rating_changes: ratingMoves.slice(0, 12).map((e) => fmt(e).text),
      position_changes: of("position").map((e) => fmt(e).text),
      ...(inWeek.length ? {} : { note: "No transactions logged for this week." }),
    },
    injuries_now: d.players.filter((p) => p.team && p.injury > 0 && p.ovr >= 78 && !p.gone).sort((a, b) => b.ovr - a.ovr).slice(0, 12).map((p) => `${teams.get(p.team)?.abbr} ${p.pos} ${pname(p)} (${p.ovr}) out ${p.injury} wk${p.ir ? ", IR" : ""}`),
    streaks_now: streaks,
    playoff_picture_now: playoff,
    dev_upgrade_watch: dev,
    cap_trouble_now: d.teams.filter((t) => t.cap.available < 5_000_000).sort((a, b) => a.cap.available - b.cap.available).map((t) => `${t.abbr} ${$m(t.cap.available)} space (${capSeason(d)})`),
    next_up: nextGames.map((g) => {
      const h = teams.get(g.home)!, a = teams.get(g.away)!;
      return { game_id: g.id, week: weekTitle(d, g.stage, g.week), matchup: `${a.abbr} (${record(a)}, ${a.user || "CPU"}) at ${h.abbr} (${record(h)}, ${h.user || "CPU"})`, ...(g.gotw ? { game_of_the_week: true } : {}) };
    }),
    tips: "'_now' sections are as of the latest sync, not as of that week. Use box_score with a game_id, or player/team, to dig into any storyline.",
  };
}
