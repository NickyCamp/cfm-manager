// Everything you can set in a macro, and how each one is drawn on the chart.
//
// The defense mirrors Madden 27's "Create Adjustment" screen exactly: the same
// sections, settings and options in the same order, and the same eight
// individual choices per position. Zone colors follow the game: dark blue deep,
// light blue flats, yellow hooks, purple curl-to-flat, orange QB spy.

import type { Group, Player } from "./layout";

export type Ellipse = { x: number; y: number; rx: number; ry: number };
export type ZoneDrop = "flats" | "curls" | "hooks";

/* ============================== colors ============================== */

export const ZC = {
  deep: "#2563eb",
  read: "#60a5fa",
  flat: "#38bdf8",
  squat: "#67e8f9",
  hook: "#facc15",
  curl: "#a855f7",
  seam: "#f472b6",
  spy: "#f97316",
  rush: "#ef4444",
};

/* ====================== defense: individual adjustments ====================== */

export type DefRole = "CB" | "SLCB" | "S" | "EDGE" | "DT" | "OLB" | "MLB";

export const ROLE_NAME: Record<DefRole, string> = {
  CB: "Corner",
  SLCB: "Slot corner",
  S: "Safety",
  EDGE: "Edge",
  DT: "Interior line",
  OLB: "Outside linebacker",
  MLB: "Middle linebacker",
};

/** Which of the game's individual-adjustment lists a player uses. */
export function roleOf(p: Player): DefRole | null {
  const l = p.label.replace(/\d+$/, "");
  if (p.label === "CB1" || p.label === "CB2") return "CB";
  if (l === "SLCB" || l === "CB") return "SLCB"; // CB3/CB4 in Prevent play the slots
  if (l === "FS" || l === "SS") return "S";
  if (["LEDG", "REDG", "RRE", "RLE"].includes(l)) return "EDGE";
  if (["NT", "DT", "RDT"].includes(l)) return "DT";
  if (l === "SAM" || l === "WILL") return "OLB";
  if (l === "MIKE" || l === "SLB" || l === "LB") return "MLB";
  return null;
}

export type DefCtx = {
  /** +1 when the offense's strength (the 3-receiver side) is to the right of the chart. */
  strong: 1 | -1;
  drops: Partial<Record<ZoneDrop, number>>;
};

export type DefOption = {
  key: string;
  label: string;
  kind: "zone" | "blitz" | "bluff" | "spy";
  color: string;
  drop?: ZoneDrop;
  zone?: (p: Player, c: DefCtx) => Ellipse;
};

const sideOf = (p: Player) => (p.x < 50 ? -1 : 1);
const nearMiddle = (p: Player) => Math.abs(p.x - 50) < 4;
const E = (x: number, y: number, rx: number, ry: number): Ellipse => ({ x, y, rx, ry });

