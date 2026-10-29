// Turns a formation set into 11 labeled players on the chart.
//
// Coordinates: x runs 0 (left sideline) to 100 (right sideline), squeezed in the
// middle the way playbook art is so the line doesn't overlap. y is yards from the
// line of scrimmage: positive is toward the defense, negative is the offensive
// backfield. Offensive strength is drawn to the right; "Flip" mirrors it.
//
// Madden names its sets with a consistent vocabulary (Trips, Bunch, Y Off, Flex,
// Wing, Close, Nasty, Wk, Offset, Mug, Over, Under...), so the alignment is read
// from the set name and its personnel. Anyone can drag a player to fine-tune it.

import { DEFENSE, OFFENSE, type DPers, type OPers } from "./formations";

export type Group = "OL" | "QB" | "RB" | "WR" | "TE" | "DL" | "LB" | "CB" | "S";
export type Player = { id: string; label: string; group: Group; x: number; y: number };

const tok = (name: string) => ` ${name.toLowerCase().replace(/-/g, " ")} `;
const has = (t: string, ...words: string[]) => words.some((w) => t.includes(` ${w} `));
const mirror = (ps: Player[]) => ps.map((p) => ({ ...p, x: 100 - p.x }));

/* ============================== offense ============================== */

type Spot = { group: Group; x: number; y: number };

