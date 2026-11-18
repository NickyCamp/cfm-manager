// Position groups for /players (and /league's group box). Same groups as the site's Players tab chips.

/** slots: the starters a group's ranking uses, as [positions, how many] (e.g. DB = top 3 CBs + top 2 safeties). */
export type DiscordPosGroup = { key: string; name: string; label: string; positions: string[]; slots: [string[], number][] };

export const DISCORD_POS_GROUPS: DiscordPosGroup[] = [
  { key: "qb", name: "QB", label: "Quarterbacks", positions: ["QB"], slots: [[["QB"], 1]] },
  { key: "rb", name: "RB", label: "Running backs", positions: ["HB", "FB"], slots: [[["HB"], 1]] },
  { key: "wr", name: "WR", label: "Wide receivers", positions: ["WR"], slots: [[["WR"], 3]] },
  { key: "te", name: "TE", label: "Tight ends", positions: ["TE"], slots: [[["TE"], 1]] },
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
    const best = players.filter((p) => !p.ps && pos.includes(p.pos)).sort((a, b) => b.ovr - a.ovr).slice(0, count);
    starters.push(...best);
    sum += best.reduce((a, p) => a + p.ovr, 0) + (count - best.length) * EMPTY_SLOT;
    n += count;
  }
  return { starters, avg: n ? sum / n : 0 };
}