const OPT: Record<string, DefOption> = {
  "outside-third": { key: "outside-third", label: "Outside Third", kind: "zone", color: ZC.deep, zone: (p) => E(50 + sideOf(p) * 34, 21, 13, 4.4) },
  "inside-third": { key: "inside-third", label: "Inside Third", kind: "zone", color: ZC.deep, zone: () => E(50, 22, 14, 4.4) },
  "middle-third": { key: "middle-third", label: "Middle Third", kind: "zone", color: ZC.deep, zone: () => E(50, 22, 14, 4.4) },
  "deep-half": { key: "deep-half", label: "Deep Half", kind: "zone", color: ZC.deep, zone: (p) => E(50 + sideOf(p) * 24, 21, 21, 4.6) },
  "outside-quarter": { key: "outside-quarter", label: "Outside Quarter", kind: "zone", color: ZC.deep, zone: (p) => E(50 + sideOf(p) * 38, 20, 10.5, 4.2) },
  "inside-quarter": { key: "inside-quarter", label: "Inside Quarter", kind: "zone", color: ZC.deep, zone: (p) => E(50 + sideOf(p) * 13, 21, 10.5, 4.2) },
  "middle-read": { key: "middle-read", label: "Middle Read", kind: "zone", color: ZC.read, zone: () => E(50, 14.5, 11, 3.4) },
  "cloud-flat": { key: "cloud-flat", label: "Cloud Flat", kind: "zone", color: ZC.flat, drop: "flats", zone: (p) => E(50 + sideOf(p) * 39, 7, 8.5, 3) },
  "hard-flat": { key: "hard-flat", label: "Hard Flat", kind: "zone", color: ZC.flat, drop: "flats", zone: (p) => E(50 + sideOf(p) * 38, 3.6, 9, 2.4) },
  "soft-squat": { key: "soft-squat", label: "Soft Squat", kind: "zone", color: ZC.squat, drop: "flats", zone: (p) => E(50 + sideOf(p) * 35, 5.5, 9, 2.8) },
  "curl-flat": { key: "curl-flat", label: "Curl Flat", kind: "zone", color: ZC.curl, drop: "curls", zone: (p) => E(50 + sideOf(p) * 32, 9.5, 9, 3.2) },
  "seam-flat": { key: "seam-flat", label: "Seam Flat", kind: "zone", color: ZC.seam, zone: (p) => E(50 + sideOf(p) * 27, 10.5, 6.5, 5) },
  "vertical-hook": { key: "vertical-hook", label: "Vertical Hook", kind: "zone", color: ZC.hook, drop: "hooks", zone: (p) => E(nearMiddle(p) ? 50 : 50 + sideOf(p) * 12, 14, 7, 4) },
  "hook-curl": { key: "hook-curl", label: "Hook Curl", kind: "zone", color: ZC.hook, drop: "hooks", zone: (p) => E(nearMiddle(p) ? 50 : 50 + sideOf(p) * 14, 10, 8, 3) },
  "3-rec-hook": { key: "3-rec-hook", label: "3 Rec Hook", kind: "zone", color: ZC.hook, drop: "hooks", zone: (_p, c) => E(50 + c.strong * 16, 10, 8, 3) },
  "hook-curl-left": { key: "hook-curl-left", label: "Hook Curl Left", kind: "zone", color: ZC.hook, drop: "hooks", zone: () => E(64, 10, 8, 3) },
  "hook-curl-right": { key: "hook-curl-right", label: "Hook Curl Right", kind: "zone", color: ZC.hook, drop: "hooks", zone: () => E(36, 10, 8, 3) },
  "curl-left": { key: "curl-left", label: "Curl Left", kind: "zone", color: ZC.curl, drop: "curls", zone: () => E(78, 10, 8, 3.2) },
  "curl-right": { key: "curl-right", label: "Curl Right", kind: "zone", color: ZC.curl, drop: "curls", zone: () => E(22, 10, 8, 3.2) },
  blitz: { key: "blitz", label: "Blitz", kind: "blitz", color: ZC.rush },
  "bluff-blitz": { key: "bluff-blitz", label: "Bluff Blitz", kind: "bluff", color: ZC.rush },
  "qb-spy": { key: "qb-spy", label: "QB Spy", kind: "spy", color: ZC.spy },
};

// Same lists, same order as the game.
export const ROLE_OPTIONS: Record<DefRole, string[]> = {
  CB: ["outside-third", "cloud-flat", "hard-flat", "curl-flat", "deep-half", "blitz", "outside-quarter", "soft-squat"],
  SLCB: ["seam-flat", "vertical-hook", "hard-flat", "curl-flat", "deep-half", "blitz", "qb-spy", "hook-curl"],
  S: ["middle-read", "hook-curl", "inside-third", "curl-flat", "deep-half", "blitz", "outside-third", "inside-quarter"],
  EDGE: ["vertical-hook", "hook-curl", "hard-flat", "curl-flat", "soft-squat", "blitz", "qb-spy", "3-rec-hook"],
  DT: ["hook-curl-left", "hook-curl-right", "curl-left", "curl-right", "bluff-blitz", "blitz", "qb-spy", "3-rec-hook"],
  OLB: ["seam-flat", "vertical-hook", "hard-flat", "curl-flat", "deep-half", "blitz", "qb-spy", "hook-curl"],
  MLB: ["middle-read", "hook-curl", "hard-flat", "curl-flat", "middle-third", "blitz", "qb-spy", "3-rec-hook"],
};

export function defOptionsFor(p: Player): DefOption[] {
  const r = roleOf(p);
  return r ? ROLE_OPTIONS[r].map((k) => OPT[k]) : [];
}
export function findDefOption(key: string): DefOption | undefined {
  return OPT[key];
}

/** Where a zone sits once the macro's zone-drop depths are applied. */
export function zoneFor(o: DefOption, p: Player, c: DefCtx): Ellipse | null {
  if (!o.zone) return null;
  const z = o.zone(p, c);
  const d = o.drop ? c.drops[o.drop] : undefined;
  return d === undefined ? z : { ...z, y: Math.max(1.8, d) };
}

