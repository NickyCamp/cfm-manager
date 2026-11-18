// Stat lines credited to the wrong team (Nick, 2026-11-18: the Panthers showed only 2 rushing TDs, and
// their team stats were low too).
//
// EA's weekly stat exports tag each line with the player's team as of the pull, not the team he played
// for in that game. So once a player is traded, cut or leaves in free agency, EA sends his old games under
// his new team (or none), and every sync's merge took EA's version. His old team loses those numbers.
// EA's team-id renumbering (teamIds.ts) can leave lines on an id no team has any more, too.
//
// A line can only belong to one of the two teams in its game. For a line that names neither:
//  1. an id that is the renumbering shift (a multiple of 2^18) away from one side → that side;
//  2. the side that shows up most often across the player's other mis-tagged games (his old team played
//     in all of them, the opponents change);
//  3. a team the transaction log has him leaving or joining.
// Runs when the data loads, so the site, the bot and the audits all get the fixed numbers.
import type { LeagueData } from "./types";
import type { LeagueHistory } from "./history";

const SHIFT = 2 ** 18;
const shifted = (a: number, b: number) => a !== b && Math.abs(a - b) % SHIFT === 0 && Math.abs(a - b) <= 8 * SHIFT;

export function fixLineTeams(d: LeagueData, h: LeagueHistory | null): { fixed: number; unresolved: number } {
  const games = new Map(d.games.map((g) => [g.id, g]));
  const bad = d.lines.filter((l) => {
    const g = games.get(l.g);
    return g && g.home && g.away && l.t !== g.home && l.t !== g.away;
  });
  if (!bad.length) return { fixed: 0, unresolved: 0 };

  // How often each side team appears across a player's mis-tagged games.
  const seen = new Map<number, Map<number, number>>();
  for (const l of bad) {
    const g = games.get(l.g)!;
    const m = seen.get(l.p) || new Map<number, number>();
    for (const t of [g.home, g.away]) m.set(t, (m.get(t) || 0) + 1);
    seen.set(l.p, m);
  }
  const moved = new Map<number, Set<number>>();
  for (const e of h?.events || []) {
    if (!e.p) continue;
    const s = moved.get(e.p) || new Set<number>();
    if (e.from) s.add(e.from);
    if (e.to) s.add(e.to);
    moved.set(e.p, s);
  }

  let fixed = 0, unresolved = 0;
  for (const l of bad) {
    const g = games.get(l.g)!;
    const sides = [g.home, g.away];
    let t = sides.find((s) => shifted(s, l.t));
    if (!t) {
      const m = seen.get(l.p)!;
      const [a, b] = sides.map((s) => m.get(s) || 0);
      if (a !== b) t = a > b ? g.home : g.away;
    }
    if (!t) {
      const s = moved.get(l.p);
      const hit = s ? sides.filter((x) => s.has(x)) : [];
      if (hit.length === 1) t = hit[0];
    }
    if (t) { l.t = t; fixed++; } else unresolved++;
  }
  return { fixed, unresolved };
}
