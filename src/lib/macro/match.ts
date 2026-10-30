// Match preview: how a match coverage check plays against the offense on the chart.
//
// It reads the offense's structure on each side (bunch, trips, stack, two wide, or a
// lone receiver), finds which of the macro's check settings applies there, and lays out
// each defender's job: carry #1 deep, wall #2 to the flat, bracket the deeper route,
// lock in man, and so on. Rules follow the game's descriptions of each check; where a
// check depends on the routes, the preview shows its main read.

import type { Player } from "./layout";
import { roleOf } from "./macros";

export type MatchFamily = "c3" | "q" | "palms" | "c6" | "man" | "man2";

export const MATCH_FAMILIES: { key: MatchFamily; label: string }[] = [
  { key: "c3", label: "Cover 3 Match" },
  { key: "q", label: "Cover 4 Quarters" },
  { key: "palms", label: "Cover 4 Palms" },
  { key: "c6", label: "Cover 6" },
  { key: "man", label: "Cover 1 / 0 Man" },
  { key: "man2", label: "Cover 2 Man" },
];

/** The coverage the preview starts on, from the macro's Coverage Shell. */
export function familyFromShell(shell: string | undefined): MatchFamily {
  if (shell === "cov-4") return "q";
  if (shell === "cov-6") return "c6";
  if (shell === "cov-0") return "man";
  if (shell === "2-man") return "man2";
  return "c3";
}

export type Kind = "lock" | "match" | "bracket" | "zone" | "help";
export type Pt = { x: number; y: number };
export type MatchLine = { from: string; to: Pt; kind: Kind; tag: string };
export type Rec = { id: string; x: number; y: number; n: number };
export type MatchPlan = {
  lines: MatchLine[];
  recs: Rec[];
  notes: { label: string; value: string }[];
};

type Struct = "bunch" | "trips" | "stack" | "pair" | "single" | "none";

// ---------- check settings: which category applies, its default, and what each option does ----------

type CheckSet = Partial<Record<"stack" | "bunch" | "trips" | "single" | "tight", { cat: string; def: string }>>;
const CATS: Record<MatchFamily, CheckSet> = {
  c3: { stack: { cat: "3s", def: "seam" }, bunch: { cat: "3b", def: "skate" }, trips: { cat: "3t", def: "skinny" } },
  q: {
    stack: { cat: "qs", def: "quarters" }, bunch: { cat: "qb", def: "box" }, trips: { cat: "qt", def: "quarters" },
    single: { cat: "q1", def: "solo" }, tight: { cat: "q1t", def: "solo" },
  },
  palms: {
    stack: { cat: "ps", def: "palms" }, bunch: { cat: "pb", def: "box" }, trips: { cat: "pt", def: "stubbie" },
    single: { cat: "p1", def: "solo" }, tight: { cat: "p1t", def: "solo" },
  },
  c6: { stack: { cat: "6s", def: "quarters" }, bunch: { cat: "6b", def: "box" }, trips: { cat: "6t", def: "stubbie" } },
  man: { stack: { cat: "ms", def: "lock" }, bunch: { cat: "mb", def: "lock" } },
  man2: { stack: { cat: "ms", def: "lock" }, bunch: { cat: "mb", def: "lock" } },
};

const NAMES: Record<string, string> = {
  seam: "Seam", skate: "Skate", skinny: "Skinny", "skinny-meg": "Skinny Meg", "zone-it": "Zone It", "top-hat": "Top Hat",
  quarters: "Quarters", triangle: "Triangle", box: "Box", bingo: "Bingo", "point-triangle": "Point Triangle", stress: "Stress",
  solo: "Solo", "solo-cut": "Solo Cut", palms: "Palms", stubbie: "Stubbie", stump: "Stump", lock: "Lock", combo: "Combo",
  "point-combo": "Point Combo",
};