/* ====================== defense: team settings ====================== */

export type Cat = { cat: string; label: string; options: { key: string; label: string }[] };
export type Section = { title: string; cats: Cat[] };

const slug = (l: string) => l.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x";
const c = (cat: string, label: string, opts: string[]): Cat => ({ cat, label, options: opts.map((o) => ({ key: slug(o), label: o })) });
const ABC = ["Aggressive", "Balanced", "Conservative"];
const DEPTHS = ["Default", "0", "5", "10", "15", "20", "25", "30"];
const SOLO = ["Default", "Solo", "Solo Cut", "Quarters"];
const BUNCH4 = ["Default", "Box", "Bingo", "Point Triangle", "Zone It"];
const STUB = ["Default", "Stubbie", "Stump", "Zone It"];
const SKATE = ["Default", "Skate", "Skinny", "Skinny Meg", "Zone It"];

export const DEF_SECTIONS: Section[] = [
  { title: "General", cats: [
    c("sb", "Show Blitz", ["Linebackers", "Secondary", "Both"]),
    c("cs", "Coverage Shading", ["Overtop", "Underneath", "Inside", "Outside"]),
    c("rc", "Route Commit", ["Default", "Inside", "Outside"]),
    c("gp", "Guess Play", ["Pass", "Run Left", "Run Right", "Run Up Middle"]),
    c("af", "Auto Flip Play Call", ["Disabled"]),
    c("mr", "Defensive Motion Response", ["Disabled"]),
    c("da", "Defender Aggression", ABC),
    c("gi", "Gap Integrity", ABC),
    c("st", "Strip Ball", ABC),
    c("tk", "Tackling", ABC),
    c("qc", "QB Contain", ["Left", "Right", "Both"]),
  ] },
  { title: "Option", cats: [
    c("ork", "Option Read Key", ABC),
    c("opk", "Option Pitch Key", ABC),
    c("rrk", "RPO Read Key", ABC),
    c("rpk", "RPO Pass Key", ABC),
  ] },
  { title: "Defensive Line", cats: [
    c("dt", "Technique", ["Pinch", "Right", "Left", "Spread"]),
    c("pa", "Point of Attack", ["Outside", "Left", "Right", "Inside"]),
    c("stu", "Stunts", [
      "Left Exit 2 Man", "Left Tex 2 Man", "Left Tom 2 Man", "Left Pirate 3 Man",
      "Left Tempe 4 Man", "Right Exit 2 Man", "Right Tex 2 Man", "Right Tom 2 Man",
      "Right Pirate 3 Man", "Right Tempe 4 Man", "El Paso 4 Man", "Texas 4 Man",
    ]),
  ] },
  { title: "Linebackers", cats: [
    c("slb", "Shift LB's", ["Spread", "Left", "Right", "Pinch"]),
    c("lba", "LB Assignments", ["Zone All", "Sam Blitz", "Will Blitz", "Blitz All"]),
  ] },
  { title: "Secondary", cats: [
    c("al", "Alignment", ["Give Cushion", "Press"]),
    c("sh", "Coverage Shell", ["2 Man", "Cov 0", "Cov 2", "Cov 3", "Cov 4", "Cov 6"]),
    c("cm", "Corner Matchup", ["By OVR", "By Speed", "By Height", "By Route Running", "By Depth Chart"]),
    c("cbd", "Cornerback Depth", ["Default", "Press", "3", "5", "7", "9", "12", "20"]),
    c("cbw", "Cornerback Width", ["Default", "Tight", "Wide"]),
    c("sd", "Safety Depth", ["Default", "5", "9", "12", "16", "25", "32"]),
    c("sw", "Safety Width", ["Default", "Pinch", "Spread", "Wide"]),
    c("sm", "Safety Midpoint", ["Default", "Left", "Right", "Strong", "Weak", "Field", "Boundary"]),
    c("bh", "Ballhawk", ["Aggressive", "Conservative"]),
  ] },
  { title: "Zone Drops", cats: [
    c("zf", "Zone Drop - Flats", DEPTHS),
    c("zc", "Zone Drops - Curls", DEPTHS),
    c("zh", "Zone Drops - Hooks", DEPTHS),
  ] },
  { title: "Coverage Strategy", cats: [
    c("zs", "Zone Strategy", ["Default", "Aggressive", "Conservative", "Ultra Aggressive", "Ultra Conservative"]),
    c("pl", "Plaster", ["Off", "Conservative (Default)", "Aggressive"]),
    c("plt", "Plaster Trigger", ["O.O.P & Time (Default)", "O.O.P", "Time"]),
    c("plm", "Plaster Time", ["Aggressive", "Default", "Conservative"]),
    c("rl", "Roll Coverage", ["Fastest", "Field", "Boundary", "Highest OVR (Default)", "Pass Strength", "WR1", "WR2", "WR3", "TE1", "TE2"]),
  ] },
  { title: "Man Coverage Checks", cats: [
    c("ms", "Man Coverage: Stack", ["Default", "Lock", "Combo", "Triangle", "Top Hat"]),
    c("mb", "Man Coverage: Bunch", ["Default", "Point Combo", "Point Triangle", "Lock"]),
  ] },
  { title: "Cover 3 Checks", cats: [
    c("3s", "3 Match: Stack", ["Default", "Top Hat", "Zone It", "Seam"]),
    c("3b", "3 Match: Bunch", SKATE),
    c("3t", "3 Match: Trips", SKATE),
  ] },
  { title: "Cover 4 Checks", cats: [
    c("qs", "Quarters: Stack", ["Default", "Quarters", "Triangle", "Zone It"]),
    c("qb", "Quarters: Bunch", BUNCH4),
    c("qt", "Quarters: Trips", ["Default", "Quarters", "Stress", "Zone It"]),
    c("q1", "Quarters: 1 Rec", SOLO),
    c("q1t", "Quarters: 1 Rec Tight", SOLO),
    c("ps", "Palms: Stack", ["Default", "Palms", "Triangle", "Zone It"]),
    c("pb", "Palms: Bunch", BUNCH4),
    c("pt", "Palms: Trips", STUB),
    c("p1", "Palms: 1 Rec", SOLO),
    c("p1t", "Palms: 1 Rec Tight", SOLO),
  ] },
  { title: "Cover 6 Checks", cats: [
    c("6s", "Cover 6: Stack", ["Default", "Palms", "Zone It", "Triangle", "Quarters"]),
    c("6b", "Cover 6: Bunch", BUNCH4),
    c("6t", "Cover 6: Trips", STUB),
  ] },
];

