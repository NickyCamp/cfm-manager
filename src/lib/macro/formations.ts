// Madden 27 formation catalog: every formation and set, offense and defense, with
// the real in-game alignment for each. The data comes from alignments.json, built by
// scripts/macro/build-alignments.mjs.

import data from "./alignments.json";

export type Side = "O" | "D";

/** Offensive personnel: running backs, tight ends, wide receivers. */
export type OPers = [rb: number, te: number, wr: number];
/** Defensive personnel: down linemen, linebackers, cornerbacks, safeties. */
export type DPers = [dl: number, lb: number, cb: number, s: number];

/** [id, label, group, x, y] — x 0–100 across the field, y yards from the line (+ toward the defense). */
export type RawPlayer = [string, string, string, number, number];

export type OSet = { name: string; p: OPers; players: RawPlayer[] };
export type DSet = { name: string; p: DPers; players: RawPlayer[] };
export type OFamily = { id: string; name: string; sets: OSet[] };
export type DFamily = { id: string; name: string; sets: DSet[] };

type RawFamily = { f: string; sets: { s: string; n: number[]; p: (string | number)[][] }[] };

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function families<T extends OPers | DPers>(raw: RawFamily[]) {
  return raw.map((f) => ({
    id: slug(f.f),
    name: f.f,
    sets: f.sets.map((s) => ({ name: s.s, p: s.n as T, players: s.p as RawPlayer[] })),
  }));
}

export const OFFENSE: OFamily[] = families<OPers>((data as { O: RawFamily[] }).O);
export const DEFENSE: DFamily[] = families<DPers>((data as { D: RawFamily[] }).D);

// Formation ids used by links shared before the catalog switched to real alignments.
const OLD_IDS: Record<string, string> = {
  "34": "3-4", "43": "4-3", "44": "4-4", "52": "5-2", "25": "2-5", "425": "4-2-5", "335": "3-3-5", "245": "2-4-5",
  iform: "i-form", strongi: "strong-i", weaki: "weak-i", poweri: "power-i", fullhouse: "full-house",
  marylandi: "maryland-i", splitbacks: "split-backs", splitt: "split-t", goalline: "goal-line",
};

function pick<F extends { id: string; sets: { name: string }[] }>(list: F[], fam: string, set: string) {
  const id = OLD_IDS[fam] ?? fam;
  const f = list.find((x) => x.id === id) ?? list[0];
  const want = set.toLowerCase();
  const s = f.sets.find((x) => x.name === set) ?? f.sets.find((x) => x.name.toLowerCase() === want) ?? f.sets[0];
  return { fam: f, set: s as F["sets"][number] };
}

export function findO(fam: string, set: string) {
  return pick(OFFENSE, fam, set);
}
export function findD(fam: string, set: string) {
  return pick(DEFENSE, fam, set);
}

export const SET_COUNT = {
  O: OFFENSE.reduce((n, f) => n + f.sets.length, 0),
  D: DEFENSE.reduce((n, f) => n + f.sets.length, 0),
};
