// Builds src/lib/macro/alignments.json from the alignment captures in this folder.
//
// Each capture line is "Formation Set|line-of-scrimmage y|LABEL,x,y;LABEL,x,y;...",
// read from madden-school.com's formation diagrams (an SVG 780 units wide, with the
// hashes at x 291.44 / 488.56). This script turns those into the Macro Builder's
// chart space: x 0–100 across the field, y in yards from the line of scrimmage
// (positive toward the defense).
//
//   node scripts/macro/build-alignments.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(here, f), "utf8").split("\n").map((l) => l.trim()).filter(Boolean);

// One source unit -> chart units. Same scale both ways so circle spacing matches the source.
const K = 0.115; // x: field units per source unit
const S = (K * 10) / 14; // y: yards per source unit (chart is 10px per x unit, 14px per yard)
const GAP = 0.45; // extra yards each side of the line so the two lines don't touch
const TEXT_DY = 4.5; // labels sit 4.5 units below their circle's center

const FAMILIES = {
  D: ["2-4-5", "2-5", "3-3-5", "3-4", "4-2-5", "4-3", "4-4", "46", "5-2", "Dime", "Dollar", "Goal Line", "Nickel", "Prevent", "Quarter"],
  O: ["Far", "Full House", "Goal Line", "Gun", "I Form", "Maryland I", "Near", "Pistol", "Power I", "Singleback", "Split Backs", "Split T", "Strong I", "Strong", "Weak I", "Weak", "Wildcat"],
};
// The source lists some Strong I / Weak I sets as just "Strong ..." / "Weak ...".
const FAMILY_ALIAS = { Strong: "Strong I", Weak: "Weak I" };

function groupOf(label) {
  const l = label.replace(/\d+$/, "");
  if (["LT", "LG", "C", "RG", "RT"].includes(l)) return "OL";
  if (l === "QB") return "QB";
  if (["HB", "FB", "3DRB", "PWHB", "GAD"].includes(l)) return "RB";
  if (l === "TE") return "TE";
  if (l === "WR" || l === "SLWR") return "WR";
  if (["REDG", "LEDG", "RRE", "RLE", "DT", "NT", "RDT"].includes(l)) return "DL";
  if (["WILL", "MIKE", "SAM", "SLB"].includes(l)) return "LB";
  if (l === "CB" || l === "SLCB") return "CB";
  if (l === "FS" || l === "SS") return "S";
  throw new Error(`Unknown position label: ${label}`);
}

const norm = (n) => n.toLowerCase().replace(/\bdbl\b/g, "double").replace(/[^a-z0-9]/g, "");
const r1 = (n) => Math.round(n * 10) / 10;

function build(side, lines) {
  const fams = new Map();
  const seen = new Set();
  for (const line of lines) {
    const [name, losStr, players] = line.split("|");
    const fam = [...FAMILIES[side]].sort((a, b) => b.length - a.length).find((f) => name === f || name.startsWith(`${f} `));
    if (!fam) throw new Error(`No family for "${name}"`);
    const family = FAMILY_ALIAS[fam] ?? fam;
    const set = name.slice(fam.length).trim() || "Normal";
    const key = `${family}|${norm(set)}`;
    if (seen.has(key)) {
      // Same set listed twice under slightly different names: keep the tighter spelling ("4WR", not "4 WR").
      const prev = fams.get(family)?.find((x) => `${family}|${norm(x.s)}` === key);
      if (prev && set.length < prev.s.length) prev.s = set;
      continue;
    }
    seen.add(key);

    const los = Number(losStr);
    const used = new Map();
    const p = players.split(";").map((t) => {
      const [label, xs, ys] = t.split(",");
      const n = (used.get(label) ?? 0) + 1;
      used.set(label, n);
      const id = n === 1 ? label : `${label}${n}`;
      const cy = Number(ys) - TEXT_DY;
      const d = side === "D" ? los - cy : cy - los;
      let y = (d * S + GAP) * (side === "D" ? 1 : -1);
      if (side === "D") y = Math.min(25.2, y);
      const x = Math.min(97, Math.max(3, 50 + (Number(xs) - 390) * K));
      return [id, label, groupOf(label), r1(x), r1(y)];
    });
    if (p.length !== 11) throw new Error(`${name}: ${p.length} players`);
    // Two players drawn on the exact same spot in the source: set the second one beside the first.
    for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) {
      if (Math.abs(p[i][3] - p[j][3]) < 0.5 && Math.abs(p[i][4] - p[j][4]) < 0.5) p[j][3] = r1(p[j][3] + 5);
    }

    const count = (g) => p.filter((q) => q[2] === g).length;
    const pers = side === "O"
      ? [count("RB"), count("TE"), count("WR")]
      : [count("DL"), count("LB"), count("CB"), count("S")];
    if (!fams.has(family)) fams.set(family, []);
    fams.get(family).push({ s: set, n: pers, p });
  }
  return [...fams.entries()].map(([f, sets]) => ({ f, sets }));
}

const out = {
  D: build("D", read("defense.txt")),
  O: build("O", [...read("offense-1.txt"), ...read("offense-2.txt"), ...read("offense-3.txt")]),
};
const dest = join(here, "../../src/lib/macro/alignments.json");
writeFileSync(dest, JSON.stringify(out));
const total = (side) => out[side].reduce((n, f) => n + f.sets.length, 0);
console.log(`Wrote ${dest}: ${total("D")} defensive sets in ${out.D.length} formations, ${total("O")} offensive sets in ${out.O.length} formations`);
