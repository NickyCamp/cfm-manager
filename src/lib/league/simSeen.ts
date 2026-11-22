// Played or simmed, as EA said it while the game's week was current (Nick, 2026-11-22: a Week 1 game
// played after the last sync but before the advance showed "unknown" in the activity wrap-up).
//
// EA's league hub only reports numberTimesPlayed for the current week, so a sync after the advance
// can't tell whether last week's late games were played or simmed. The live EA check (eaLive.ts) runs
// every 15 minutes from the game-channels cron and on every bet; each time it sees a finished game it
// records the answer here, in leagues.settings.simSeen. getLeagueData fills in any game the data file
// has as unknown (simmed null) from it.
//
// No Next.js imports: plain helpers.

/** scheduleId → [1 simmed / 0 played, stage, week, first seen ISO]. */
export type SimSeen = Record<string, [number, number, number, string]>;

const MAX = 400;
const rank = (stage: number, week: number) => stage * 100 + week;

/** The new map with what EA said this week, or null when nothing changed. Entries from a week after
 *  the current one are last season's (EA reuses game ids) and are dropped once a new season starts. */
export function mergeSimSeen(cur: unknown, seen: Map<number, boolean>, stage: number, week: number, now = new Date().toISOString()): { next: SimSeen; added: number } | null {
  const prev = (cur && typeof cur === "object" ? cur : {}) as SimSeen;
  const out: SimSeen = {};
  let changed = false, added = 0;
  const here = rank(stage, week);
  for (const [id, e] of Object.entries(prev)) {
    if (!Array.isArray(e) || e.length < 4) { changed = true; continue; }
    if (stage <= 1 && rank(e[1], e[2]) > here) { changed = true; continue; }
    out[id] = e;
  }
  for (const [id, simmed] of seen) {
    const k = String(id), v = simmed ? 1 : 0, e = out[k];
    if (e && e[0] === v && e[1] === stage && e[2] === week) continue;
    if (!e || e[1] !== stage || e[2] !== week) added++;
    out[k] = [v, stage, week, e && e[1] === stage && e[2] === week ? e[3] : now];
    changed = true;
  }
  const keys = Object.keys(out);
  if (keys.length > MAX) {
    keys.sort((a, b) => out[a][3].localeCompare(out[b][3])).slice(0, keys.length - MAX).forEach((k) => delete out[k]);
    changed = true;
  }
  return changed ? { next: out, added } : null;
}

/** Fills in finished games the data file has as unknown. Returns how many it filled. */
export function applySimSeen(games: { id: number; stage: number; week: number; final: boolean; simmed: boolean | null }[], seen: unknown): number {
  if (!seen || typeof seen !== "object") return 0;
  const m = seen as SimSeen;
  let n = 0;
  for (const g of games) {
    if (g.simmed != null || !g.final) continue;
    const e = m[String(g.id)];
    if (!e || e[1] !== g.stage || e[2] !== g.week) continue;
    g.simmed = e[0] === 1;
    n++;
  }
  return n;
}