/* ====================== offense: team settings ====================== */

export const OFF_SECTIONS: Section[] = [
  { title: "Protection", cats: [c("slide", "Slide Protection", ["Slide Left", "Slide Right"])] },
];

export function sectionsFor(side: "O" | "D") {
  return side === "O" ? OFF_SECTIONS : DEF_SECTIONS;
}
export function findCat(side: "O" | "D", cat: string): Cat | undefined {
  for (const s of sectionsFor(side)) for (const x of s.cats) if (x.cat === cat) return x;
  return undefined;
}

/* ====================== chart effects of team settings ====================== */

const num = (v: string | undefined) => (v && /^\d+$/.test(v) ? Number(v) : undefined);

export function defCtx(adj: Record<string, string>, strong: 1 | -1): DefCtx {
  return { strong, drops: { flats: num(adj.zf), curls: num(adj.zc), hooks: num(adj.zh) } };
}

/** Moves the team settings make to where players line up. */
export function applyAdjustments(players: Player[], adj: Record<string, string>, strong: 1 | -1): Player[] {
  const safeties = players.filter((p) => roleOf(p) === "S" && p.y > 9);
  const twoHigh = safeties.length >= 2;
  return players.map((p) => {
    let { x, y } = p;
    const role = roleOf(p);
    const out = x < 50 ? -1 : 1;

    if (p.group === "DL") {
      if (adj.dt === "pinch") x = 50 + (x - 50) * 0.8;
      if (adj.dt === "spread") x = 50 + (x - 50) * 1.18;
      // The defense's left is the right side of the chart (it faces the offense).
      if (adj.dt === "left") x += 4;
      if (adj.dt === "right") x -= 4;
    }
    if (p.group === "LB") {
      if (adj.slb === "pinch") x = 50 + (x - 50) * 0.75;
      if (adj.slb === "spread") x = 50 + (x - 50) * 1.25;
      if (adj.slb === "left") x += 5;
      if (adj.slb === "right") x -= 5;
      if (adj.sb === "linebackers" || adj.sb === "both") y = Math.max(2.6, y - 2.8);
    }
    if (role === "CB" || role === "SLCB") {
      if (adj.cs === "inside") x -= 2.5 * out;
      if (adj.cs === "outside") x += 2.5 * out;
      if (adj.cs === "overtop") y += 2;
      if (adj.cs === "underneath") y = Math.max(1.8, y - 1.5);
    }
    if (role === "CB") {
      if (adj.al === "press") y = 2.4;
      if (adj.al === "give-cushion") y = 9;
      if (adj.cbd === "press") y = 2.4;
      const d = num(adj.cbd);
      if (d !== undefined) y = Math.max(2.4, d);
      if (adj.cbw === "tight") x -= 6 * out;
      if (adj.cbw === "wide") x = out < 0 ? 4 : 96;
    }
    if (role === "S") {
      const d = num(adj.sd);
      if (d !== undefined) y = Math.min(26, Math.max(3, d));
      if (twoHigh && p.y > 9) {
        const so = x < 50 ? -1 : 1;
        if (adj.sw === "pinch") x = 50 + so * 8;
        if (adj.sw === "spread") x = 50 + so * 20;
        if (adj.sw === "wide") x = 50 + so * 30;
      }
      const shift = adj.sm === "left" ? 8 : adj.sm === "right" ? -8 : adj.sm === "strong" ? 8 * strong : adj.sm === "weak" ? -8 * strong : 0;
      x += shift;
      // Showing blitz walks the safeties down into the box, inside the slots.
      if (adj.sb === "secondary" || adj.sb === "both") {
        y = Math.min(y, 5);
        x = 50 + (x < 50 ? -1 : 1) * 15;
      }
    }
    return { ...p, x: Math.min(97, Math.max(3, x)), y };
  });
}

