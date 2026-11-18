// The trade block (Nick, 2026-11-18): who's available, from two places.
//  - Madden: the in-game trade block flag on EA's roster rows (Player.block, set by build.ts).
//  - Managers: the person running a team adds his own players (site player page or /tradeblock in
//    Discord). Saved in leagues.settings.tradeBlock.manual, keyed by player id, with the team he was on;
//    an entry stops counting once the player is on another team (traded, cut).
import type { LeagueData, Player } from "./types";

export type BlockEntry = { team: number; by: string; at: string; note?: string };
export type TradeBlockState = { manual?: Record<string, BlockEntry> };
export type BlockRow = { p: Player; madden: boolean; manual?: BlockEntry };

export const BLOCK_NOTE_MAX = 100;

/** Trims a manager's note (what he wants back, etc.) and strips what would break a Discord post. */
export function cleanBlockNote(raw: unknown): string {
  return String(raw ?? "").normalize("NFKC").replace(/[\r\n\t`@<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, BLOCK_NOTE_MAX).trim();
}

/** A manual entry that still counts: the player is on the team he was added from. */
export const entryLive = (p: Player | undefined, e: BlockEntry | undefined) => Boolean(p && e && !p.gone && p.team && p.team === e.team);

/** Everyone on the block right now, best overall first. */
export function blockRows(d: LeagueData, st: TradeBlockState | null | undefined): BlockRow[] {
  const manual = st?.manual || {};
  const rows: BlockRow[] = [];
  for (const p of d.players) {
    if (p.gone || !p.team) continue;
    const e = manual[String(p.id)];
    const live = entryLive(p, e);
    if (p.block || live) rows.push({ p, madden: Boolean(p.block), manual: live ? e : undefined });
  }
  return rows.sort((a, b) => b.p.ovr - a.p.ovr || a.p.last.localeCompare(b.p.last));
}

/** Is this player on the block (either source)? */
export function onBlock(p: Player, st: TradeBlockState | null | undefined) {
  return Boolean(p.block) || entryLive(p, st?.manual?.[String(p.id)]);
}

/** What changed in Madden's flag between two syncs (manual adds post when they're made). */
export function maddenBlockChanges(prev: LeagueData | null, next: LeagueData, st: TradeBlockState | null | undefined) {
  if (!next.blockKey) return { on: [] as Player[], off: [] as { p: Player; moved: boolean }[] };
  const before = new Map((prev?.players || []).map((p) => [p.id, p]));
  const firstLook = !prev?.blockKey; // first sync that reads the flag: post the whole block once
  const on: Player[] = [], off: { p: Player; moved: boolean }[] = [];
  for (const p of next.players) {
    if (p.gone) continue;
    const o = before.get(p.id);
    if (p.block && p.team && (firstLook || !o?.block || o.team !== p.team)) {
      // Already on it by hand: no second post.
      if (!firstLook && entryLive(p, st?.manual?.[String(p.id)])) continue;
      on.push(p);
    } else if (!firstLook && o?.block && o.team && !(p.block && p.team === o.team)) {
      if (p.team === o.team && entryLive(p, st?.manual?.[String(p.id)])) continue; // still on by hand
      off.push({ p, moved: p.team !== o.team });
    }
  }
  on.sort((a, b) => b.ovr - a.ovr);
  off.sort((a, b) => b.p.ovr - a.p.ovr);
  return { on, off };
}
