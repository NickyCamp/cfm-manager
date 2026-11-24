// Real NFL game logs for league players (Nick, 2026-11-24: "a game by game log for previous real
// life years like 2025 onward for the existing players that played in those years").
// Source: nflverse (https://github.com/nflverse/nflverse-data): weekly player stats, the players
// file (names, birth dates for matching, see realStats.ts) and the schedule (scores).
// Run: node scripts/real-stats/update.mjs
// Real seasons stop at 2025 (Nick, 2026-11-24): NCL's league cycle starts in 2026, so real 2026 games
// would overlap the league's own 2026 season. Then (same day) whole careers back to 2004, for players
// who were still in the NFL in 2024 or later (e.g. Jared Goff since 2016). All final, so no scheduled refresh.
//
// Writes src/lib/league/real-stats/:
//   players.json - { updated, players: [names, born, college, rookieYear, posGroup, gsisId, lastName, seasons[]] }
//                  (headshots.json row shape, plus the seasons he has games in)
//   <year>.json  - { games: [gameId, week, "R"|"P", away, awayScore, home, homeScore][],
//                    logs: { gsisId: [[gameIndex, team, line], ...] } }, line uses StatLine's short keys (types.ts)
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { normName } from "../headshots/norm.mjs";

const FIRST_SEASON = 2004; // the oldest active-in-2024 player's rookie year (Philip Rivers)
const ACTIVE_SINCE = 2024; // players whose last NFL season is this or later
const LAST_SEASON = 2025;
const REL = "https://github.com/nflverse/nflverse-data/releases/download";
const OUT = fileURLToPath(new URL("../../src/lib/league/real-stats/", import.meta.url));

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

async function get(url, gz = false) {
  const res = await fetch(url);
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return gz ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
}

const n = (x) => {
  const v = Number(x);
  return Number.isFinite(v) ? v : 0;
};

// ---------- players still around (only they can be on a Madden roster) ----------
const people = parseCsv(await get(`${REL}/players/players.csv`) || "").filter((p) => Number(p.last_season) >= ACTIVE_SINCE);
const active = new Set(people.map((p) => p.gsis_id));

// ---------- schedule ----------
const sched = parseCsv(await get(`${REL}/schedules/games.csv`) || "");
if (!sched.length) throw new Error("nflverse schedule: no rows");

mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) rmSync(OUT + f);
const seasonsOf = {};
let rowsKept = 0;
for (let season = FIRST_SEASON; season <= LAST_SEASON; season++) {
  const games = [];
  const gameIdx = new Map();
  for (const g of sched) {
    if (n(g.season) !== season || g.away_score === "" || g.away_score === "NA") continue;
    gameIdx.set(g.game_id, games.length);
    games.push([g.game_id, n(g.week), g.game_type === "REG" ? "R" : "P", g.away_team, n(g.away_score), g.home_team, n(g.home_score)]);
  }
  const text = await get(`${REL}/stats_player/stats_player_week_${season}.csv.gz`, true);
  if (!text) { console.log(`${season}: no weekly stats`); continue; }
  const logs = {};
  const rows = parseCsv(text);
  for (const r of rows) {
    const gi = gameIdx.get(r.game_id);
    if (gi === undefined || !active.has(r.player_id)) continue;
    const line = {
      pa: n(r.attempts), pc: n(r.completions), py: n(r.passing_yards), ptd: n(r.passing_tds), pint: n(r.passing_interceptions), psk: n(r.sacks_suffered),
      ra: n(r.carries), ry: n(r.rushing_yards), rtd: n(r.rushing_tds), rfum: n(r.rushing_fumbles_lost),
      rc: n(r.receptions), rcy: n(r.receiving_yards), rctd: n(r.receiving_tds), rcyac: n(r.receiving_yards_after_catch), tgt: n(r.targets),
      tk: n(r.def_tackles_solo) + n(r.def_tackles_with_assist), sk: n(r.def_sacks), int: n(r.def_interceptions), ff: n(r.def_fumbles_forced),
      fr: n(r.fumble_recovery_opp), dtd: n(r.def_tds), pd: n(r.def_pass_defended), sfty: n(r.def_safeties), tfl: n(r.def_tackles_for_loss),
      fga: n(r.fg_att), fgm: n(r.fg_made), fglng: n(r.fg_long), xpa: n(r.pat_att), xpm: n(r.pat_made),
      pnt: n(r.pt_att), pnty: n(r.pt_yards), pntnet: n(r.pt_net_yards), pnt20: n(r.pt_inside_20), pntlng: n(r.pt_long),
    };
    for (const k of Object.keys(line)) if (!line[k]) delete line[k];
    (logs[r.player_id] ||= []).push([gi, r.team, line]);
    (seasonsOf[r.player_id] ||= new Set()).add(season);
    rowsKept++;
  }
  for (const l of Object.values(logs)) l.sort((a, b) => a[0] - b[0]);
  writeFileSync(`${OUT}${season}.json`, JSON.stringify({ games, logs }) + "\n");
  console.log(`${season}: ${games.length} games, ${Object.keys(logs).length} players`);
}

// ---------- players (only those with a game) ----------
const players = [];
for (const p of people) {
  if (!seasonsOf[p.gsis_id]) continue;
  const names = new Set();
  for (const first of [p.first_name, p.common_first_name, p.football_name]) {
    if (first && p.last_name) names.add(normName(`${first} ${p.last_name}`));
  }
  if (p.display_name) names.add(normName(p.display_name));
  names.delete("");
  if (!names.size) continue;
  players.push([[...names], p.birth_date || "", p.college_name || "", n(p.rookie_season) || n(p.draft_year), p.position_group || "", p.gsis_id, normName(p.last_name), [...seasonsOf[p.gsis_id]].sort()]);
}
players.sort((a, b) => a[0][0].localeCompare(b[0][0]));
writeFileSync(`${OUT}players.json`, JSON.stringify({ updated: new Date().toISOString(), players }) + "\n");
console.log(`real-stats: ${players.length} players, ${rowsKept} player-games, ${FIRST_SEASON}-${LAST_SEASON}`);