/** One line per team setting for the caption under the chart, in the game's order. */
export function settingsLines(side: "O" | "D", adj: Record<string, string>): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  for (const s of sectionsFor(side)) for (const k of s.cats) {
    const v = adj[k.cat];
    if (!v) continue;
    const o = k.options.find((x) => x.key === v);
    if (o) out.push({ label: k.label, value: o.label });
  }
  return out;
}

/* ============================== stunts ============================== */

export type StuntMove = { id: string; kind: "crash" | "loop"; dx: number };

/**
 * Which linemen move and where, for each stunt. Linemen are taken left-to-right on the
 * chart; the defense's left is the right side of the chart. dx is how far across (field
 * units) the man ends up, positive toward the defense's left.
 */
export function stuntMoves(stunt: string, dl: Player[]): StuntMove[] {
  const line = [...dl].sort((a, b) => a.x - b.x);
  if (line.length < 2) return [];
  const n = line.length;
  // Defense's left side runs from the right end of the chart inward.
  const leftSide = [...line].reverse();
  const rightSide = line;
  const pair = (side: Player[], first: "end" | "tackle"): StuntMove[] => {
    const [end, tackle] = side;
    const dir = side === leftSide ? 1 : -1; // toward that side's sideline on the chart
    return first === "end"
      ? [{ id: end.id, kind: "crash", dx: -dir * 8 }, { id: tackle.id, kind: "loop", dx: dir * 10 }]
      : [{ id: tackle.id, kind: "crash", dx: dir * 7 }, { id: end.id, kind: "loop", dx: -dir * 11 }];
  };
  const slant = (side: Player[], count: number): StuntMove[] => {
    const dir = side === leftSide ? 1 : -1;
    return side.slice(0, Math.min(count, n)).map((p) => ({ id: p.id, kind: "crash" as const, dx: dir * 6 }));
  };
  const tom = (side: Player[]): StuntMove[] => {
    const dir = side === leftSide ? 1 : -1;
    const t = side[1] ?? side[0];
    const inner = side[2] ?? side[1];
    if (!t || !inner || t === inner) return [];
    return [{ id: t.id, kind: "crash", dx: -dir * 7 }, { id: inner.id, kind: "loop", dx: dir * 9 }];
  };
  switch (stunt) {
    case "left-exit-2-man": return pair(leftSide, "end");
    case "right-exit-2-man": return pair(rightSide, "end");
    case "left-tex-2-man": return pair(leftSide, "tackle");
    case "right-tex-2-man": return pair(rightSide, "tackle");
    case "left-tom-2-man": return tom(leftSide);
    case "right-tom-2-man": return tom(rightSide);
    case "left-pirate-3-man": return slant(leftSide, 3);
    case "right-pirate-3-man": return slant(rightSide, 3);
    case "left-tempe-4-man": return slant(leftSide, 4);
    case "right-tempe-4-man": return slant(rightSide, 4);
    case "el-paso-4-man": return n >= 4 ? [...pair(leftSide, "end"), ...pair(rightSide, "end")] : pair(leftSide, "end");
    case "texas-4-man": return n >= 4 ? [...pair(leftSide, "tackle"), ...pair(rightSide, "tackle")] : pair(leftSide, "tackle");
  }
  return [];
}

