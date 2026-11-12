// Stand-in card art: NFL.com headshots of real players, matched through nflverse's
// players file (headshots.json, refreshed weekly by scripts/headshots/update.mjs).
// The headshots are transparent cut-outs, so they sit on the card's team-colored
// background. Uploaded art always wins; generated players (draft classes made in
// the franchise) never match and keep the jersey-number card.
// Like uploaded art, these are photos we don't own, so pages only show them to
// signed-in league members.
import data from "./headshots.json";
import type { Player } from "./types";

type Row = [names: string[], born: string, college: string, rookie: number, group: string, img: string, last: string];

const HOST = "https://static.www.nfl.com/image/";
// Crop the landscape original to the card's 5:7 shape around the face, 750x1050 like uploads.
const TRANSFORM = "c_fill,g_face,ar_5:7,w_750,f_auto,q_auto";

/** Same rules as scripts/headshots/norm.mjs (keep the two in step). */
export function normName(s: string) {
  return String(s || "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !["jr", "sr", "ii", "iii", "iv", "v"].includes(w))
    .join(" ");
}

let index: { names: Map<string, Row[]>; lasts: Map<string, Row[]> } | null = null;
function lookup() {
  if (index) return index;
  const add = (m: Map<string, Row[]>, k: string, r: Row) => { const l = m.get(k); if (l) l.push(r); else m.set(k, [r]); };
  index = { names: new Map(), lasts: new Map() };
  for (const row of data as Row[]) {
    for (const n of row[0]) add(index.names, n, row);
    if (row[6]) add(index.lasts, row[6], row);
  }
  return index;
}

const DAY = 86_400_000;
/** Days between two "YYYY-MM-DD" dates. */
const daysApart = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / DAY;

// Madden position -> nflverse position group. Edge rushers are DL or LB depending on the source.
const GROUP: Record<string, string[]> = {
  QB: ["QB"], HB: ["RB"], FB: ["RB"], WR: ["WR"], TE: ["TE"],
  LT: ["OL"], LG: ["OL"], C: ["OL"], RG: ["OL"], RT: ["OL"],
  LE: ["DL", "LB"], RE: ["DL", "LB"], LEDG: ["DL", "LB"], REDG: ["DL", "LB"], DT: ["DL"],
  LOLB: ["LB", "DL"], MLB: ["LB"], ROLB: ["LB", "DL"], SAM: ["LB"], MIKE: ["LB"], WILL: ["LB"],
  CB: ["DB"], FS: ["DB"], SS: ["DB"], K: ["SPEC"], P: ["SPEC"], LS: ["SPEC", "OL"],
};

const collegeKey = (s: string) => normName(s).replace(/\b(university|of|the|college)\b/g, "").replace(/\s+/g, " ").trim();

/** EA's birth date for the player, "YYYY-MM-DD", or "" when the build doesn't have it. */
function bornOf(p: Player) {
  return p.born || "";
}

/** How well a candidate fits; -1 means it contradicts what we know. */
function score(p: Player, r: Row) {
  const born = bornOf(p);
  if (born && r[1]) {
    if (born === r[1]) return 100; // name + birthday is as good as an id
    // EA's birthdays are sometimes off by a day, a month or a year; further apart is someone else.
    if (daysApart(born, r[1]) > 400) return -1;
  }
  let s = born && r[1] ? 5 : 0;
  if (p.draft.year && r[3]) {
    const gap = Math.abs(p.draft.year - r[3]);
    if (gap > 1) return -1; // e.g. a generated rookie who shares a real player's name
    if (gap === 0) s += 3;
  }
  const groups = GROUP[p.pos.toUpperCase()];
  if (groups && r[4]) s += groups.includes(r[4]) ? 2 : -2;
  if (p.college && r[2]) {
    const a = collegeKey(p.college), b = collegeKey(r[2]);
    if (a && b && (b.includes(a) || a.includes(b))) s += 3;
  }
  return s;
}

/** The nflverse row for a league player, or undefined if there's no confident match. */
export function headshotRow(p: Player): Row | undefined {
  const { names, lasts } = lookup();
  const cands = names.get(normName(`${p.first} ${p.last}`));
  if (cands?.length) {
    const scored = cands.map((r) => ({ r, s: score(p, r) })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s);
    if (scored.length === 1 && (cands.length === 1 || scored[0].s > 0)) return scored[0].r;
    // Two people with the same name: only take the leader if it clearly wins.
    if (scored.length > 1 && scored[0].s > scored[1].s) return scored[0].r;
    if (scored.length) return undefined;
  }
  // Nicknames ("Boogie" Basham is Carlos Basham, "Dru" Phillips is Andru): same last name
  // and the exact birthday, and only one such player.
  const born = bornOf(p);
  if (!born) return undefined;
  const same = (lasts.get(normName(p.last)) || []).filter((r) => r[1] === born);
  return same.length === 1 ? same[0] : undefined;
}

/** NFL.com headshot (card-shaped, transparent) for a real player, or undefined. */
export function headshotUrl(p: Player): string | undefined {
  const r = headshotRow(p);
  if (!r) return undefined;
  const [kind, ...rest] = r[5].split("/");
  return `${HOST}${kind}/${TRANSFORM}/${rest.join("/")}`;
}

export const isHeadshotUrl = (u: string | undefined) => Boolean(u?.startsWith(HOST));