export function layoutOffense(famId: string, setName: string): Player[] {
  const fam = OFFENSE.find((f) => f.id === famId) ?? OFFENSE[0];
  const set = fam.sets.find((s) => s.name === setName) ?? fam.sets[0];
  const t = tok(set.name);
  const [rbN, teN, wrN] = set.p as OPers;

  const line: Player[] = [
    ["LT", 38], ["LG", 44], ["C", 50], ["RG", 56], ["RT", 62],
  ].map(([l, x]) => ({ id: l as string, label: l as string, group: "OL", x: x as number, y: -1.25 }));

  // ---- backfield ----
  const backs: Spot[] = [];
  let qb: Spot = { group: "QB", x: 50, y: -3.95 };
  let rbLeft = rbN;
  const back = (x: number, y: number) => {
    if (rbLeft <= 0) return;
    backs.push({ group: "RB", x, y });
    rbLeft--;
  };
  const strongBack = has(t, "str", "strong");
  const wildcat = fam.id === "wildcat";

  switch (fam.id) {
    case "gun": {
      qb = { group: "QB", x: 50, y: -5.4 };
      if (has(t, "empty")) break;
      if (rbN >= 2 && !has(t, "wing")) {
        back(43, -5.4); back(57, -5.4); back(50, -8.6);
      } else if (has(t, "offset")) {
        back(strongBack ? 56 : 44, -7.6);
      } else {
        back(strongBack ? 57 : 43, -5.4);
      }
      break;
    }
    case "pistol": {
      qb = { group: "QB", x: 50, y: -4.6 };
      if (has(t, "full", "panther")) {
        back(43, -6.6); back(57, -6.6); back(50, -9.3);
      } else {
        back(50, -9.3);
        if (has(t, "weak")) back(43, -6.6);
        else if (rbN >= 2 && !has(t, "wing")) back(57, -6.6);
      }
      break;
    }
    case "singleback":
      back(50, -9.3);
      if (rbN >= 2 && !has(t, "wing")) back(56, -6.6);
      break;
    case "iform": back(50, -9.3); back(50, -6.6); break;
    case "strongi": back(50, -9.3); back(55.5, -6.6); break;
    case "weaki": back(50, -9.3); back(44.5, -6.6); break;
    case "poweri": back(50, -9.3); back(50, -6.6); back(55.5, -6.6); break;
    case "fullhouse": back(44, -6.6); back(56, -6.6); back(50, -9.3); break;
    case "marylandi": back(50, -6.6); back(50, -9.3); back(50, -12.0); break;
    case "splitbacks": back(44, -6.2); back(56, -6.2); break;
    case "near": back(50, -9.3); back(56, -6.6); break;
    case "far": back(50, -9.3); back(44, -6.6); break;
    case "wishbone": back(50, -6.6); back(44, -9.3); back(56, -9.3); break;
    case "splitt": back(44, -6.6); back(56, -6.6); back(50, -9.3); break;
    case "flexbone":
      // Fullback behind the QB; the other backs are slotbacks off the tackles (placed as wings below).
      back(50, -6.6);
      break;
    case "wildcat":
      // The back takes the direct snap; the quarterback splits out.
      qb = { group: "RB", x: 50, y: -5.4 };
      rbLeft--;
      if (rbLeft > 0) back(57, -5.4);
      break;
    case "goalline":
      if (rbN >= 3) { back(44, -6.6); back(56, -6.6); back(50, -9.3); }
      else { back(50, -6.6); back(50, -9.3); }
      break;
    case "hailmary":
      qb = { group: "QB", x: 50, y: -7 };
      back(43, -9.3);
      break;
  }

  // ---- receivers ----
  type R = { group: Group; inline?: boolean; wing?: boolean; off?: boolean };
  const recv: R[] = [];
  for (let i = 0; i < wrN; i++) recv.push({ group: "WR" });
  for (let i = 0; i < rbLeft; i++) recv.push({ group: "RB", wing: fam.id === "flexbone" });
  if (wildcat) recv.push({ group: "QB" });

  // Tight ends: inline unless the set flexes them out.
  const bunchy = has(t, "bunch", "cluster");
  // In a bunch the TE is one of the three in the cluster, unless the set says "TE" (then he's inline away from it).
  const flexTE = (bunchy && !has(t, "te")) || has(t, "flex", "y flex", "open", "spread", "slot", "slots", "empty", "trey", "quads", "5wr", "box", "y iso", "hail");
  const teOff = has(t, "off");
  const heavy = has(t, "ace", "deuce", "tight", "wing", "jumbo", "h", "hulk", "east");
  const nWing = has(t, "double wing") ? 2 : has(t, "wing", "wings") ? 1 : 0;
  const tes: R[] = [];
  let offUsed = false;
  for (let i = 0; i < teN; i++) {
    const te: R = { group: "TE" };
    if (i === 0 && flexTE && (!heavy || (bunchy && !has(t, "te")))) {
      // Primary TE flexed out like a receiver.
    } else if (i >= teN - nWing) {
      te.wing = true;
    } else if (teOff && !offUsed) {
      te.off = true;
      offUsed = true;
    } else {
      te.inline = true;
    }
    tes.push(te);
  }
  recv.push(...tes);

  const n = recv.length;
  let strong: number;
  if (has(t, "quads")) strong = 4;
  else if (has(t, "trips", "trio", "trey", "bunch", "cluster", "overload", "triple", "y trips")) strong = 3;
  else if (has(t, "doubles", "deuce", "double", "twins", "duo", "spread", "box", "ace") && n >= 4) strong = 2;
  else strong = Math.ceil(n / 2);
  if (has(t, "empty") && n === 5 && strong < 3) strong = 3;
  strong = Math.min(strong, n);
  const weak = n - strong;

  // Who goes where: inline/wing TEs sit next to the line; strong side first.
  const order = [...recv].sort((a, b) => rank(a) - rank(b));
  function rank(r: R) {
    if (r.inline) return 0;
    if (r.wing) return 1;
    if (r.off) return 2;
    if (r.group === "QB") return 9; // wildcat QB goes wide weak
    return r.group === "WR" ? 5 : 4;
  }
  // Fill strong side with the first ones (TEs), but keep the wide receivers spread.
  const strongSide: R[] = [];
  const weakSide: R[] = [];
  // Weak side wants at least one outside receiver if possible.
  const wrs = order.filter((r) => r.group === "WR" || r.group === "QB");
  const others = order.filter((r) => !(r.group === "WR" || r.group === "QB"));
  // Two inline TEs (Ace, Tight, Jumbo) split one per side.
  const inlines = others.filter((r) => r.inline);
  if (inlines.length >= 2 && weak > 0) weakSide.push(inlines[1]);
  if (bunchy && has(t, "te") && weak > 0) for (const r of inlines) if (!weakSide.includes(r)) weakSide.push(r);
  for (const r of others) {
    if (weakSide.includes(r)) continue;
    if (strongSide.length < strong) strongSide.push(r);
    else weakSide.push(r);
  }
  // Wide receivers: weak side gets its outside man first, rest fill strong.
  const wq = [...wrs].reverse(); // QB (wildcat) first if present
  while (wq.length) {
    const r = wq.shift()!;
    if (weakSide.length < weak && (strongSide.length >= strong || weakSide.length === 0)) weakSide.push(r);
    else if (strongSide.length < strong) strongSide.push(r);
    else weakSide.push(r);
  }

  const placed: Spot[] = [];
  placeSide(strongSide, "strong");
  placeSide(weakSide, "weak");

  function placeSide(rs: R[], kind: "strong" | "weak") {
    const spots: Spot[] = [];
    const inline = rs.filter((r) => r.inline);
    const wing = rs.filter((r) => r.wing);
    const off = rs.filter((r) => r.off);
    const split = rs.filter((r) => !r.inline && !r.wing && !r.off)
      .sort((a, b) => (a.group === "WR" || a.group === "QB" ? 0 : 1) - (b.group === "WR" || b.group === "QB" ? 0 : 1));

    inline.forEach((r, i) => spots.push({ group: r.group, x: 67.5 + i * 5.5, y: -1.25 }));
    const edge = inline.length ? 67.5 + (inline.length - 1) * 5.5 : 62;
    wing.forEach((r, i) => spots.push({ group: r.group, x: edge + 4.5 + i * 4.5, y: -2.85 }));
    off.forEach((r) => spots.push({ group: r.group, x: edge + (inline.length ? 4.5 : 5), y: -2.85 }));
    const inner = Math.max(edge + (wing.length || off.length ? 10 : 7.5), 71);

    const k = split.length;
    if (!k) return void placed.push(...(kind === "weak" ? spots.map((s) => ({ ...s, x: 100 - s.x })) : spots));

    const bunch = kind === "strong" && has(t, "bunch", "cluster") && k >= 3;
    const stack = (kind === "strong" && has(t, "stack")) || has(t, "double stack", "clamp stack");
    let W = 92;
    if (has(t, "wide")) W = 95;
    if (has(t, "tight") && !has(t, "wing tight")) W = 82;
    if (kind === "strong" && has(t, "close", "snug")) W = Math.max(inner + (k - 1) * 6, 78);

    const pts: [number, number][] = [];
    if (bunch) {
      const extra = k - 3;
      const cx = has(t, "wide") ? 84 : has(t, "open", "spread") ? 81 : has(t, "close", "tight") ? 75 : 78;
      if (extra > 0) for (let i = 0; i < extra; i++) pts.push([W - i * 6, -1]);
      pts.push([cx, -1.25], [cx - 4.5, -3.1], [cx + 4.5, -3.1]);
    } else if (stack && k >= 2) {
      const sx = k === 2 ? 84 : W;
      for (let i = 0; i < k - 2; i++) pts.push([W - i * 9, -1]);
      pts.push([sx - (k > 2 ? 10 : 0), -1.25], [sx - (k > 2 ? 10 : 0), -4.0]);
    } else {
      const gap = k > 1 ? Math.min(11, (W - inner) / (k - 1)) : 0;
      for (let i = 0; i < k; i++) pts.push([W - i * gap, i === 0 ? (kind === "weak" ? -1.25 : -2.05) : -2.05]);
    }
    // Nasty split: the outside man cuts his split to a few yards off the tackle.
    if (has(t, "nasty")) {
      const xNasty = has(t, "x nasty") ? kind === "weak" : kind === "strong";
      if (xNasty && pts.length) pts[0] = [wing.length || off.length ? edge + 9.5 : inline.length ? edge + 5 : 69, -1.25];
    }
    split.forEach((r, i) => spots.push({ group: r.group, x: pts[i][0], y: pts[i][1] }));
    placed.push(...(kind === "weak" ? spots.map((s) => ({ ...s, x: 100 - s.x })) : spots));
  }

  // ---- labels ----
  const all: Spot[] = [qb, ...backs, ...placed];
  const out: Player[] = [...line];
  const count = (g: Group) => all.filter((s) => s.group === g).length;
  const byX = (g: Group) => all.filter((s) => s.group === g).sort((a, b) => a.x - b.x || b.y - a.y);

  if (wildcat) {
    out.push({ id: "HB", label: "HB", group: "RB", x: qb.x, y: qb.y });
    const others = all.slice(1).filter((s) => s.group === "RB");
    others.forEach((s, i) => out.push({ id: i ? `RB${i + 1}` : "FB", label: i ? "RB" : "FB", group: "RB", x: s.x, y: s.y }));
    const q = all.find((s) => s.group === "QB" && s !== qb)!;
    out.push({ id: "QB", label: "QB", group: "QB", x: q.x, y: q.y });
  } else {
    out.push({ id: "QB", label: "QB", group: "QB", x: qb.x, y: qb.y });
    // Deepest back is the HB, the rest are fullbacks.
    const rbs = all.filter((s) => s.group === "RB").sort((a, b) => a.y - b.y);
    rbs.forEach((s, i) => {
      const label = i === 0 ? "HB" : rbs.length > 2 ? `FB${i}` : "FB";
      out.push({ id: label, label, group: "RB", x: s.x, y: s.y });
    });
  }
  byX("WR").forEach((s, i) => out.push({ id: `WR${i + 1}`, label: `WR${i + 1}`, group: "WR", x: s.x, y: s.y }));
  const teCount = count("TE");
  byX("TE").forEach((s, i) => {
    const label = teCount > 1 ? `TE${i + 1}` : "TE";
    out.push({ id: label, label, group: "TE", x: s.x, y: s.y });
  });

  return has(t, "left") ? mirror(out) : out;
}

