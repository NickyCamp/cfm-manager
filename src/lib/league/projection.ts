// Server-side projection for a league player: his real contract when Madden
// still carries it (realContracts.ts), otherwise the formula (cap.ts).
import { contractInput, projectContract } from "./cap";
import { realProjection, realVoidYears, type RealSource } from "./realContracts";
import type { Player } from "./types";

export type ProjectionSource = RealSource | "formula";

/**
 * hits: cap hit for each season he's under contract (this season is Madden's).
 * dead: void-year bonus still counting after the contract ends (not a roster spot).
 */
export function projectPlayer(p: Player, currentYear: number): { hits: Record<number, number>; dead: Record<number, number>; source: ProjectionSource } {
  const c = contractInput(p);
  const name = { first: p.first, last: p.last, draftYear: p.draft?.year ?? null };
  const real = realProjection(name, c, currentYear);
  const dead = realVoidYears(name, c, currentYear);
  return real ? { ...real, dead } : { hits: projectContract(c, currentYear), dead, source: "formula" };
}