/** One-line explanation for each check option, keyed by settings category, shown under the option buttons. */
export const CHECK_INFO: Record<string, Record<string, string>> = {
  ms: {
    default: "Game default for stacks (Lock).",
    lock: "Everyone stays on his own man through the stack. No switching.",
    combo: "The two defenders on the stack switch: one takes the first inside break, the other the first outside break.",
    triangle: "Corner and the nearest underneath defender combo the stack; a safety brackets whoever goes deeper.",
    "top-hat": "The two defenders swap who takes the front and back receiver.",
  },
  mb: {
    default: "Game default for bunches (Lock).",
    "point-combo": "The man on the point (#2) locks on; the defenders on #1 and #3 switch inside/outside.",
    "point-triangle": "Defenders on #1 and #3 combo; a safety brackets whoever goes deeper or breaks to him.",
    lock: "Everyone stays on his own man through the bunch.",
  },
  "3s": {
    default: "Game default for stacks (Seam).",
    "top-hat": "Front and back receivers are passed between the corner and seam player, with the middle safety over the top.",
    "zone-it": "No matching: everyone drops to his zone.",
    seam: "Corner carries #1 deep; the seam player takes #2 out or vertical; underneath defenders switch as routes develop.",
  },
  "3b": {
    default: "Game default for bunches (Skate).",
    skate: "Underneath defenders widen toward the bunch: overhang to the flat, trips-side hook to curl-flat, backside hook walls #3.",
    skinny: "Corner carries #1 deep, seam player takes #2 out or vertical, hook reads #3.",
    "skinny-meg": "Skinny, plus the backside corner plays man everywhere he goes on the lone receiver.",
    "zone-it": "No matching: everyone drops to his zone.",
  },
  "3t": {
    default: "Game default for trips (Skinny).",
    skate: "Underneath defenders widen toward trips: overhang to the flat, trips-side hook to curl-flat, backside hook walls #3.",
    skinny: "Corner carries #1 deep, seam player takes #2 out or vertical, hook reads #3.",
    "skinny-meg": "Skinny, plus the backside corner plays man everywhere he goes on the lone receiver.",
    "zone-it": "No matching: everyone drops to his zone.",
  },
};
const Q_STACK = {
  default: "Game default for stacks (Quarters).",
  quarters: "Corner takes #1 deep, safety takes #2 vertical, flat defender takes #2 to the flat, hook takes #3.",
  triangle: "Corner and flat defender combo the stack; the safety brackets whoever goes deeper.",
  "zone-it": "No matching: everyone drops to his zone.",
};
const BUNCH = {
  default: "Game default for bunches (Box).",
  box: "Four defenders split the bunch by area: corner deep outside, safety deep inside, flat defender the flat, hook short inside.",
  bingo: "Box, but the corner locks #1 in man if #1 stays outside.",
  "point-triangle": "Flat defender locks the point (#2); corner and hook combo #1 and #3; safety brackets the deeper route.",
  "zone-it": "No matching: everyone drops to his zone.",
};
const ONE_REC = {
  default: "Game default for a lone receiver (Solo).",
  solo: "Backside corner plays man everywhere he goes on the lone receiver; backside safety is free to rob #3 on the other side.",
  "solo-cut": "Backside safety takes the lone receiver's inside breaks; the corner is free to help on the other side.",
  quarters: "Corner and safety both match the lone receiver. No free player.",
};
const STUB = {
  default: "Game default for trips (Stubbie).",
  stubbie: "Corner locks #1; nickel jumps #2's quick out; safety reads #3, then #2.",
  stump: "Stubbie, with help jumping #1's short routes.",
  "zone-it": "No matching: everyone drops to his zone.",
};
Object.assign(CHECK_INFO, {
  qs: Q_STACK,
  qb: BUNCH,
  qt: {
    default: "Game default for trips (Quarters).",
    quarters: "Corner takes #1 deep, safety #2 vertical, flat defender #2 to the flat, hook takes #3.",
    stress: "If everyone goes vertical, the deep defenders turn to zone and split the field evenly.",
    "zone-it": "No matching: everyone drops to his zone.",
  },
  q1: ONE_REC,
  q1t: ONE_REC,
  ps: {
    default: "Game default for stacks (Palms).",
    palms: "Corner reads #2: if #2 goes to the flat the corner takes him and the safety takes #1 deep.",
    triangle: "Corner and flat defender combo the stack; the safety brackets whoever goes deeper.",
    "zone-it": "No matching: everyone drops to his zone.",
  },
  pb: BUNCH,
  pt: STUB,
  p1: ONE_REC,
  p1t: ONE_REC,
  "6s": { ...Q_STACK, palms: "Corner reads #2: if #2 goes to the flat the corner takes him and the safety takes #1 deep." },
  "6b": BUNCH,
  "6t": STUB,
});

