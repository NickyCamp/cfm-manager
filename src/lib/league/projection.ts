// Server-side projection for a league player: his real contract when Madden
// still carries it (realContracts.ts), otherwise the formula (cap.ts).
import { contractInput, projectContract } from "./cap";
import { realProjection, type RealSource } from "./realContracts";
import type { Player } from "./types";

export type ProjectionSource = RealSource | "formula";

export function projectPlayer(p: Player, currentYear: number): { hits: Record<number, number>; source: ProjectionSource } {
  const c = contractInput(p);
  const real = realProjection({ first: p.first, last: p.last, draftYear: p.draft?.year ?? null }, c, currentYear);
  return real ?? { hits: projectContract(c, currentYear), source: "formula" };
}