/* ============================== defense ============================== */

export function layoutDefense(famId: string, setName: string): Player[] {
  const fam = DEFENSE.find((f) => f.id === famId) ?? DEFENSE[0];
  const set = fam.sets.find((s) => s.name === setName) ?? fam.sets[0];
  const t = tok(`${fam.name} ${set.name}`);
  const [dlN, lbN, cbN, sN] = set.p as DPers;
  const out: Player[] = [];
  const DLY = 1.75;

  // ---- down linemen ----
  let dl: number[];
  switch (dlN) {
    case 1: dl = [50]; break;
    case 2: dl = has(t, "odd") ? [44, 58] : [41, 59]; break;
    case 3:
      dl = has(t, "tite", "cub", "bear") ? [44, 50, 56]
        : has(t, "wide", "jack", "rush") ? [33, 50, 67]
        : has(t, "over") ? [41, 50, 63] : [40, 50, 60];
      break;
    case 4:
      dl = has(t, "under") ? [32, 41, 53, 68]
        : has(t, "even") ? [33, 44, 56, 67]
        : has(t, "wide") ? [28, 44, 56, 72]
        : has(t, "odd", "tite") ? [34, 44, 50, 66]
        : has(t, "bear") ? [32, 44, 56, 68]
        : [32, 47, 59, 68]; // over
      break;
    case 5:
      dl = has(t, "tite", "grizzly") ? [31, 44, 50, 56, 69]
        : has(t, "bear", "cub") ? [32, 44, 50, 56, 68]
        : has(t, "under") ? [28, 41, 50, 57, 70]
        : has(t, "over") ? [30, 43, 50, 59, 72]
        : has(t, "even") ? [29, 41, 50, 59, 71]
        : has(t, "penny") ? [32, 44, 50, 56, 68]
        : [30, 41, 50, 59, 70];
      break;
    default: dl = [24, 36, 46, 54, 64, 76];
  }
  // Tighten when a 5-man front would collide in Tite/Bear, and keep it centered.
  const dlLabels = labelDL(dl.length);
  dl.forEach((x, i) => out.push({ id: dlLabels[i], label: dlLabels[i], group: "DL", x, y: DLY }));

  // ---- linebackers ----
  let lb = lbN;
  const lbSpots: [number, number][] = [];
  const mugs = has(t, "triple") ? 3 : has(t, "dbl mug", "double mug") ? 2 : has(t, "mug", "single mug") ? 1 : 0;
  const mugX = [47, 53, 59];
  for (let i = 0; i < Math.min(mugs, lb); i++) lbSpots.push([mugX[i], 4.3]);
  lb -= Math.min(mugs, lb);
  if (lb > 0 && has(t, "load")) { lbSpots.push([has(t, "weak") ? 26 : 75, 1.8]); lb--; }
  if (lb > 0 && has(t, "walk")) { lbSpots.push([78, 4]); lb--; }
  const stack: Record<number, number[]> = {
    1: [50],
    2: [42, 58],
    3: has(t, "under") ? [38, 50, 66] : [36, 50, 64],
    4: [32, 44, 56, 68],
  };
  (stack[lb] ?? []).forEach((x) => lbSpots.push([x, 7]));
  lbSpots.sort((a, b) => a[0] - b[0]);
  const lbLabels = labelLB(lbSpots.length);
  lbSpots.forEach(([x, y], i) => out.push({ id: lbLabels[i], label: lbLabels[i], group: "LB", x, y }));

  // ---- secondary ----
  const cbY = 7.5;
  const cbs: [number, number, string][] = [];
  if (cbN >= 1) cbs.push([7, cbY, "CB1"]);
  if (cbN >= 2) cbs.push([93, cbY, "CB2"]);
  if (cbN >= 3) cbs.push([79, 6, "NB"]);
  if (cbN >= 4) cbs.push([21, 6, "DB"]);
  cbs.forEach(([x, y, l]) => out.push({ id: l, label: l, group: "CB", x, y }));

  const prevent = has(t, "prevent");
  const deep = prevent ? 18 : 13;
  let ss: [number, number, string][];
  if (sN === 1) ss = [[50, deep + 1, "FS"]];
  else if (sN === 2) ss = has(t, "46") && !has(t, "bear under") ? [[75, 3.8, "SS"], [50, deep + 1, "FS"]] : [[36, deep, "SS"], [64, deep, "FS"]];
  else if (has(t, "3 high", "3 deep") || cbN >= 4) ss = [[26, deep, "SS"], [50, deep + 1.5, "FS"], [74, deep, "FS2"]];
  else if (cbN <= 2) ss = [[36, deep, "SS"], [64, deep, "FS"], [79, 6, "SS2"]]; // big nickel: third safety in the slot
  else ss = [[36, deep, "SS"], [64, deep, "FS"], [50, 10.4, "FS2"]]; // big dime: robber
  ss.forEach(([x, y, l]) => out.push({ id: l, label: l, group: "S", x, y }));

  return out;
}

function labelDL(n: number): string[] {
  if (n === 1) return ["NT"];
  if (n === 2) return ["REDG", "LEDG"];
  const inner = n - 2;
  const mid: string[] = [];
  if (inner === 1) mid.push("NT");
  else if (inner === 2) mid.push("DT1", "DT2");
  else if (inner === 3) mid.push("DT1", "NT", "DT2");
  else for (let i = 0; i < inner; i++) mid.push(`DT${i + 1}`);
  return ["REDG", ...mid, "LEDG"];
}
function labelLB(n: number): string[] {
  if (n === 1) return ["MIKE"];
  if (n === 2) return ["WILL", "MIKE"];
  if (n === 3) return ["WILL", "MIKE", "SAM"];
  if (n === 4) return ["WILL", "MIKE", "BUCK", "SAM"];
  return Array.from({ length: n }, (_, i) => `LB${i + 1}`);
}

export function personnelText(side: "O" | "D", p: OPers | DPers) {
  if (side === "O") {
    const [rb, te, wr] = p as OPers;
    return `${wr} WR · ${te} TE · ${rb} RB`;
  }
  const [dl, lb, cb, s] = p as DPers;
  return `${dl} DL · ${lb} LB · ${cb + s} DB`;
}
