// Turns a formation set into 11 labeled players on the chart, using the set's real
// in-game alignment (see formations.ts).
//
// Coordinates: x runs 0 (left sideline) to 100 (right sideline); y is yards from the
// line of scrimmage, positive toward the defense and negative in the offensive
// backfield. The view is from behind the offense, like the game's play art, so the
// defense's right end (REDG) lines up on the left of the chart.

import { findD, findO, type DPers, type OPers } from "./formations";

export type Group = "OL" | "QB" | "RB" | "WR" | "TE" | "DL" | "LB" | "CB" | "S";
export type Player = { id: string; label: string; group: Group; x: number; y: number };

const toPlayers = (raw: [string, string, string, number, number][]): Player[] =>
  raw.map(([id, label, group, x, y]) => ({ id, label, group: group as Group, x, y }));

export function layoutOffense(famId: string, setName: string): Player[] {
  return toPlayers(findO(famId, setName).set.players);
}

export function layoutDefense(famId: string, setName: string): Player[] {
  return toPlayers(findD(famId, setName).set.players);
}

export function personnelText(side: "O" | "D", p: OPers | DPers) {
  if (side === "O") {
    const [rb, te, wr] = p as OPers;
    return `${wr} WR · ${te} TE · ${rb} RB`;
  }
  const [dl, lb, cb, s] = p as DPers;
  return `${dl} DL · ${lb} LB · ${cb + s} DB`;
}
