// Position groups for /players (and /league's group box). Same groups as the site's Players tab chips.

export type DiscordPosGroup = { key: string; name: string; label: string; positions: string[] };

export const DISCORD_POS_GROUPS: DiscordPosGroup[] = [
  { key: "qb", name: "QB", label: "Quarterbacks", positions: ["QB"] },
  { key: "rb", name: "RB", label: "Running backs", positions: ["HB", "FB"] },
  { key: "wr", name: "WR", label: "Wide receivers", positions: ["WR"] },
  { key: "te", name: "TE", label: "Tight ends", positions: ["TE"] },
  { key: "ol", name: "OL", label: "Offensive line", positions: ["LT", "LG", "C", "RG", "RT"] },
  { key: "dl", name: "DL", label: "Defensive line", positions: ["LEDG", "REDG", "LE", "RE", "DT"] },
  { key: "lb", name: "LB", label: "Linebackers", positions: ["SAM", "MIKE", "WILL", "LOLB", "MLB", "ROLB"] },
  { key: "db", name: "DB", label: "Secondary", positions: ["CB", "FS", "SS"] },
  { key: "cb", name: "CB", label: "Cornerbacks", positions: ["CB"] },
  { key: "s", name: "S", label: "Safeties", positions: ["FS", "SS"] },
  { key: "kp", name: "K/P", label: "Specialists", positions: ["K", "P", "LS"] },
];