// ---------- the plan ----------

const sideOf = (x: number) => (x < 50 ? -1 : 1);
const clampX = (x: number) => Math.min(96, Math.max(4, x));

function receivers(offense: Player[]) {
  const eligible = offense.filter((p) => ["WR", "TE", "RB"].includes(p.group) && p.y >= -6.1 && Math.abs(p.x - 50) > 4);
  // Outside-in; when two line up stacked, the one nearer the line is the outer number.
  const bySide = (s: number) =>
    eligible.filter((p) => sideOf(p.x) === s).sort((a, b) => (Math.abs(a.x - b.x) < 3 ? b.y - a.y : Math.abs(b.x - 50) - Math.abs(a.x - 50)));
  return { L: bySide(-1), R: bySide(1) };
}

function structure(rs: Player[]): Struct {
  if (rs.length === 0) return "none";
  if (rs.length === 1) return "single";
  if (rs.length === 2) return Math.abs(rs[0].x - rs[1].x) < 3 ? "stack" : "pair";
  const three = rs.slice(0, 3);
  const span = Math.max(...three.map((r) => r.x)) - Math.min(...three.map((r) => r.x));
  return span <= 10 ? "bunch" : "trips";
}

const STRUCT_NAME: Record<Struct, string> = { bunch: "Bunch", trips: "Trips", stack: "Stack", pair: "Two wide", single: "1 Rec", none: "" };

