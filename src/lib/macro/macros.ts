// Everything you can set in a macro, and how each one is drawn on the chart.
// Zone colors follow Madden's coverage colors so the picture reads like the game:
// dark blue deep, light blue flats, yellow hooks, purple curl-to-flat.

import type { Group, Player } from "./layout";

export type Spot = { id: string; label: string; x: number; y: number; rx: number; ry: number };

export type Assignment = {
  key: string;
  label: string;
  kind: "zone" | "blitz" | "spy" | "contain" | "man" | "route" | "block" | "motion";
  color: string;
  group: string; // heading in the picker
  spots?: Spot[]; // zones: where on the field; blitz: which gap
  for: Group[]; // who can take it
};

const DEEP = "#2563eb";
const FLAT = "#38bdf8";
const HOOK = "#facc15";
const CURL = "#a855f7";
const BUZZ = "#fb923c";
const SPY = "#f97316";
const RED = "#ef4444";

const DEF: Group[] = ["DL", "LB", "CB", "S"];
const COVER: Group[] = ["LB", "CB", "S", "DL"];

const s = (id: string, label: string, x: number, y: number, rx: number, ry: number): Spot => ({ id, label, x, y, rx, ry });

export const DEFENSE_ASSIGNMENTS: Assignment[] = [
  { key: "deep-half", label: "Deep Half", kind: "zone", color: DEEP, group: "Deep zones", for: COVER,
    spots: [s("L", "Left", 26, 21, 21, 4.6), s("R", "Right", 74, 21, 21, 4.6)] },
  { key: "deep-third", label: "Deep Third", kind: "zone", color: DEEP, group: "Deep zones", for: COVER,
    spots: [s("L", "Left", 16, 21, 13, 4.4), s("M", "Middle", 50, 22, 14, 4.4), s("R", "Right", 84, 21, 13, 4.4)] },
  { key: "deep-quarter", label: "Deep Quarter", kind: "zone", color: DEEP, group: "Deep zones", for: COVER,
    spots: [s("L", "Outside left", 12, 20, 10.5, 4.2), s("LC", "Inside left", 37, 21, 10.5, 4.2),
      s("RC", "Inside right", 63, 21, 10.5, 4.2), s("R", "Outside right", 88, 20, 10.5, 4.2)] },
  { key: "deep-middle", label: "Deep Middle", kind: "zone", color: DEEP, group: "Deep zones", for: COVER,
    spots: [s("M", "Middle", 50, 22, 18, 4.6)] },

  { key: "hook", label: "Hook Curl", kind: "zone", color: HOOK, group: "Underneath zones", for: COVER,
    spots: [s("L", "Left", 36, 10, 8, 3), s("M", "Middle", 50, 10.5, 8, 3), s("R", "Right", 64, 10, 8, 3)] },
  { key: "vert-hook", label: "Vertical Hook", kind: "zone", color: HOOK, group: "Underneath zones", for: COVER,
    spots: [s("L", "Left", 38, 14, 7, 4), s("M", "Middle", 50, 14.5, 7, 4), s("R", "Right", 62, 14, 7, 4)] },
  { key: "curl-flat", label: "Curl Flat", kind: "zone", color: CURL, group: "Underneath zones", for: COVER,
    spots: [s("L", "Left", 18, 9.5, 9, 3.2), s("R", "Right", 82, 9.5, 9, 3.2)] },
  { key: "flat", label: "Flat", kind: "zone", color: FLAT, group: "Underneath zones", for: COVER,
    spots: [s("L", "Left", 10, 4.5, 8, 2.6), s("R", "Right", 90, 4.5, 8, 2.6)] },
  { key: "cloud-flat", label: "Cloud Flat", kind: "zone", color: FLAT, group: "Underneath zones", for: COVER,
    spots: [s("L", "Left", 11, 7, 8.5, 3), s("R", "Right", 89, 7, 8.5, 3)] },
  { key: "buzz", label: "Buzz", kind: "zone", color: BUZZ, group: "Underneath zones", for: COVER,
    spots: [s("L", "Left", 28, 8.5, 7.5, 3), s("R", "Right", 72, 8.5, 7.5, 3)] },
  { key: "robber", label: "Robber", kind: "zone", color: HOOK, group: "Underneath zones", for: COVER,
    spots: [s("M", "Middle", 50, 13, 9, 3.2)] },
  { key: "seam", label: "Seam", kind: "zone", color: CURL, group: "Underneath zones", for: COVER,
    spots: [s("L", "Left", 30, 15, 6, 4.5), s("R", "Right", 70, 15, 6, 4.5)] },

  { key: "man", label: "Man", kind: "man", color: RED, group: "Man & pressure", for: COVER },
  { key: "blitz", label: "Blitz", kind: "blitz", color: RED, group: "Man & pressure", for: DEF,
    spots: [s("LE", "Left edge", 30, -6, 0, 0), s("LC", "Left C gap", 35, -6, 0, 0), s("LB", "Left B gap", 41, -6, 0, 0),
      s("LA", "Left A gap", 47, -6, 0, 0), s("RA", "Right A gap", 53, -6, 0, 0), s("RB", "Right B gap", 59, -6, 0, 0),
      s("RC", "Right C gap", 65, -6, 0, 0), s("RE", "Right edge", 70, -6, 0, 0)] },
  { key: "contain", label: "QB Contain", kind: "contain", color: RED, group: "Man & pressure", for: DEF,
    spots: [s("L", "Left", 28, -5, 0, 0), s("R", "Right", 72, -5, 0, 0)] },
  { key: "spy", label: "QB Spy", kind: "spy", color: SPY, group: "Man & pressure", for: DEF },
];

