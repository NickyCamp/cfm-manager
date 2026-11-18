// Position groups for /players (and /league's group box). Same groups as the site's Players tab chips.

import { RATING_KEYS, RATING_LABEL, RATING_SHORT } from "../league/ratings";

/** slots: the players a group's ranking uses, as [positions, how many] (e.g. DB = top 3 CBs + top 2 safeties).
 *  0 = the whole active room (QB, RB, TE: Nick, 2026-11-18). */
export type DiscordPosGroup = { key: string; name: string; label: string; positions: string[]; slots: [string[], number][] };

export const DISCORD_POS_GROUPS: DiscordPosGroup[] = [
  { key: "qb", name: "QB", label: "Quarterbacks", positions: ["QB"], slots: [[["QB"], 0]] },
  { key: "rb", name: "RB", label: "Running backs", positions: ["HB", "FB"], slots: [[["HB", "FB"], 0]] },
  { key: "wr", name: "WR", label: "Wide receivers", positions: ["WR"], slots: [[["WR"], 3]] },
  { key: "te", name: "TE", label: "Tight ends", positions: ["TE"], slots: [[["TE"], 0]] },
  { key: "ol", name: "OL", label: "Offensive line", positions: ["LT", "LG", "C", "RG", "RT"], slots: [[["LT", "LG", "C", "RG", "RT"], 5]] },
  { key: "dl", name: "DL", label: "Defensive line", positions: ["LEDG", "REDG", "LE", "RE", "DT"], slots: [[["LEDG", "REDG", "LE", "RE", "DT"], 4]] },
  { key: "lb", name: "LB", label: "Linebackers", positions: ["SAM", "MIKE", "WILL", "LOLB", "MLB", "ROLB"], slots: [[["SAM", "MIKE", "WILL", "LOLB", "MLB", "ROLB"], 3]] },
  { key: "db", name: "DB", label: "Secondary", positions: ["CB", "FS", "SS"], slots: [[["CB"], 3], [["FS", "SS"], 2]] },
  { key: "cb", name: "CB", label: "Cornerbacks", positions: ["CB"], slots: [[["CB"], 3]] },
  { key: "s", name: "S", label: "Safeties", positions: ["FS", "SS"], slots: [[["FS", "SS"], 2]] },
  { key: "kp", name: "K/P", label: "Specialists", positions: ["K", "P", "LS"], slots: [[["K"], 1], [["P"], 1]] },
];

const EMPTY_SLOT = 40; // an unfilled starter spot counts as a 40 OVR

/** A team's starters in the group (best OVR per slot, practice squad left out) and their average OVR. */
export function groupStarters<P extends { pos: string; ovr: number; ps: boolean }>(players: P[], g: DiscordPosGroup) {
  const starters: P[] = [];
  let sum = 0, n = 0;
  for (const [pos, count] of g.slots) {
    const room = players.filter((p) => !p.ps && pos.includes(p.pos)).sort((a, b) => b.ovr - a.ovr);
    const best = count ? room.slice(0, count) : room;
    const spots = count || Math.max(room.length, 1);
    starters.push(...best);
    sum += best.reduce((a, p) => a + p.ovr, 0) + (spots - best.length) * EMPTY_SLOT;
    n += spots;
  }
  return { starters, avg: n ? sum / n : 0 };
}

// ---------- /players sort: any rating, best to worst or worst to best (Nick, 2026-11-18) ----------


export type PlayerSort = { key: string; label: string; short: string; dir: "desc" | "asc" };

/** "ovr" plus every EA rating, for the rating box's autocomplete. */
export const SORT_RATINGS: { key: string; label: string; short: string }[] = [
  { key: "ovr", label: "Overall", short: "OVR" },
  ...RATING_KEYS.map((k) => ({ key: k as string, label: RATING_LABEL[k] || k, short: RATING_SHORT[k] || k })),
];

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** A picked autocomplete value (key) or typed text ("speed", "SPD", "throw power") → the rating; undefined if no match. */
export function findSortRating(raw: string) {
  const q = squash(raw);
  if (!q) return SORT_RATINGS[0];
  return SORT_RATINGS.find((r) => squash(r.key) === q || squash(r.short) === q || squash(r.label) === q)
    || SORT_RATINGS.find((r) => squash(r.label).startsWith(q));
}

/** Autocomplete list for the rating box (Discord shows 25 at most). */
export function sortRatingChoices(typed: string) {
  const q = squash(typed);
  return SORT_RATINGS
    .filter((r) => !q || squash(r.label).includes(q) || squash(r.short).startsWith(q))
    .slice(0, 25)
    .map((r) => ({ name: `${r.label} (${r.short})`, value: r.key }));
}

/** The player's value for a sort rating; null when this build has no ratings for him. */
export function sortValue(p: { ovr: number; ratings?: number[] }, key: string): number | null {
  if (key === "ovr") return p.ovr;
  const k = (RATING_KEYS as readonly string[]).indexOf(key);
  const v = k >= 0 ? p.ratings?.[k] : undefined;
  return typeof v === "number" ? v : null;
}