/* ====================== offense: individual ====================== */
// Routes are drawn from the player's spot. dx is "toward the sideline on his side",
// so the same route flips correctly for a receiver on either side of the ball.
export type RoutePath = { pts: [number, number][]; curve?: boolean };

export type OffOption = {
  key: string;
  label: string;
  kind: "route" | "block" | "motion";
  color: string;
  group: string;
  for: Group[];
  path?: RoutePath;
};

const SKILL: Group[] = ["WR", "TE", "RB"];
const BACKS: Group[] = ["RB", "TE"];

export const OFFENSE_ASSIGNMENTS: OffOption[] = [
  { key: "streak", label: "Streak", kind: "route", color: "#fff", group: "Routes", for: SKILL, path: { pts: [[0, 24]] } },
  { key: "fade", label: "Fade", kind: "route", color: "#fff", group: "Routes", for: SKILL, path: { pts: [[3, 10], [6, 22]], curve: true } },
  { key: "slant", label: "Slant", kind: "route", color: "#fff", group: "Routes", for: SKILL, path: { pts: [[0, 2], [-10, 7]] } },
  { key: "in", label: "In", kind: "route", color: "#fff", group: "Routes", for: SKILL, path: { pts: [[0, 10], [-20, 10]] } },
  { key: "out", label: "Out", kind: "route", color: "#fff", group: "Routes", for: SKILL, path: { pts: [[0, 10], [12, 10]] } },
  { key: "quick-out", label: "Quick Out", kind: "route", color: "#fff", group: "Routes", for: SKILL, path: { pts: [[0, 5], [10, 5]] } },
  { key: "curl", label: "Curl", kind: "route", color: "#fff", group: "Routes", for: SKILL, path: { pts: [[0, 11], [-2, 9]] } },
  { key: "comeback", label: "Comeback", kind: "route", color: "#fff", group: "Routes", for: SKILL, path: { pts: [[0, 15], [3, 12.5]] } },
  { key: "drag", label: "Drag", kind: "route", color: "#fff", group: "Routes", for: SKILL, path: { pts: [[-3, 2], [-34, 3]] } },
  { key: "post", label: "Post", kind: "route", color: "#fff", group: "Routes", for: SKILL, path: { pts: [[0, 10], [-12, 21]] } },
  { key: "corner", label: "Corner", kind: "route", color: "#fff", group: "Routes", for: SKILL, path: { pts: [[0, 10], [11, 18]] } },
  { key: "hitch", label: "Hitch", kind: "route", color: "#fff", group: "Routes", for: SKILL, path: { pts: [[0, 6], [-1, 4.5]] } },
  { key: "wheel", label: "Wheel", kind: "route", color: "#fff", group: "Back routes", for: SKILL, path: { pts: [[10, 1], [14, 6], [14, 20]], curve: true } },
  { key: "flat", label: "Flat", kind: "route", color: "#fff", group: "Back routes", for: BACKS, path: { pts: [[6, 3], [20, 4]], curve: true } },
  { key: "swing", label: "Swing", kind: "route", color: "#fff", group: "Back routes", for: BACKS, path: { pts: [[8, -2], [18, 1]], curve: true } },
  { key: "angle", label: "Angle", kind: "route", color: "#fff", group: "Back routes", for: BACKS, path: { pts: [[7, 4], [-3, 9]] } },
  { key: "texas", label: "Texas", kind: "route", color: "#fff", group: "Back routes", for: BACKS, path: { pts: [[8, 3], [-6, 8]] } },
  { key: "block", label: "Pass Block", kind: "block", color: "#cbd5e1", group: "Blocking & motion", for: SKILL },
  { key: "motion", label: "Motion Across", kind: "motion", color: "#cbd5e1", group: "Blocking & motion", for: ["WR", "TE", "RB"] },
];

export function offOptionsFor(p: Player): OffOption[] {
  return OFFENSE_ASSIGNMENTS.filter((a) => a.for.includes(p.group));
}
export function findOffOption(key: string): OffOption | undefined {
  return OFFENSE_ASSIGNMENTS.find((a) => a.key === key);
}