// ---------- offense ----------
// Routes are drawn from the player's spot. dx is "toward the sideline on his side",
// so the same route flips correctly for a receiver on either side of the ball.
export type RoutePath = { pts: [number, number][]; curve?: boolean };

const SKILL: Group[] = ["WR", "TE", "RB"];
const BACKS: Group[] = ["RB", "TE"];

export const OFFENSE_ASSIGNMENTS: (Assignment & { path?: RoutePath })[] = [
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

// ---------- team-wide adjustments ----------
export type Adjust = { cat: string; label: string; options: { key: string; label: string }[]; side: "O" | "D" };

export const ADJUSTMENTS: Adjust[] = [
  { cat: "shade", side: "D", label: "Coverage shade", options: [
    { key: "inside", label: "Inside" }, { key: "outside", label: "Outside" },
    { key: "under", label: "Underneath" }, { key: "over", label: "Over the top" }] },
  { cat: "corners", side: "D", label: "Corners", options: [
    { key: "press", label: "Press" }, { key: "bail", label: "Bail" }, { key: "off", label: "Off" }] },
  { cat: "dline", side: "D", label: "D-line", options: [
    { key: "pinch", label: "Pinch" }, { key: "spread", label: "Spread" },
    { key: "left", label: "Shift left" }, { key: "right", label: "Shift right" }] },
  { cat: "lbs", side: "D", label: "Linebackers", options: [
    { key: "pinch", label: "Pinch" }, { key: "spread", label: "Spread" },
    { key: "left", label: "Shift left" }, { key: "right", label: "Shift right" }, { key: "show", label: "Show blitz" }] },
  { cat: "safeties", side: "D", label: "Safeties", options: [
    { key: "sink", label: "Sink" }, { key: "show2", label: "Show 2-high" }, { key: "show1", label: "Show 1-high" },
    { key: "showblitz", label: "Show blitz" }] },
  { cat: "slide", side: "O", label: "Slide protection", options: [{ key: "left", label: "Slide left" }, { key: "right", label: "Slide right" }] },
];

export function assignmentsFor(side: "O" | "D") {
  return side === "O" ? OFFENSE_ASSIGNMENTS : DEFENSE_ASSIGNMENTS;
}
export function findAssignment(side: "O" | "D", key: string) {
  return assignmentsFor(side).find((a) => a.key === key);
}

/** Pick the spot that best fits where the player lines up. */
export function nearestSpot(a: Assignment, p: Player): Spot | undefined {
  if (!a.spots?.length) return undefined;
  return [...a.spots].sort((u, v) => Math.abs(u.x - p.x) - Math.abs(v.x - p.x))[0];
}

/** Moves the team-wide adjustments make to the drawn alignment. */
export function applyAdjustments(players: Player[], adj: Record<string, string>): Player[] {
  return players.map((p) => {
    let { x, y } = p;
    if (p.group === "DL") {
      if (adj.dline === "pinch") x = 50 + (x - 50) * 0.8;
      if (adj.dline === "spread") x = 50 + (x - 50) * 1.18;
      if (adj.dline === "left") x -= 4;
      if (adj.dline === "right") x += 4;
    }
    if (p.group === "LB") {
      if (adj.lbs === "pinch") x = 50 + (x - 50) * 0.75;
      if (adj.lbs === "spread") x = 50 + (x - 50) * 1.25;
      if (adj.lbs === "left") x -= 5;
      if (adj.lbs === "right") x += 5;
      if (adj.lbs === "show") y = Math.max(2.6, y - 2.8);
    }
    if (p.group === "CB") {
      const inward = x < 50 ? 1 : -1;
      if (adj.corners === "press") y = 2.4;
      if (adj.corners === "bail") y = 9;
      if (adj.corners === "off") y = 8;
      if (adj.shade === "inside") x += 2.5 * inward;
      if (adj.shade === "outside") x -= 2.5 * inward;
    }
    if (p.group === "S") {
      if (adj.safeties === "sink") y += 3;
      if (adj.safeties === "showblitz") y = Math.min(y, 5);
      if (adj.safeties === "show1") {
        if (p.label === "FS") { x = 50; y = Math.max(y, 14); }
        else if (y > 9) { y = 7; }
      }
      if (adj.safeties === "show2" && y > 9) x = x < 50 ? 34 : x > 50 ? 66 : 66;
    }
    return { ...p, x, y };
  });
}