export function planMatch(family: MatchFamily, adj: Record<string, string>, defense: Player[], offense: Player[]): MatchPlan | null {
  if (!offense.length) return null;
  const { L, R } = receivers(offense);
  const strongS: -1 | 1 = L.length > R.length ? -1 : 1;
  const strong = strongS < 0 ? L : R;
  const weak = strongS < 0 ? R : L;
  const sStruct = structure(strong);
  const wStruct = structure(weak);

  const recs: Rec[] = [...L.map((p, i) => ({ id: p.id, x: p.x, y: p.y, n: i + 1 })), ...R.map((p, i) => ({ id: p.id, x: p.x, y: p.y, n: i + 1 }))];
  const lines: MatchLine[] = [];
  const notes: { label: string; value: string }[] = [{ label: "Match preview", value: MATCH_FAMILIES.find((f) => f.key === family)!.label }];
  const used = new Set<string>();

  // --- defenders ---
  const take = (p: Player | undefined) => {
    if (p) used.add(p.id);
    return p;
  };
  const free = defense.filter((p) => roleOf(p));
  const on = (s: number) => free.filter((p) => sideOf(p.x) === s && !used.has(p.id));
  const pick = {
    cb: (s: number) => take(on(s).filter((p) => roleOf(p) === "CB").sort((a, b) => Math.abs(b.x - 50) - Math.abs(a.x - 50))[0]),
    nb: (s: number, near?: Player) => {
      const pool = on(s);
      const slot = pool.find((p) => roleOf(p) === "SLCB");
      const low = pool.filter((p) => (roleOf(p) === "S" && p.y < 9) || roleOf(p) === "OLB").sort((a, b) => (near ? Math.abs(a.x - near.x) - Math.abs(b.x - near.x) : Math.abs(b.x - 50) - Math.abs(a.x - 50)));
      return take(slot ?? low[0] ?? pool.filter((p) => p.group === "LB").sort((a, b) => Math.abs(b.x - 50) - Math.abs(a.x - 50))[0]);
    },
    saf: (s: number) => take(on(s).filter((p) => roleOf(p) === "S" && p.y >= 9).sort((a, b) => b.y - a.y)[0] ?? free.filter((p) => roleOf(p) === "S" && !used.has(p.id)).sort((a, b) => b.y - a.y)[0]),
    hook: (s: number) => take(on(s).filter((p) => p.group === "LB").sort((a, b) => Math.abs(a.x - 50) - Math.abs(b.x - 50))[0] ?? free.filter((p) => p.group === "LB" && !used.has(p.id)).sort((a, b) => Math.abs(a.x - 50) - Math.abs(b.x - 50))[0]),
    middle: () => take(free.filter((p) => roleOf(p) === "S" && p.y >= 9 && !used.has(p.id)).sort((a, b) => Math.abs(a.x - 50) - Math.abs(b.x - 50))[0]),
  };

  // --- targets ---
  const vert = (r: Player): Pt => ({ x: r.x, y: 14 });
  const flat = (r: Player, s: number): Pt => ({ x: clampX(r.x + s * 7), y: 3 });
  const inside = (r: Player, s: number): Pt => ({ x: clampX(r.x - s * 9), y: 6.5 });
  const man = (r: Player): Pt => ({ x: r.x, y: r.y });
  const add = (d: Player | undefined, to: Pt | undefined, kind: Kind, tag: string) => {
    if (d && to) lines.push({ from: d.id, to, kind, tag });
  };
  const zone = (d: Player | undefined, x: number, y: number, tag: string) => add(d, { x: clampX(x), y }, "zone", tag);

  const checkFor = (struct: Struct, rs: Player[]) => {
    const set = CATS[family];
    const slot = struct === "single" ? (Math.abs(rs[0].x - 50) < 22 ? set.tight : set.single) : struct === "pair" ? undefined : set[struct as "stack" | "bunch" | "trips"];
    if (!slot) return { cat: undefined, key: "base" };
    const v = adj[slot.cat];
    return { cat: slot.cat, key: !v || v === "default" ? slot.def : v };
  };

  const sCheck = checkFor(sStruct, strong);
  const wCheck = wStruct === "none" ? { cat: undefined, key: "base" } : checkFor(wStruct, weak);
  const sideName = (s: number) => (s < 0 ? "left" : "right");
  if (sStruct !== "none") notes.push({ label: `${STRUCT_NAME[sStruct]} (${sideName(strongS)})`, value: NAMES[sCheck.key] ?? "Base rules" });
  if (wStruct !== "none") notes.push({ label: `${STRUCT_NAME[wStruct]} (${sideName(-strongS)})`, value: NAMES[wCheck.key] ?? "Base rules" });

  const s = strongS;
  const w = -strongS as -1 | 1;
  const [s1, s2, s3] = strong;
  const [w1, w2] = weak;
  const front = (a: Player, b: Player) => (a.y >= b.y ? [a, b] : [b, a]);
  const center = (rs: Player[]) => rs.slice(0, 3).reduce((n, r) => n + r.x, 0) / Math.min(3, rs.length);

  // =============== Cover 3 Match ===============
  if (family === "c3") {
    const cb = pick.cb(s);
    const nb = sStruct === "single" ? undefined : pick.nb(s, s2);
    const hook = pick.hook(s);
    const mid = pick.middle();
    const wcb = pick.cb(w);
    const whook = pick.hook(w);
    const meg = sCheck.key === "skinny-meg";
    const k = sCheck.key;
    if (k === "zone-it" || (k === "skate" && (sStruct === "bunch" || sStruct === "trips"))) {
      zone(cb, 50 + s * 34, 19, "deep 1/3");
      if (k === "skate") {
        zone(nb, 50 + s * 38, 10, "flat (10 yds)");
        zone(hook, 50 + s * 27, 12, "skates to curl-flat");
        if (s3) add(whook, man(s3), "match", "walls #3");
        zone(mid, 50, 20, "deep middle");
      } else {
        zone(nb, 50 + s * 30, 9, "curl-flat");
        zone(hook, 50 + s * 14, 8, "hook");
        zone(mid, 50, 20, "middle 1/3");
        zone(whook, 50 + w * 14, 8, "hook");
      }
    } else if (k === "top-hat" && sStruct === "stack") {
      const [f, b] = front(s1, s2);
      add(cb, man(f), "match", "front");
      add(nb, man(b), "match", "back");
      add(mid, vert(f), "bracket", "over the top");
      add(hook, inside(s2, s), "zone", "hook");
    } else {
      // Seam / Skinny (and the base rule): corner carries #1, seam player #2 out or vertical, hook reads #3.
      if (s1) add(cb, vert(s1), "match", "carries #1 deep");
      if (s2) add(nb, man(s2), "match", "#2 out / vertical");
      if (s3) add(hook, man(s3), "match", "reads #3");
      else if (s2) add(hook, inside(s2, s), "zone", "hook, switches");
      zone(mid, 50, 20, "middle 1/3");
      if (whook) zone(whook, 50 + w * 14, 8, "hook");
    }
    // Backside
    if (w1) {
      if (meg) add(wcb, man(w1), "lock", "MEG on lone WR");
      else add(wcb, vert(w1), "match", "carries #1 deep");
    } else zone(wcb, 50 + w * 34, 19, "deep 1/3");
    if (w2 && wStruct !== "single") {
      const wnb = pick.nb(w, w2);
      add(wnb, man(w2), "match", "#2 out / vertical");
    }
  }

  // =============== Quarters / Palms / Cover 6 ===============
  if (family === "q" || family === "palms" || family === "c6") {
    const palms = family === "palms";

    // Rules for a side with two or more receivers.
    const quartersSide = (sd: -1 | 1, rs: Player[], struct: Struct, k: string) => {
      const [r1, r2, r3] = rs;
      const cb = pick.cb(sd);
      const saf = pick.saf(sd);
      const nb = pick.nb(sd, r2);
      const hook = pick.hook(sd);
      const cx = center(rs);
      if (k === "zone-it") {
        zone(cb, 50 + sd * 38, 18, "deep 1/4");
        zone(saf, 50 + sd * 13, 19, "deep 1/4");
        zone(nb, 50 + sd * 32, 8, "curl-flat");
        zone(hook, 50 + sd * 12, 8, "hook");
      } else if (struct === "bunch") {
        if (k === "point-triangle") {
          add(nb, man(r2), "lock", "locks the point #2");
          add(cb, man(r1), "match", "combo #1 / #3");
          if (r3) add(hook, man(r3), "match", "combo #1 / #3");
          add(saf, vert(r2), "bracket", "brackets deeper");
        } else {
          if (k === "bingo") add(cb, man(r1), "lock", "locks #1 if outside");
          else zone(cb, cx + sd * 6, 14, "deep outside");
          zone(saf, cx - sd * 6, 15, "deep inside");
          zone(nb, cx + sd * 9, 3, "flat");
          zone(hook, cx - sd * 9, 5.5, "short inside");
        }
      } else if (struct === "stack" && k === "triangle") {
        const [f, bk] = front(r1, r2);
        add(cb, man(f), "match", "combo");
        add(nb, man(bk), "match", "combo");
        add(saf, vert(f), "bracket", "brackets deeper");
        add(hook, inside(r2, sd), "zone", "hook");
      } else if (struct === "trips" && (k === "stubbie" || k === "stump")) {
        add(cb, man(r1), "lock", "man on #1");
        add(nb, flat(r2, sd), "match", k === "stump" ? "jumps #1/#2 short" : "jumps #2 quick out");
        if (r3) add(saf, vert(r3), "match", "reads #3, then #2");
        if (r3) add(hook, inside(r3, sd), "zone", "underneath");
      } else if (struct === "trips" && k === "stress") {
        zone(cb, 50 + sd * 38, 17, "deep zone");
        zone(saf, 50 + sd * 18, 18, "deep zone");
        add(nb, flat(r2, sd), "match", "#2 to flat");
        if (r3) add(hook, man(r3), "match", "#3");
      } else if (palms && (struct === "stack" || struct === "pair")) {
        add(cb, flat(r2, sd), "match", "reads #2 → flat");
        add(saf, vert(r1), "match", "#1 deep");
        add(hook, inside(r2, sd), "zone", "hook");
      } else {
        add(cb, vert(r1), "match", "#1 deep");
        add(saf, vert(r2), "match", "#2 vertical");
        add(nb, flat(r2, sd), "match", "#2 to flat");
        if (r3) add(hook, man(r3), "match", "#3");
        else add(hook, inside(r2, sd), "zone", "hook");
      }
    };

    if (strong.length >= 2) quartersSide(s, strong, sStruct, sCheck.key);

    const wcb = pick.cb(w);
    const wsaf = pick.saf(w);
    if (family === "c6") {
      // Cover 6: quarters to the strength, Cover 2 to the weak side.
      zone(wcb, w1 ? w1.x + w * 4 : 50 + w * 38, 3, "flat (Cover 2 side)");
      zone(wsaf, 50 + w * 24, 19, "deep half");
      if (w2) zone(pick.nb(w, w2), 50 + w * 26, 9, "curl");
    } else if (wStruct === "single" && w1) {
      const wk = wCheck.key;
      if (wk === "solo-cut") {
        add(wsaf, inside(w1, w), "match", "takes in-breakers");
        add(wcb, s3 ? man(s3) : { x: 50, y: 8 }, "help", "free to help");
      } else if (wk === "quarters") {
        add(wcb, vert(w1), "match", "#1 deep");
        add(wsaf, man(w1), "match", "#1 inside");
      } else {
        add(wcb, man(w1), "lock", "MEG on lone WR");
        add(wsaf, s3 ? vert(s3) : { x: 50, y: 13 }, "help", s3 ? "robs #3" : "free");
      }
    } else if (weak.length >= 2) {
      used.delete(wcb?.id ?? "");
      used.delete(wsaf?.id ?? "");
      quartersSide(w, weak, wStruct, wCheck.key);
    } else {
      zone(wcb, 50 + w * 38, 18, "deep 1/4");
      zone(wsaf, 50 + w * 13, 19, "deep 1/4");
    }
  }

  // =============== Man ===============
  if (family === "man" || family === "man2") {
    const two = family === "man2";
    const deep: Player[] = [];
    const bracketed = new Set<string>();
    if (two) {
      const a = pick.saf(s);
      const b2 = pick.saf(w);
      if (a) deep.push(a);
      if (b2) deep.push(b2);
    } else {
      const m = pick.middle();
      if (m) deep.push(m);
    }
    // Triangle help comes from the deep safety on that side (Cover 2 Man) or a free safety.
    const helper = (sd: number) => {
      const own = deep.find((d) => sideOf(d.x) === sd && !bracketed.has(d.id)) ?? (two ? undefined : pick.saf(sd));
      if (own) bracketed.add(own.id);
      return own;
    };

    const manSide = (sd: -1 | 1, rs: Player[], struct: Struct, k: string) => {
      const [r1, r2, r3] = rs;
      const cb = pick.cb(sd);
      const nb = r2 ? pick.nb(sd, r2) : undefined;
      const hook = r3 ? pick.hook(sd) : undefined;
      if (struct === "stack" && r1 && r2) {
        const [f, bk] = front(r1, r2);
        if (k === "combo") {
          add(cb, man(f), "match", "first outside break");
          add(nb, man(bk), "match", "first inside break");
        } else if (k === "triangle") {
          add(cb, man(f), "match", "combo");
          add(nb, man(bk), "match", "combo");
          add(helper(sd), vert(f), "bracket", "brackets deeper");
        } else if (k === "top-hat") {
          add(cb, man(bk), "lock", "takes back WR");
          add(nb, man(f), "lock", "takes front WR");
        } else {
          add(cb, man(f), "lock", "man");
          add(nb, man(bk), "lock", "man");
        }
      } else if (struct === "bunch" && r1 && r2) {
        if (k === "point-combo") {
          add(nb, man(r2), "lock", "locks the point");
          add(cb, man(r1), "match", "switches in/out");
          if (r3) add(hook, man(r3), "match", "switches in/out");
        } else if (k === "point-triangle") {
          add(cb, man(r1), "match", "combo #1 / #3");
          if (r3) add(hook, man(r3), "match", "combo #1 / #3");
          add(nb, man(r2), "lock", "man on #2");
          add(helper(sd), vert(r2), "bracket", "brackets deeper");
        } else {
          add(cb, man(r1), "lock", "man");
          add(nb, man(r2), "lock", "man");
          if (r3) add(hook, man(r3), "lock", "man");
        }
      } else {
        if (r1) add(cb, man(r1), "lock", "man");
        if (r2) add(nb, man(r2), "lock", "man");
        if (r3) add(hook, man(r3), "lock", "man");
      }
    };
    manSide(s, strong, sStruct, sCheck.key);
    manSide(w, weak, wStruct, wCheck.key);
    for (const d of deep) {
      if (bracketed.has(d.id)) continue;
      if (two) zone(d, 50 + sideOf(d.x) * 24, 19, "deep half");
      else zone(d, 50, 20, "deep middle");
    }
  }

  return { lines, recs, notes };
}
