// /pack: open a pack of 5 random cards from the league, rarity by dev trait,
// scored in points, with a per-league leaderboard.
// Stats live in league-data/<slug>/discord/packs.json (public bucket).
import { randomInt } from "node:crypto";
import type { LeagueData, Player } from "../league/types";

export const PACK_SIZE = 5;

// Chance per card slot, by dev trait (index = Player.dev). Must add up to 1000.
export const ODDS = [740, 200, 50, 10] as const; // Normal 74%, Star 20%, Superstar 5%, X-Factor 1%
export const RARITY = [
  { name: "Common", emoji: "🟫", points: 1 },
  { name: "Rare", emoji: "⬜", points: 5 },
  { name: "Epic", emoji: "🟨", points: 20 },
  { name: "Legendary", emoji: "🟥", points: 100 },
] as const;

/** A card's points: its rarity, plus up to +5 for overall over 70, doubled for a 99. */
export function cardPoints(p: Player) {
  const base = RARITY[p.dev]?.points ?? 1;
  const ovrBonus = Math.max(0, Math.min(5, Math.floor((p.ovr - 70) / 5)));
  return (base + ovrBonus) * (p.ovr >= 99 ? 2 : 1);
}

/** Draws a pack. Each slot rolls a rarity, then a random player of that dev trait (no repeats). */
export function openPack(d: LeagueData): Player[] {
  const pool = d.players.filter((p) => !p.gone && p.team && !p.ps);
  const byDev = [0, 1, 2, 3].map((dev) => pool.filter((p) => p.dev === dev));
  const picked: Player[] = [];
  for (let n = 0; n < PACK_SIZE; n++) {
    const roll = randomInt(1000);
    let dev = 0, acc = 0;
    for (let i = 3; i >= 0; i--) { acc += ODDS[i]; if (roll < acc) { dev = i; break; } }
    // If that tier has run out, fall back to the next most common one.
    for (let t = dev; t >= 0; t--) {
      const left = byDev[t].filter((p) => !picked.includes(p));
      if (left.length) { picked.push(left[randomInt(left.length)]); break; }
    }
  }
  // Reveal order: the best card last.
  return picked.sort((a, b) => cardPoints(a) - cardPoints(b));
}

export type PackUser = { name: string; points: number; packs: number; best: number; legendaries: number; last: string; bestPull?: string };
export type PackStats = { users: Record<string, PackUser> };

/** The luck label for a pack's total. Simulated on NCL and stooey (10,000 packs each):
 *  median ~15 pts, average ~23, top 10% 38+, top 1% ~140; an X-Factor in ~5% of packs. */
export function luckLabel(total: number) {
  if (total >= 120) return "🤯 Insane pull";
  if (total >= 50) return "🔥 Huge pull";
  if (total >= 25) return "✨ Lucky pack";
  if (total >= 12) return "👍 Decent pack";
  return "🧱 Bricks";
}
